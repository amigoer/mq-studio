package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// ListIdentities returns every user with its permissions attached.
//
// Two requests rather than one per user: the broker lists all permissions in
// one call, and asking per user would be a request each on a cluster with
// fifty of them.
func (c *Conn) ListIdentities(ctx context.Context) ([]*model.Identity, error) {
	var users []userRecord
	if err := c.mgmt.getJSON(ctx, "/api/users", &users); err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}

	byUser := map[string][]*model.NamespacePermission{}
	// Permissions are best effort: a user without permission to read them
	// should still see the user list rather than an error page.
	if permissions, permErr := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.PermissionInfo, error) {
		return client.ListPermissions()
	}); permErr == nil {
		for _, permission := range permissions {
			byUser[permission.User] = append(byUser[permission.User], &model.NamespacePermission{
				Namespace: permission.Vhost,
				Identity:  permission.User,
				Configure: permission.Configure,
				Write:     permission.Write,
				Read:      permission.Read,
			})
		}
	}

	identities := make([]*model.Identity, 0, len(users))
	for _, user := range users {
		identities = append(identities, &model.Identity{
			Name:        user.Name,
			Tags:        user.Tags,
			HasPassword: user.hasPassword(),
			Permissions: byUser[user.Name],
		})
	}
	return identities, nil
}

// userRecord is a user as the management API reports it.
//
// rabbit-hole's UserInfo predates RabbitMQ 4.4, which stopped returning
// password_hash from the user endpoints and reports has_password instead.
type userRecord struct {
	Name             string                      `json:"name"`
	Tags             rabbithole.UserTags         `json:"tags"`
	HasPassword      *bool                       `json:"has_password"`
	PasswordHash     string                      `json:"password_hash"`
	HashingAlgorithm rabbithole.HashingAlgorithm `json:"hashing_algorithm"`
}

// hasPassword reads has_password, or the hash being present on a broker
// older than 4.4. The password itself never comes back.
func (u userRecord) hasPassword() bool {
	if u.HasPassword != nil {
		return *u.HasPassword
	}
	return u.PasswordHash != ""
}

// SaveIdentity creates a user or updates one.
//
// The broker's update endpoint replaces the whole user, so it has no way to
// say "change the tags and keep the password" - leaving the password out
// removes it. Keeping one therefore means reading the stored hash back and
// sending it again, which is what an empty password does here.
//
// WithoutPassword is the opposite instruction and is honoured as given: it
// produces a user that cannot authenticate with a password at all, which is
// correct for certificate or OAuth authentication and is asked for rather than
// arrived at by leaving a field blank.
func (c *Conn) SaveIdentity(ctx context.Context, spec model.IdentitySpec) error {
	settings := rabbithole.UserSettings{
		Name: spec.Name,
		Tags: spec.Tags,
	}

	switch {
	case spec.WithoutPassword:
		// Nothing to carry over; the broker is told to store none.
	case spec.Password != "":
		settings.Password = spec.Password
	default:
		stored, err := c.storedPassword(ctx, spec.Name)
		if err != nil {
			return fmt.Errorf("save user %q: %w", spec.Name, err)
		}
		settings.PasswordHash = stored.PasswordHash
		settings.HashingAlgorithm = stored.HashingAlgorithm
	}

	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		if settings.Password == "" && settings.PasswordHash == "" {
			return client.PutUserWithoutPassword(spec.Name, settings)
		}
		return client.PutUser(spec.Name, settings)
	})
	if err != nil {
		return fmt.Errorf("save user %q: %w", spec.Name, err)
	}
	return nil
}

