package toolset

import (
	"context"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/message"
)

// inspectedConn answers the client listings, and, when scoped, answers from
// the namespace it is asked about - the way a family that keeps clients apart
// by vhost does.
type inspectedConn struct {
	fakeConn
	scoped bool
}

func (c *inspectedConn) ListClientConnections(_ context.Context, namespace string) ([]*model.ClientConnection, error) {
	answered := ""
	if c.scoped {
		answered = namespace
	}
	return []*model.ClientConnection{{Name: "10.0.0.7:51234 -> 10.0.0.1:5672", Namespace: answered}}, nil
}

func (c *inspectedConn) ListClientChannels(_ context.Context, namespace string) ([]*model.ClientChannel, error) {
	answered := ""
	if c.scoped {
		answered = namespace
	}
	return []*model.ClientChannel{{Name: "10.0.0.7:51234 (1)", Unacknowledged: 250, Namespace: answered}}, nil
}

func inspectedServices(t *testing.T, conn *inspectedConn) *app.Services {
	t.Helper()
	services, err := app.NewReadOnlyIn(t.TempDir())
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)
	conns := func(int) (driver.Conn, error) { return conn, nil }
	services.Conns = conns
	services.Messages = message.New(conns, requestTimeout{})
	return services
}

// A family that does not keep clients apart by namespace answers from its own
// scope, and the listing would read as the namespace's clients.
func TestClientListingsRefuseANamespaceTheFamilyIgnores(t *testing.T) {
	ctx := context.Background()
	for _, scoped := range []bool{false, true} {
		conn := &inspectedConn{scoped: scoped, fakeConn: fakeConn{kind: model.KindRedisStream,
			capabilities: model.NewCapabilities(model.CapClientInspect)}}
		e := &Env{Services: inspectedServices(t, conn), Translate: testPhrases}
		asked := namespaceInput{Connection: 1, Namespace: "billing"}

		_, connectionsErr := e.clientConnections(ctx, asked)
		_, channelsErr := e.clientChannels(ctx, asked)
		for tool, err := range map[string]error{"client_connections": connectionsErr, "client_channels": channelsErr} {
			if scoped && err != nil {
				t.Errorf("%s: a family that scopes by namespace was refused: %v", tool, err)
			}
			if !scoped && (err == nil || !strings.Contains(err.Error(), "not consulted")) {
				t.Errorf("%s: a namespace the family ignores was taken: %v", tool, err)
			}
		}
		if _, err := e.clientConnections(ctx, namespaceInput{Connection: 1}); err != nil {
			t.Errorf("a listing with no namespace was refused: %v", err)
		}
	}
}
