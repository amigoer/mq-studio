package mcpserver

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/message"
)

// inspectedConn answers every one of the inspection ports with something the
// test can recognise, and, when scoped, answers from the namespace it is asked
// about - the way a family that keeps clients apart by vhost does.
type inspectedConn struct {
	fakeConn
	scoped bool
}

func (c *inspectedConn) Health(context.Context) (*model.BrokerHealth, error) {
	return &model.BrokerHealth{Alarms: []*model.ResourceAlarm{{Resource: "disk"}}}, nil
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

func (c *inspectedConn) TrackMessage(_ context.Context, _, messageID string) ([]*model.MessageTrackItem, error) {
	return []*model.MessageTrackItem{{ConsumerGroup: "billing", TrackType: "NOT_CONSUME_YET"}}, nil
}

func (c *inspectedConn) ListShards(_ context.Context, ref model.DestinationRef) ([]*model.Shard, error) {
	return []*model.Shard{{ID: "shardId-000000000000", Closed: true}, {ID: "shardId-000000000001",
		ParentID: "shardId-000000000000"}}, nil
}

func (c *inspectedConn) ListChannels(context.Context) ([]*model.Channel, error) {
	return []*model.Channel{{Name: "APP.SVRCONN", Status: model.ChannelRetrying}}, nil
}

func inspectedServer(t *testing.T, conn *inspectedConn) *app.Services {
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

/*
 * Each inspection tool hands on what its port answered, and the endpoint's
 * caveat with it - read through the protocol, since the answers are nested
 * structs a schema could reject.
 */
func TestTheInspectionToolsAnswerWhatTheBrokerSaid(t *testing.T) {
	conn := &inspectedConn{fakeConn: fakeConn{kind: model.KindRabbitMQ, capabilities: model.NewCapabilities(
		model.CapClusterHealth, model.CapClientInspect, model.CapMessageTrack, model.CapShards, model.CapChannels,
	).WithCaveat(model.CapClusterHealth, "mq.rabbitmq.caveat.browseAltersQueue")}}
	clientSession := session(t, inspectedServer(t, conn), catalog.BlastRead)

	cases := []struct {
		tool      string
		arguments map[string]any
		want      string
	}{
		{"cluster_health", map[string]any{}, `"resource":"disk"`},
		{"client_connections", map[string]any{}, `"name":"10.0.0.7:51234 `},
		{"client_channels", map[string]any{}, `"unacknowledged":250`},
		{"message_track", map[string]any{"destination": "orders", "messageId": "m-1"}, `"consumerGroup":"billing"`},
		{"destination_shards", map[string]any{"destination": "clicks"}, `"parentId":"shardId-000000000000"`},
		{"channels_list", map[string]any{}, `"status":"retrying"`},
	}
	for _, c := range cases {
		c.arguments["connection"] = 1
		result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{Name: c.tool, Arguments: c.arguments})
		if err != nil {
			t.Fatalf("%s: %v", c.tool, err)
		}
		if result.IsError {
			t.Errorf("%s failed: %+v", c.tool, result.Content)
			continue
		}
		answer, _ := json.Marshal(result.StructuredContent)
		if !strings.Contains(string(answer), c.want) {
			t.Errorf("%s answered %s, which does not carry %s", c.tool, answer, c.want)
		}
		if c.tool == "cluster_health" && !strings.Contains(string(answer), "browsing requeues") {
			t.Errorf("the caveat did not travel with the health checks: %s", answer)
		}
	}
}
