package redisstream

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * ListAclUsers reads ACL LIST.
 *
 * One line per user, in the rule language SETUSER takes - which is the point:
 * what comes back is exactly what would be written, so an operator can check
 * the page against a line they could paste into redis-cli. The parsed fields
 * are for the columns; the line itself travels alongside them because it is
 * the only form guaranteed to be complete.
 */
func (c *Conn) ListAclUsers(ctx context.Context) ([]*model.AclUser, error) {
	reply, err := c.client.ACLList(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("list the acl users: %w", err)
	}

	users := make([]*model.AclUser, 0, len(reply))
	for _, line := range reply {
		if user := parseAclUser(line); user != nil {
			users = append(users, user)
		}
	}
	sort.Slice(users, func(left, right int) bool { return users[left].Name < users[right].Name })
	return users, nil
}

// AclCategories are the command groups rules are written in terms of. They
// differ by server version, so they are read rather than hardcoded.
func (c *Conn) AclCategories(ctx context.Context) ([]string, error) {
	categories, err := c.client.ACLCat(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("list the acl categories: %w", err)
	}
	sort.Strings(categories)
	return categories, nil
}

/*
 * SaveAclUser creates or replaces a user.
 *
 * It resets first, and that is the whole design. SETUSER is additive: applying
 * a spec without a reset would add the rules it names and leave every rule it
 * does not, so an edit that removed a key pattern would appear to succeed and
 * change nothing. Resetting makes the form the whole truth.
 *
 * The cost of a reset is the passwords, which go with it. They are put back by
 * re-applying the hashes the server already has - ACL LIST states them and
 * SETUSER accepts them - so an edit that was not about the password does not
 * silently lock an application out. That is why this reads the user first.
 */
func (c *Conn) SaveAclUser(ctx context.Context, spec model.AclUserSpec) error {
	name := strings.TrimSpace(spec.Name)
	if name == "" {
		return fmt.Errorf("an acl user needs a name")
	}
	if strings.ContainsAny(name, " \t\r\n") {
		// The rule language is whitespace separated, so a name with a space in
		// it would be read as two arguments and change what the rule says.
		return fmt.Errorf("an acl user name cannot contain whitespace")
	}

	var hashes []string
	if spec.Password == "" && !spec.ClearPasswords && !spec.NoPassword {
		existing, err := c.aclUser(ctx, name)
		if err != nil {
			return err
		}
		if existing != nil {
			hashes = passwordHashesOf(existing.Rule)
		}
	}

	rules := buildAclRules(spec, hashes)
	args := make([]any, 0, len(rules)+3)
	args = append(args, "ACL", "SETUSER", name)
	for _, rule := range rules {
		args = append(args, rule)
	}
	if err := c.client.Do(ctx, args...).Err(); err != nil {
		return fmt.Errorf("save acl user %q: %w", name, err)
	}
	return nil
}

// RemoveAclUser deletes a user and disconnects whatever was using it.
//
// Redis closes those connections itself, which is worth knowing rather than
// discovering: an application authenticated as the removed user stops working
// at once rather than at its next reconnect.
func (c *Conn) RemoveAclUser(ctx context.Context, name string) error {
	user := strings.TrimSpace(name)
	if user == "" {
		return fmt.Errorf("removing an acl user needs a name")
	}
	if user == "default" {
		// Redis refuses it too, but saying so here names the reason rather
		// than passing back a bare error from a command the user did not know
		// they were running.
		return fmt.Errorf("the default user cannot be removed")
	}

	removed, err := c.client.ACLDelUser(ctx, user).Result()
	if err != nil {
		return fmt.Errorf("remove acl user %q: %w", user, err)
	}
	if removed == 0 {
		return fmt.Errorf("acl user %q does not exist", user)
	}
	return nil
}

