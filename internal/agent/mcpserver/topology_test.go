package mcpserver

import (
	"context"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/message"
)

type messageReaderConn struct {
	fakeConn
	found *model.MessageItem
}

func (c *messageReaderConn) QueryMessages(context.Context, model.MessageQueryParams) ([]*model.MessageItem, error) {
	return nil, nil
}

func (c *messageReaderConn) MessageByID(context.Context, string, string) (*model.MessageItem, error) {
	return c.found, nil
}

// A lookup that finds nothing is an answer, and a successful call carrying no
// message would read as one that found the message empty.
func TestAMessageThatIsNotThereIsSaidToBeAbsent(t *testing.T) {
	services, err := app.NewReadOnlyIn(t.TempDir())
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)
	conn := &messageReaderConn{fakeConn: fakeConn{kind: model.KindKafka, capabilities: model.Capabilities{
		Supported: []model.Capability{model.CapMessageByID}}}}
	conns := func(int) (driver.Conn, error) { return conn, nil }
	services.Conns = conns
	services.Messages = message.New(conns, requestTimeout{})
	s := &server{services: services, translate: testPhrases}

	ctx := context.Background()
	lookup := messageByIDInput{Destination: "orders", MessageID: "orders-0-42"}
	if _, _, err := s.messageByID(ctx, nil, lookup); err == nil || !strings.Contains(err.Error(), "no message") {
		t.Fatalf("a message that is not there came back as %v", err)
	}

	conn.found = &model.MessageItem{MessageID: "orders-0-42", Body: "hello"}
	_, found, err := s.messageByID(ctx, nil, lookup)
	if err != nil || found.Message == nil || found.Message.Body != "hello" {
		t.Fatalf("found %+v, %v", found.Message, err)
	}
}
