package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	natsclient "github.com/nats-io/nats.go"
)

// systemClient asks the cluster about itself over $SYS.
//
// It holds its own connection because it has to: a NATS account is an
// isolation boundary, and $SYS.REQ.* is not reachable from the account the
// app's pages read through however many permissions that account has. The
// credentials are a separate pair on the connection form for the same reason.
//
// What it buys is the one thing the monitoring endpoint cannot do. A PING
// subject fans out to every server in the cluster and each answers for itself,
// so one request produces the whole topology - where the HTTP endpoint answers
// for the single server whose port was named, and a three-server cluster would
// otherwise need three addresses on the form and three sets of credentials.
type systemClient struct {
	nc *natsclient.Conn

	closeOnce sync.Once
}

// dialSystem opens the system-account connection.
//
// It verifies rather than just connecting. A server with authorization on will
// refuse the wrong account at connect time, but one with no accounts defined
// accepts anything and then answers nothing on $SYS - so a successful dial is
// not evidence the account is the system one, and only a request is.
func dialSystem(ctx context.Context, config clientConfig) (*systemClient, error) {
	options, err := config.systemDialOptions()
	if err != nil {
		return nil, err
	}
	nc, err := natsclient.Connect(serverList(config.Servers), options...)
	if err != nil {
		return nil, err
	}
	client := &systemClient{nc: nc}
	if _, err := client.ping(ctx, endpointVarz, 1); err != nil {
		client.close()
		return nil, err
	}
	return client, nil
}

func (s *systemClient) close() {
	s.closeOnce.Do(func() {
		if s.nc != nil {
			s.nc.Close()
		}
	})
}

// The $SYS endpoints this driver asks for. Each is a suffix on both the PING
// subject, which every server answers, and the per-server subject, which one
// does.
const (
	endpointVarz  = "VARZ"
	endpointConnz = "CONNZ"
)

// systemReply is the envelope every $SYS answer arrives in: which server
// replied, and what it said.
//
// Data stays raw so each caller decodes the shape it asked for. The envelope
// is the only part that is the same across endpoints, and giving Data a type
// here would mean one struct per endpoint in a file that does not use them.
type systemReply struct {
	Server struct {
		Name    string `json:"name"`
		ID      string `json:"id"`
		Cluster string `json:"cluster"`
		Version string `json:"ver"`
		Host    string `json:"host"`
	} `json:"server"`
	Data json.RawMessage `json:"data"`
}

// ping asks every server the same question and collects what comes back.
//
// There is no way to know how many servers should answer, so the wait is
// bounded by time rather than by count: the request stays open for the
// deadline on ctx, or until expect replies have arrived when the caller knows
// the number. A cluster where one server is wedged answers with the rest,
// which is exactly the case an operator opened the page to look at.
func (s *systemClient) ping(ctx context.Context, endpoint string, expect int) ([]systemReply, error) {
	return s.pingWithBody(ctx, endpoint, nil, expect)
}

// pingWithBody is the same fan-out carrying a request document.
//
// Several $SYS endpoints take options - which account to narrow to, how many
// rows to return - and send them as the request body rather than as a query
// string, which is the one way they differ from the monitoring endpoint.
func (s *systemClient) pingWithBody(ctx context.Context, endpoint string, body any, expect int) ([]systemReply, error) {
	return s.fanOut(ctx, fmt.Sprintf("$SYS.REQ.SERVER.PING.%s", endpoint), endpoint, body, expect)
}

// pingAccounts is the same fan-out on the account tree rather than the server
// one.
//
// A separate subject rather than a parameter on the one above, because they
// are separate subscriptions on the server with separate handlers: $SYS.REQ
// .SERVER.PING.* asks each server about itself, and $SYS.REQ.ACCOUNT.PING.*
// asks each server about every account it is holding. Only STATZ answers on
// the account tree - the rest are addressed to one named account at a time.
func (s *systemClient) pingAccounts(ctx context.Context, endpoint string, body any, expect int) ([]systemReply, error) {
	return s.fanOut(ctx, fmt.Sprintf("$SYS.REQ.ACCOUNT.PING.%s", endpoint), endpoint, body, expect)
}

