package redisstream

import (
	"slices"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The rule language has more forms than a UI can model, so the parser sorts
 * what it recognises into columns and keeps the line whole. Nothing is
 * rewritten: a permission that changed meaning on its way to the screen is
 * worse than one shown in the server's own words.
 */
func TestParseAclUser(t *testing.T) {
	const line = "user mqs-seed-readonly on sanitize-payload " +
		"#8171bacf32668a8f44b90087ad107ed63170f57154763ba7e44047bf9e5a7be3 " +
		"~mqs-seed:* &* -@all +@read +@connection"

	user := parseAclUser(line)
	if user == nil {
		t.Fatal("the line was not read as a user")
	}
	if user.Name != "mqs-seed-readonly" {
		t.Errorf("name = %q", user.Name)
	}
	if !user.Enabled {
		t.Error("a user flagged on read as disabled")
	}
	if user.PasswordCount != 1 {
		t.Errorf("password count = %d, want 1", user.PasswordCount)
	}
	// nopass is not the same as having no password: the first authenticates
	// with anything, the second cannot authenticate at all.
	if user.NoPassword {
		t.Error("a user with a password hash read as nopass")
	}
	if !slices.Equal(user.KeyPatterns, []string{"~mqs-seed:*"}) {
		t.Errorf("key patterns = %v", user.KeyPatterns)
	}
	if !slices.Equal(user.ChannelPatterns, []string{"&*"}) {
		t.Errorf("channel patterns = %v", user.ChannelPatterns)
	}
	if user.CommandRules != "-@all +@read +@connection" {
		t.Errorf("command rules = %q, want them in the server's order", user.CommandRules)
	}
	// The line itself is the only form guaranteed to be complete, and is what
	// an operator checks the page against.
	if user.Rule != line {
		t.Errorf("rule = %q", user.Rule)
	}
}

func TestParseAclUserDisabledAndNopass(t *testing.T) {
	off := parseAclUser("user default off sanitize-payload resetchannels -@all")
	if off == nil || off.Enabled {
		t.Fatalf("a user flagged off read as %+v", off)
	}
	// Off with no password at all is the shape tests/e2e/redis uses to make
	// an anonymous connection refusable.
	if off.PasswordCount != 0 || off.NoPassword {
		t.Errorf("passwords = %d, nopass = %v", off.PasswordCount, off.NoPassword)
	}

	open := parseAclUser("user open on nopass ~* &* +@all")
	if open == nil || !open.NoPassword {
		t.Fatalf("a nopass user read as %+v", open)
	}
	if open.PasswordCount != 0 {
		t.Errorf("password count = %d on a nopass user", open.PasswordCount)
	}
}

/*
 * A selector runs to its closing parenthesis, which is several whitespace
 * fields away. Splitting it across the key and command columns would
 * misrepresent every permission inside it.
 */
func TestParseAclUserKeepsASelectorWhole(t *testing.T) {
	user := parseAclUser("user app on ~app:* +@all (~cache:* +get +set)")
	if user == nil {
		t.Fatal("not read as a user")
	}
	if len(user.Selectors) != 1 {
		t.Fatalf("selectors = %v", user.Selectors)
	}
	if user.Selectors[0] != "(~cache:* +get +set)" {
		t.Errorf("selector = %q", user.Selectors[0])
	}
	// And the selector's own patterns must not leak into the user's.
	if slices.Contains(user.KeyPatterns, "~cache:*") {
		t.Errorf("a selector's key pattern was read as the user's: %v", user.KeyPatterns)
	}
}

func TestParseAclUserRejectsWhatIsNotAUserLine(t *testing.T) {
	for _, line := range []string{"", "  ", "not a user line", "user"} {
		if parseAclUser(line) != nil {
			t.Errorf("%q was read as a user", line)
		}
	}
}

func TestPasswordHashesOf(t *testing.T) {
	hashes := passwordHashesOf("user app on #aaa #bbb ~* +@all")
	if !slices.Equal(hashes, []string{"aaa", "bbb"}) {
		t.Errorf("hashes = %v", hashes)
	}
	if got := passwordHashesOf("user app on nopass ~* +@all"); len(got) != 0 {
		t.Errorf("hashes = %v on a nopass user", got)
	}
}

/*
 * The order the rules are applied in is load-bearing. Redis reads SETUSER's
 * arguments left to right, so a reset anywhere but first would discard
 * everything before it - and the reset has to be there at all, because
 * SETUSER is otherwise additive and an edit that removed a key pattern would
 * silently leave it in place.
 */
func TestBuildAclRulesResetsFirst(t *testing.T) {
	rules := buildAclRules(model.AclUserSpec{
		Name:            "app",
		Enabled:         true,
		Password:        "hunter2",
		KeyPatterns:     []string{"~app:*"},
		ChannelPatterns: []string{"&events:*"},
		CommandRules:    []string{"-@all", "+@read"},
	}, nil)

	if len(rules) == 0 || rules[0] != "reset" {
		t.Fatalf("rules = %v, want reset first", rules)
	}
	if rules[1] != "on" {
		t.Errorf("rules = %v, want the state before the permissions", rules)
	}
	joined := strings.Join(rules, " ")
	for _, want := range []string{">hunter2", "~app:*", "&events:*", "-@all", "+@read"} {
		if !strings.Contains(joined, want) {
			t.Errorf("rules = %v, missing %q", rules, want)
		}
	}
}

/*
 * The cost of resetting is the passwords, which go with it. Putting the
 * existing hashes back is what stops an edit that was not about the password
 * from locking an application out.
 */
func TestBuildAclRulesKeepsExistingPasswords(t *testing.T) {
	rules := buildAclRules(model.AclUserSpec{Name: "app", Enabled: true}, []string{"aaa", "bbb"})
	joined := strings.Join(rules, " ")
	if !strings.Contains(joined, "#aaa") || !strings.Contains(joined, "#bbb") {
		t.Errorf("rules = %v, want the existing hashes re-applied", rules)
	}
}

func TestBuildAclRulesPasswordChoices(t *testing.T) {
	// A new password replaces whatever was there, so the old hashes must not
	// travel alongside it.
	newPassword := strings.Join(buildAclRules(model.AclUserSpec{
		Name: "app", Enabled: true, Password: "hunter2",
	}, []string{"aaa"}), " ")
	if strings.Contains(newPassword, "#aaa") {
		t.Errorf("a replaced password kept the old hash: %s", newPassword)
	}

	// Clearing leaves a user that cannot authenticate at all, which is a real
	// thing to want and is not nopass.
	cleared := strings.Join(buildAclRules(model.AclUserSpec{
		Name: "app", Enabled: true, ClearPasswords: true,
	}, []string{"aaa"}), " ")
	if strings.Contains(cleared, "#aaa") || strings.Contains(cleared, "nopass") {
		t.Errorf("clearing produced %s", cleared)
	}

	// And nopass is the opposite outcome: authenticates with anything.
	open := strings.Join(buildAclRules(model.AclUserSpec{
		Name: "app", Enabled: true, NoPassword: true,
	}, []string{"aaa"}), " ")
	if !strings.Contains(open, "nopass") || strings.Contains(open, "#aaa") {
		t.Errorf("nopass produced %s", open)
	}
}

func TestBuildAclRulesDisabledUser(t *testing.T) {
	rules := buildAclRules(model.AclUserSpec{Name: "app", Enabled: false}, nil)
	if !slices.Contains(rules, "off") {
		t.Errorf("rules = %v, want off", rules)
	}
}

func TestSaveAclUserValidatesTheName(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := t.Context()
	for _, name := range []string{"", "   ", "two words", "with\ttab"} {
		// The rule language is whitespace separated, so a name with a space
		// would be read as two arguments and change what the rule says.
		if err := conn.SaveAclUser(ctx, model.AclUserSpec{Name: name}); err == nil {
			t.Errorf("saving a user named %q succeeded", name)
		}
	}
}

func TestRemoveAclUserRefusesTheDefaultUser(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := t.Context()
	if err := conn.RemoveAclUser(ctx, "default"); err == nil {
		t.Error("removing the default user succeeded")
	}
	if err := conn.RemoveAclUser(ctx, "  "); err == nil {
		t.Error("removing a user with no name succeeded")
	}
}