// aclUser finds one user in the listing. ACL GETUSER answers a structured
// reply whose shape has changed across versions; the line from ACL LIST is the
// stable form and is what the save path needs.
func (c *Conn) aclUser(ctx context.Context, name string) (*model.AclUser, error) {
	users, err := c.ListAclUsers(ctx)
	if err != nil {
		return nil, err
	}
	for _, user := range users {
		if user.Name == name {
			return user, nil
		}
	}
	return nil, nil
}

/*
 * buildAclRules turns a spec into the arguments SETUSER takes.
 *
 * The order matters: reset first, then the state, then the permissions. Redis
 * applies them left to right, so a reset after a permission would discard it.
 */
func buildAclRules(spec model.AclUserSpec, keepHashes []string) []string {
	rules := []string{"reset"}
	if spec.Enabled {
		rules = append(rules, "on")
	} else {
		rules = append(rules, "off")
	}

	switch {
	case spec.NoPassword:
		// Authenticates with anything. Deliberately distinct from having no
		// password, which is what a reset alone leaves and which means the
		// user cannot log in at all.
		rules = append(rules, "nopass")
	case spec.Password != "":
		rules = append(rules, ">"+spec.Password)
	case !spec.ClearPasswords:
		for _, hash := range keepHashes {
			rules = append(rules, "#"+hash)
		}
	}

	for _, pattern := range spec.KeyPatterns {
		if pattern = strings.TrimSpace(pattern); pattern != "" {
			rules = append(rules, pattern)
		}
	}
	for _, pattern := range spec.ChannelPatterns {
		if pattern = strings.TrimSpace(pattern); pattern != "" {
			rules = append(rules, pattern)
		}
	}
	for _, rule := range spec.CommandRules {
		if rule = strings.TrimSpace(rule); rule != "" {
			rules = append(rules, rule)
		}
	}
	return rules
}

/*
 * parseAclUser reads one line of ACL LIST.
 *
 * The rule language has more forms than a UI can model - allkeys and ~* mean
 * the same thing, %R~ and %W~ split reads from writes, selectors nest in
 * parentheses - so the fields are sorted into columns and the line is kept
 * whole. Nothing is rewritten: a permission that changed meaning on its way to
 * the screen is worse than one shown in the server's own words.
 */
func parseAclUser(line string) *model.AclUser {
	fields := strings.Fields(line)
	if len(fields) < 2 || fields[0] != "user" {
		return nil
	}

	user := &model.AclUser{Name: fields[1], Rule: line}
	commands := make([]string, 0, 4)

	for index := 2; index < len(fields); index++ {
		field := fields[index]
		switch {
		case field == "on":
			user.Enabled = true
		case field == "off":
			user.Enabled = false
		case field == "nopass":
			user.NoPassword = true
		case strings.HasPrefix(field, "#"):
			user.PasswordCount++
		case strings.HasPrefix(field, "("):
			// A selector runs to its closing parenthesis, which is several
			// fields away. Take the rest of the line from here and stop:
			// splitting a selector across columns would misrepresent every
			// permission in it.
			user.Selectors = append(user.Selectors, strings.Join(fields[index:], " "))
			index = len(fields)
		case field == "allkeys", strings.HasPrefix(field, "~"), strings.HasPrefix(field, "%"):
			user.KeyPatterns = append(user.KeyPatterns, field)
		case field == "allchannels", field == "resetchannels", strings.HasPrefix(field, "&"):
			user.ChannelPatterns = append(user.ChannelPatterns, field)
		case strings.HasPrefix(field, "+"), strings.HasPrefix(field, "-"):
			commands = append(commands, field)
		default:
			// sanitize-payload and anything a future release adds. It is part
			// of the rule and is kept in the line rather than dropped.
		}
	}

	user.CommandRules = strings.Join(commands, " ")
	return user
}

// passwordHashesOf reads the stored password hashes back out of a rule line,
// so a save that was not about the password can put them back after the reset.
func passwordHashesOf(line string) []string {
	hashes := make([]string, 0, 2)
	for _, field := range strings.Fields(line) {
		if strings.HasPrefix(field, "#") {
			hashes = append(hashes, strings.TrimPrefix(field, "#"))
		}
	}
	return hashes
}