func (s *systemClient) fanOut(ctx context.Context, subject, endpoint string, body any, expect int) ([]systemReply, error) {
	if s.nc == nil {
		return nil, errConnectionDown
	}
	// A fan-out ends when nothing more arrives, so an unbounded context here
	// would mean waiting forever on a subject nobody answers - which is
	// exactly what an ordinary account's credentials produce.
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultDialTimeout)
		defer cancel()
	}
	deadline, _ := ctx.Deadline()

	inbox := s.nc.NewRespInbox()
	subscription, err := s.nc.SubscribeSync(inbox)
	if err != nil {
		return nil, err
	}
	defer func() { _ = subscription.Unsubscribe() }()

	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		payload = encoded
	}
	if err := s.nc.PublishRequest(subject, inbox, payload); err != nil {
		return nil, err
	}
	if err := s.nc.FlushWithContext(ctx); err != nil {
		return nil, err
	}

	replies := make([]systemReply, 0, max(expect, 1))
	for {
		// The first reply may take as long as the request is allowed. After
		// that the cluster has demonstrably answered, so silence means the
		// fan-out is over rather than that the servers are slow.
		wait, cancel := ctx, context.CancelFunc(nil)
		if len(replies) > 0 {
			wait, cancel = context.WithTimeout(ctx, fanOutSettle)
		}
		message, err := subscription.NextMsgWithContext(wait)
		if cancel != nil {
			cancel()
		}
		if err != nil {
			// Running out of time with replies in hand is the ordinary end of
			// a fan-out rather than a failure: nothing tells the caller how
			// many servers there are, so silence is how it finds out.
			if len(replies) > 0 {
				return replies, nil
			}
			return nil, err
		}
		var reply systemReply
		if err := json.Unmarshal(message.Data, &reply); err != nil {
			return nil, fmt.Errorf("$SYS.%s answered something that is not a server reply: %w", endpoint, err)
		}
		replies = append(replies, reply)
		if expect > 0 && len(replies) >= expect {
			return replies, nil
		}
		if !time.Now().Before(deadline) {
			return replies, nil
		}
	}
}

// fanOutSettle is how long the cluster gets to produce one more answer once it
// has produced any.
//
// Waiting the whole request deadline instead would be correct and useless: no
// server is going to reply late, so every cluster listing would take exactly
// as long as the timeout, whether it found one server or ten. A short quiet
// period after the last reply is what the nats CLI does for the same reason.
const fanOutSettle = 300 * time.Millisecond

// serverList is the comma-separated form nats.Connect takes.
func serverList(servers []string) string { return strings.Join(servers, ",") }

// unmarshalReply decodes one $SYS answer's data into the shape the caller
// asked for.
func unmarshalReply(reply systemReply, out any) error {
	return json.Unmarshal(reply.Data, out)
}

// kick disconnects one client from the server holding it.
//
// Addressed to that server rather than fanned out, because a client id counts
// within one server: two servers in a cluster will each have a client 7, and a
// broadcast kick would disconnect both.
//
// The response is checked rather than assumed. The server answers with an
// error object when it refuses - an unknown client id, or credentials that
// reach $SYS and are not permitted to close connections - and a request that
// returned is not a request that worked.
func (s *systemClient) kick(ctx context.Context, server string, cid uint64) error {
	if s.nc == nil {
		return errConnectionDown
	}
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, defaultDialTimeout)
		defer cancel()
	}

	subject := fmt.Sprintf("$SYS.REQ.SERVER.%s.KICK", server)
	body, err := json.Marshal(map[string]any{"cid": cid})
	if err != nil {
		return err
	}

	reply, err := s.nc.RequestWithContext(ctx, subject, body)
	if err != nil {
		return fmt.Errorf("server %q did not answer the disconnect: %w", server, err)
	}

	var response struct {
		Error *struct {
			Description string `json:"description"`
			Code        int    `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(reply.Data, &response); err != nil {
		return fmt.Errorf("server %q answered the disconnect with something unexpected: %w", server, err)
	}
	if response.Error != nil {
		return fmt.Errorf("server %q refused to disconnect client %d: %s",
			server, cid, response.Error.Description)
	}
	return nil
}
