package mcpserver

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/destination"
)

// namespacedConn either keeps destinations apart by namespace or answers every
// call from its own scope, which is the difference the refusals exist to catch.
type namespacedConn struct {
	fakeConn
	scoped  bool
	removed []model.DestinationRef
}

func (c *namespacedConn) answerFrom(namespace string) string {
	if c.scoped {
		return namespace
	}
	return ""
}

func (c *namespacedConn) ListDestinations(
	_ context.Context, filter model.DestinationFilter,
) ([]*model.Destination, error) {
	return []*model.Destination{{Ref: model.DestinationRef{
		Namespace: c.answerFrom(filter.Namespace), Name: "orders"}}}, nil
}

func (c *namespacedConn) DestinationDetail(
	_ context.Context, ref model.DestinationRef,
) (*model.Destination, error) {
	return &model.Destination{Ref: model.DestinationRef{
		Namespace: c.answerFrom(ref.Namespace), Name: ref.Name}}, nil
}

func (c *namespacedConn) CreateDestination(context.Context, model.DestinationSpec) error {
	return nil
}

func (c *namespacedConn) UpdateDestination(context.Context, model.DestinationSpec) error {
	return nil
}

func (c *namespacedConn) RemoveDestination(_ context.Context, ref model.DestinationRef) error {
	c.removed = append(c.removed, ref)
	return nil
}

type requestTimeout struct{}

func (requestTimeout) GetRequestTimeout() time.Duration { return time.Second }
func (requestTimeout) GetFetchLimit() int               { return 32 }

// namespacedServer is a whole application whose one connection is conn.
func namespacedServer(t *testing.T, conn *namespacedConn) *server {
	t.Helper()
	services, err := app.NewReadOnlyIn(t.TempDir())
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)

	conn.capabilities = model.Capabilities{Supported: []model.Capability{
		model.CapDestinationList, model.CapDestinationCreate, model.CapDestinationDelete}}
	conns := func(int) (driver.Conn, error) { return conn, nil }
	services.Conns = conns
	services.Topics = destination.New(conns, requestTimeout{})
	return &server{
		services:  services,
		translate: testPhrases,
		grants:    Grants{everywhere: catalog.BlastDestructive},
		offered:   offeredTools(catalog.BlastDestructive),
	}
}

func TestAListingThatIgnoredTheNamespaceIsRefused(t *testing.T) {
	ctx := context.Background()

	accounts := namespacedServer(t, &namespacedConn{fakeConn: fakeConn{kind: model.KindNATS}})
	if _, _, err := accounts.listDestinations(ctx, nil, destinationsInput{Namespace: "ACCOUNT_B"}); err == nil ||
		!strings.Contains(err.Error(), "not consulted") {
		t.Fatalf("the connection's own streams answered for another account: %v", err)
	}
	if _, _, err := accounts.listDestinations(ctx, nil, destinationsInput{}); err != nil {
		t.Fatalf("a listing with no namespace was refused: %v", err)
	}

	vhosts := namespacedServer(t, &namespacedConn{fakeConn: fakeConn{kind: model.KindRabbitMQ}, scoped: true})
	_, listed, err := vhosts.listDestinations(ctx, nil, destinationsInput{Namespace: "billing"})
	if err != nil {
		t.Fatalf("a family that scopes by namespace was refused: %v", err)
	}
	if listed.Destinations[0].Ref.Namespace != "billing" {
		t.Fatalf("listed from %q", listed.Destinations[0].Ref.Namespace)
	}
}

// The check has to come first here: afterwards, the connection's own stream of
// the same name is what would already be gone.
func TestDeleteRefusesANamespaceTheFamilyIgnoresBeforeDeleting(t *testing.T) {
	ctx := context.Background()

	conn := &namespacedConn{fakeConn: fakeConn{kind: model.KindNATS}}
	accounts := namespacedServer(t, conn)
	_, _, err := accounts.deleteDestination(ctx, nil, destinationTargetInput{Name: "orders", Namespace: "ACCOUNT_B"})
	if err == nil {
		t.Fatal("a delete in a namespace the family ignores went ahead")
	}
	if len(conn.removed) != 0 {
		t.Fatalf("deleted %v before refusing", conn.removed)
	}

	scoped := &namespacedConn{fakeConn: fakeConn{kind: model.KindRabbitMQ}, scoped: true}
	vhosts := namespacedServer(t, scoped)
	if _, _, err := vhosts.deleteDestination(ctx, nil, destinationTargetInput{Name: "orders", Namespace: "billing"}); err != nil {
		t.Fatalf("a delete inside a vhost was refused: %v", err)
	}
	if len(scoped.removed) != 1 || scoped.removed[0].Namespace != "billing" {
		t.Fatalf("removed %v, want orders in billing", scoped.removed)
	}
}

// A create cannot be checked first, so its effect has to say where it landed:
// "created orders in ACCOUNT_B" for a stream that went into another account is
// the one statement a caller would take at its word.
func TestCreateSaysWhenTheNamespaceWasNotConsulted(t *testing.T) {
	ctx := context.Background()

	accounts := namespacedServer(t, &namespacedConn{fakeConn: fakeConn{kind: model.KindNATS}})
	_, created, err := accounts.createDestination(ctx, nil, createDestinationInput{Name: "orders", Namespace: "ACCOUNT_B"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(created.Effect.Changed, "not consulted") {
		t.Fatalf("effect %q claims the namespace was honoured", created.Effect.Changed)
	}

	vhosts := namespacedServer(t, &namespacedConn{fakeConn: fakeConn{kind: model.KindRabbitMQ}, scoped: true})
	_, created, err = vhosts.createDestination(ctx, nil, createDestinationInput{Name: "orders", Namespace: "billing"})
	if err != nil {
		t.Fatal(err)
	}
	if created.Effect.Changed != `created orders in "billing" on rabbitmq` {
		t.Fatalf("effect %q", created.Effect.Changed)
	}
}

// A family that scopes by something else answers from where the object really
// is, and saying so is more use than "not supported".
func TestConsultedNamesWhereAnAnswerCameFrom(t *testing.T) {
	err := consulted(model.KindRocketMQ, "ClusterB", "ClusterA")
	if err == nil || !strings.Contains(err.Error(), `"ClusterA"`) {
		t.Fatalf("got %v", err)
	}
	if err := consulted(model.KindRocketMQ, "", "ClusterA"); err != nil {
		t.Fatalf("no namespace asked for, yet refused: %v", err)
	}
	if err := consulted(model.KindRocketMQ, "ClusterA"); err != nil {
		t.Fatalf("an empty answer was refused: %v", err)
	}
}