// storedPassword is the hash and algorithm a save must send back to keep a
// user's password, or neither for a user with none to keep.
//
// A user that does not exist yet has nothing to keep, and the request then
// creates one with no password - which is the only reading of "create me a
// user and set no password". Any other failure to read is an error: carrying
// on would send no hash, and the broker would remove the password.
//
// RabbitMQ 4.4 no longer returns the hash from the user endpoints. The
// whole-broker definitions export still carries it, because restoring users
// from one needs it, so that is where it comes from there - a large read on a
// big broker, paid only by an edit that keeps a password.
func (c *Conn) storedPassword(ctx context.Context, name string) (userRecord, error) {
	var user userRecord
	if err := c.mgmt.getJSON(ctx, "/api/users/"+url.PathEscape(name), &user); err != nil {
		if statusOf(err) == http.StatusNotFound {
			return userRecord{}, nil
		}
		return userRecord{}, fmt.Errorf("read the stored password: %w", err)
	}
	if !user.hasPassword() {
		return userRecord{}, nil
	}
	if user.PasswordHash != "" {
		return user, nil
	}

	var definitions struct {
		Users []userRecord `json:"users"`
	}
	if err := c.mgmt.getJSON(ctx, "/api/definitions", &definitions); err != nil {
		return userRecord{}, fmt.Errorf("read the stored password from the definitions export: %w", err)
	}
	for _, exported := range definitions.Users {
		if exported.Name == name && exported.PasswordHash != "" {
			return exported, nil
		}
	}
	return userRecord{}, errors.New(
		"the broker did not report the stored password, so saving without one would remove it; enter the password to save")
}

// RemoveIdentity deletes a user.
//
// Its permissions go with it, and any connection it currently holds is closed
// by the broker.
func (c *Conn) RemoveIdentity(ctx context.Context, name string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteUser(name)
	})
	if err != nil {
		return fmt.Errorf("delete user %q: %w", name, err)
	}
	return nil
}

// SetPermission grants an identity rights inside one namespace.
//
// The three patterns are regular expressions matched against resource names.
// An empty one permits nothing; ".*" permits everything. There is no third
// state, which is why the form never leaves one blank by accident.
func (c *Conn) SetPermission(ctx context.Context, permission model.NamespacePermission) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.UpdatePermissionsIn(permission.Namespace, permission.Identity,
			rabbithole.Permissions{
				Configure: permission.Configure,
				Write:     permission.Write,
				Read:      permission.Read,
			})
	})
	if err != nil {
		return fmt.Errorf("set permissions for %q in %q: %w",
			permission.Identity, permission.Namespace, err)
	}
	return nil
}

// RemovePermission revokes an identity's rights in one namespace entirely.
//
// Different from setting all three patterns empty: with no permission record
// at all the broker refuses the connection to that virtual host, where empty
// patterns let it connect and do nothing. The second is harder to diagnose,
// so revoking is offered as its own gesture.
func (c *Conn) RemovePermission(ctx context.Context, namespace, identity string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.ClearPermissionsIn(namespace, identity)
	})
	if err != nil {
		return fmt.Errorf("revoke permissions for %q in %q: %w", identity, namespace, err)
	}
	return nil
}

// ListTopicPermissions returns the per-exchange narrowing applied on top of
// the namespace permissions.
func (c *Conn) ListTopicPermissions(ctx context.Context) ([]*model.TopicPermission, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.TopicPermissionInfo, error) {
		return client.ListTopicPermissions()
	})
	if err != nil {
		return nil, fmt.Errorf("list topic permissions: %w", err)
	}
	permissions := make([]*model.TopicPermission, 0, len(found))
	for _, permission := range found {
		permissions = append(permissions, &model.TopicPermission{
			Namespace: permission.Vhost,
			Identity:  permission.User,
			Exchange:  permission.Exchange,
			Write:     permission.Write,
			Read:      permission.Read,
		})
	}
	return permissions, nil
}

// SetTopicPermission narrows write and read on one topic exchange.
func (c *Conn) SetTopicPermission(ctx context.Context, permission model.TopicPermission) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.UpdateTopicPermissionsIn(permission.Namespace, permission.Identity,
			rabbithole.TopicPermissions{
				Exchange: permission.Exchange,
				Write:    permission.Write,
				Read:     permission.Read,
			})
	})
	if err != nil {
		return fmt.Errorf("set topic permissions for %q in %q: %w",
			permission.Identity, permission.Namespace, err)
	}
	return nil
}

// RemoveTopicPermission lifts every topic narrowing this identity has in the
// namespace, leaving its namespace permissions alone.
//
// All of them rather than one exchange's: the page shows the narrowing as one
// thing per identity per virtual host, and clearing exchange by exchange would
// be a control for a distinction the page does not draw.
func (c *Conn) RemoveTopicPermission(ctx context.Context, namespace, identity string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.ClearTopicPermissionsIn(namespace, identity)
	})
	if err != nil {
		return fmt.Errorf("clear topic permissions for %q in %q: %w", identity, namespace, err)
	}
	return nil
}
