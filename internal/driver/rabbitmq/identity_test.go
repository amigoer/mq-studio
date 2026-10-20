package rabbitmq

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * RabbitMQ 4.4 stopped returning password_hash from the user endpoints and
 * reports has_password instead. Reading the hash alone made every user on 4.4
 * look passwordless, and a tags-only edit then sent no hash back - which the
 * broker reads as "remove the password".
 */

// userServer answers the user endpoints from fixed bodies and records what the
// driver asked for. An empty user body is a 404, which is a user that does not
// exist yet.
type userServer struct {
	users       string
	user        string
	userStatus  int
	definitions string

	definitionsRead bool
	put             map[string]any
}

func (s *userServer) conn(t *testing.T) *Conn {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		path := strings.TrimSuffix(r.URL.Path, "/")
		switch {
		case r.Method == http.MethodGet && path == "/api/users":
			_, _ = w.Write([]byte(s.users))
		case r.Method == http.MethodGet && path == "/api/permissions":
			_, _ = w.Write([]byte(`[]`))
		case r.Method == http.MethodGet && path == "/api/definitions":
			s.definitionsRead = true
			_, _ = w.Write([]byte(s.definitions))
		case r.Method == http.MethodGet && strings.HasPrefix(path, "/api/users/"):
			switch {
			case s.userStatus != 0:
				w.WriteHeader(s.userStatus)
				_, _ = w.Write([]byte(`{"error":"internal_error","reason":"boom"}`))
			case s.user == "":
				w.WriteHeader(http.StatusNotFound)
				_, _ = w.Write([]byte(`{"error":"Object Not Found","reason":"Not Found"}`))
			default:
				_, _ = w.Write([]byte(s.user))
			}
		case r.Method == http.MethodPut && strings.HasPrefix(path, "/api/users/"):
			s.put = map[string]any{}
			if err := json.NewDecoder(r.Body).Decode(&s.put); err != nil {
				t.Errorf("decode PUT body: %v", err)
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)
	return &Conn{mgmt: testMgmt(server.URL)}
}

func TestListIdentitiesReadsEitherPasswordShape(t *testing.T) {
	for _, tc := range []struct {
		name  string
		users string
	}{
		{"4.4 and later", `[
			{"name":"with","tags":["management"],"has_password":true,"hashing_algorithm":"rabbit_password_hashing_sha256","limits":{}},
			{"name":"without","tags":["management"],"has_password":false,"hashing_algorithm":"rabbit_password_hashing_sha256","limits":{}}]`},
		{"before 4.4", `[
			{"name":"with","tags":["management"],"password_hash":"c2FsdGhhc2g=","hashing_algorithm":"rabbit_password_hashing_sha256"},
			{"name":"without","tags":["management"],"password_hash":"","hashing_algorithm":"rabbit_password_hashing_sha256"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := &userServer{users: tc.users}
			identities, err := server.conn(t).ListIdentities(context.Background())
			if err != nil {
				t.Fatalf("ListIdentities: %v", err)
			}
			got := map[string]bool{}
			for _, identity := range identities {
				got[identity.Name] = identity.HasPassword
			}
			if !got["with"] {
				t.Error("a user with a password reports having none")
			}
			if has, ok := got["without"]; !ok || has {
				t.Errorf("a passwordless user: present %v, has password %v", ok, has)
			}
		})
	}
}

func TestTagsOnlyUpdateKeepsThePasswordWithoutAHash(t *testing.T) {
	server := &userServer{
		user: `{"name":"app","tags":["management"],"has_password":true,"hashing_algorithm":"rabbit_password_hashing_sha512","limits":{}}`,
		definitions: `{"rabbit_version":"4.4.0","users":[
			{"name":"other","password_hash":"b3RoZXI=","hashing_algorithm":"rabbit_password_hashing_sha256","tags":[]},
			{"name":"app","password_hash":"c3RvcmVk","hashing_algorithm":"rabbit_password_hashing_sha512","tags":["management"]}],
			"queues":[{"name":"q","vhost":"/"}]}`,
	}
	err := server.conn(t).SaveIdentity(context.Background(), model.IdentitySpec{
		Name: "app", Tags: []string{"monitoring"},
	})
	if err != nil {
		t.Fatalf("SaveIdentity: %v", err)
	}
	if server.put == nil {
		t.Fatal("no PUT reached the broker")
	}
	if got := server.put["password_hash"]; got != "c3RvcmVk" {
		t.Errorf("password_hash sent = %v, want the stored one", got)
	}
	if got := server.put["hashing_algorithm"]; got != "rabbit_password_hashing_sha512" {
		t.Errorf("hashing_algorithm sent = %v, want the stored one", got)
	}
	if got := server.put["tags"]; got != "monitoring" {
		t.Errorf("tags sent = %v", got)
	}
}

// Before 4.4 the user endpoint carries the hash, and the definitions export is
// a whole-broker read that is not needed there.
func TestTagsOnlyUpdateUsesTheUsersOwnHashWhenThereIsOne(t *testing.T) {
	server := &userServer{
		user: `{"name":"app","tags":["management"],"password_hash":"b2xk","hashing_algorithm":"rabbit_password_hashing_sha256"}`,
	}
	err := server.conn(t).SaveIdentity(context.Background(), model.IdentitySpec{
		Name: "app", Tags: []string{"monitoring"},
	})
	if err != nil {
		t.Fatalf("SaveIdentity: %v", err)
	}
	if server.definitionsRead {
		t.Error("the definitions export was read although the user carried its hash")
	}
	if server.put == nil || server.put["password_hash"] != "b2xk" {
		t.Errorf("PUT = %v, want the user's own hash", server.put)
	}
}

func TestTagsOnlyUpdateLeavesAPasswordlessUserPasswordless(t *testing.T) {
	server := &userServer{
		user: `{"name":"app","tags":["management"],"has_password":false,"hashing_algorithm":"rabbit_password_hashing_sha256","limits":{}}`,
	}
	err := server.conn(t).SaveIdentity(context.Background(), model.IdentitySpec{
		Name: "app", Tags: []string{"monitoring"},
	})
	if err != nil {
		t.Fatalf("SaveIdentity: %v", err)
	}
	if server.definitionsRead {
		t.Error("the definitions export was read for a user with no password")
	}
	if server.put == nil {
		t.Fatal("no PUT reached the broker")
	}
	if hash, _ := server.put["password_hash"].(string); hash != "" || server.put["password"] != nil {
		t.Errorf("PUT = %v, want no password", server.put)
	}
}

// A user that does not exist yet has nothing to keep.
func TestEmptyPasswordCreatesAPasswordlessUser(t *testing.T) {
	server := &userServer{}
	err := server.conn(t).SaveIdentity(context.Background(), model.IdentitySpec{
		Name: "new", Tags: []string{"management"},
	})
	if err != nil {
		t.Fatalf("SaveIdentity: %v", err)
	}
	if server.put == nil {
		t.Fatal("no PUT reached the broker")
	}
	if hash, _ := server.put["password_hash"].(string); hash != "" || server.put["password"] != nil {
		t.Errorf("PUT = %v, want no password", server.put)
	}
}

// Any doubt about the stored password has to stop the save: going ahead sends
// no hash, and the broker removes the password.
func TestTagsOnlyUpdateRefusesRatherThanWipe(t *testing.T) {
	for _, tc := range []struct {
		name   string
		server *userServer
	}{
		{"the user cannot be read", &userServer{userStatus: http.StatusInternalServerError}},
		{"the export lacks the user", &userServer{
			user:        `{"name":"app","tags":[],"has_password":true,"hashing_algorithm":"rabbit_password_hashing_sha256"}`,
			definitions: `{"users":[{"name":"other","password_hash":"b3RoZXI=","tags":[]}]}`,
		}},
		{"the export carries no hash", &userServer{
			user:        `{"name":"app","tags":[],"has_password":true,"hashing_algorithm":"rabbit_password_hashing_sha256"}`,
			definitions: `{"users":[{"name":"app","tags":[]}]}`,
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.server.conn(t).SaveIdentity(context.Background(), model.IdentitySpec{
				Name: "app", Tags: []string{"monitoring"},
			})
			if err == nil {
				t.Error("the save went ahead without the stored password")
			}
			if tc.server.put != nil {
				t.Errorf("a PUT reached the broker: %v", tc.server.put)
			}
		})
	}
}
