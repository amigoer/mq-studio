package mcpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

/*
 * A person confirms every destructive write before it is made.
 *
 * The allowance says whether a tool may touch a connection at all, and it is
 * set once, when the server starts. It cannot tell "empty the queue I am
 * looking at" from "empty the queue the model settled on". So each emptying
 * and each deletion is put to the person at the client, with the target and
 * its consequences in front of them - the question the window asks before it
 * does the same, and no more than that.
 *
 * A client that cannot ask a person is refused. Going ahead without one would
 * make the question decoration.
 *
 * The question goes out as an input request (SEP-2322): a client on the
 * current protocol asks and calls again with the answer, and for an older one
 * the SDK asks on its behalf and calls the handler again itself. Either way
 * the answer comes back with a later call, so it is tied to its question by a
 * token only this server holds, used once: an answer carried to another
 * target, or to the same target twice, matches nothing.
 */

// confirmationKey names the one input request a destructive call makes.
const confirmationKey = "confirm"

// confirmationTTL is how long a question waits. A person may take a while; an
// answer after this is to a question nobody is still asking.
const confirmationTTL = 15 * time.Minute

// questions is what a person is asked before each destructive operation. The
// keys resolve in the application's language, because the question is for
// the person at the client, not for the model.
var questions = map[string]string{
	"destination.purge":  "mcp.confirm.purge",
	"destination.delete": "mcp.confirm.delete",
}

// confirmable is the input of a tool a person confirms. It names the
// destination that would be destroyed, which is what the question is about.
type confirmable interface{ destination() model.DestinationRef }

// agreement is a question put to a person and not yet answered.
type agreement struct {
	tool      string
	arguments string
	// profile is the connection as the person was shown it. A connection
	// pointed elsewhere before the write is made is not the one they agreed to.
	profile model.ConnectionProfile
	// call ties the answer's records in the audit log to the question's.
	call    int64
	expires time.Time
}

// confirmations holds the questions this server is waiting on, by token.
type confirmations struct {
	mu      sync.Mutex
	pending map[string]agreement
}

// ask holds a question until it is answered, and returns the result that puts
// it to the person. It carries no content: the protocol keeps the two apart.
func (c *confirmations) ask(question string, asked agreement) *mcp.CallToolResult {
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	token := hex.EncodeToString(raw[:])

	c.mu.Lock()
	if c.pending == nil {
		c.pending = make(map[string]agreement)
	}
	now := time.Now()
	maps.DeleteFunc(c.pending, func(_ string, waiting agreement) bool { return now.After(waiting.expires) })
	c.pending[token] = asked
	c.mu.Unlock()

	return &mcp.CallToolResult{
		InputRequests: mcp.InputRequestMap{confirmationKey: &mcp.ElicitParams{
			Message: question,
			// Nothing to fill in: the answer is the yes or the no, as in the
			// window's own dialog.
			RequestedSchema: map[string]any{"type": "object", "properties": map[string]any{}},
		}},
		RequestState: token,
	}
}

// take consumes the question a call answers, and checks the answer is to this
// call: the same tool, on the same connection, with the same arguments.
func (c *confirmations) take(token, tool, arguments string) (agreement, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	asked, ok := c.pending[token]
	delete(c.pending, token)
	switch {
	case !ok:
		return agreement{}, errors.New(
			"not done: the answer is to a question this server did not ask, or one already answered")
	case time.Now().After(asked.expires):
		return asked, errors.New("not done: the question it answers expired unanswered")
	case asked.tool != tool || asked.arguments != arguments:
		return asked, errors.New("not done: the answer is to a question about a different call")
	}
	return asked, nil
}

// canConfirm reports whether the client a call came from can ask a person.
func canConfirm(request *mcp.CallToolRequest) bool {
	if request == nil || request.Session == nil {
		return false
	}
	return asksForms(request.Session.InitializeParams())
}

// asksForms reports whether a client said it can put a form in front of a
// person. Elicitation declared with neither mode means a form, per the spec;
// one that offered only URLs cannot show this question.
func asksForms(params *mcp.InitializeParams) bool {
	if params == nil || params.Capabilities == nil || params.Capabilities.Elicitation == nil {
		return false
	}
	elicitation := params.Capabilities.Elicitation
	return elicitation.Form != nil || elicitation.URL == nil
}

// answerOf is the reply a call carries, and whether it is answering a
// question at all. A reply with no token is not an answer: it was never asked.
func answerOf(request *mcp.CallToolRequest) (*mcp.ElicitResult, string, bool) {
	if request == nil || request.Params == nil || request.Params.RequestState == "" {
		return nil, "", false
	}
	reply, _ := request.Params.InputResponses[confirmationKey].(*mcp.ElicitResult)
	return reply, request.Params.RequestState, true
}

// verdict reads a reply. Only an explicit yes goes ahead.
func verdict(reply *mcp.ElicitResult) error {
	if reply == nil {
		return errors.New("not done: the call carried no answer to the question it was asked")
	}
	switch reply.Action {
	case "accept":
		return nil
	case "decline":
		return errors.New("not done: the person asked to confirm it declined, so it should not be " +
			"tried again unless they ask for it")
	default:
		return errors.New("not done: the question was dismissed without an answer")
	}
}

/*
 * question is what a destructive call puts to the person, and the connection
 * as it stands while they read it. Whatever would be refused anyway is refused
 * here instead: there is no point in a question whose yes leads nowhere.
 */
func (s *server) question(
	ctx context.Context, request *mcp.CallToolRequest, tool string, operation catalog.Operation,
	gated bool, id int, input any,
) (string, model.ConnectionProfile, error) {
	if gated {
		if err := s.reaches(id, tool, operation.Blast); err != nil {
			return "", model.ConnectionProfile{}, err
		}
	}
	if !canConfirm(request) {
		return "", model.ConnectionProfile{}, fmt.Errorf("%s needs a person to confirm it, and this "+
			"client cannot ask one: it did not offer elicitation when it connected", tool)
	}
	conn, caveat, err := s.capable(id, operation.Capability)
	if err != nil {
		return "", model.ConnectionProfile{}, err
	}
	profile, err := s.services.Connections.GetConnection(id)
	if err != nil {
		return "", model.ConnectionProfile{}, err
	}

	ref := input.(confirmable).destination()
	lines := []string{fill(s.say(questions[operation.ID]), map[string]string{
		"destination": describeRef(ref),
		"connection":  profile.Name,
		"family":      string(conn.Kind()),
	})}
	held, known, err := s.held(ctx, id, conn.Kind(), ref)
	if err != nil {
		return "", model.ConnectionProfile{}, err
	}
	if known {
		lines = append(lines, fill(s.say("mcp.confirm.depth"),
			map[string]string{"count": strconv.FormatInt(held, 10)}))
	}
	if caveat != "" {
		lines = append(lines, fill(s.say("mcp.confirm.caveat"), map[string]string{"caveat": caveat}))
	}
	return strings.Join(lines, "\n\n"), *profile.Clone(), nil
}

/*
 * held is how many messages the destination holds, for the question - the
 * number the person is about to lose, which the window's dialog shows too.
 *
 * Best effort: a family that reports no depth, or a read that fails, leaves
 * the count out rather than the question unasked. One thing does refuse: an
 * answer from another namespace than the one named, which is the target the
 * write would miss.
 */
func (s *server) held(ctx context.Context, id int, kind model.MQKind, ref model.DestinationRef) (int64, bool, error) {
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	destination, err := s.services.Topics.Detail(ctx, id, ref)
	if err != nil || destination == nil {
		return 0, false, nil
	}
	if err := consulted(kind, ref.Namespace, destination.Ref.Namespace); err != nil {
		return 0, false, err
	}
	return destination.Depth, destination.Depth >= 0, nil
}

// changedSince refuses a write whose connection was pointed elsewhere after
// the person agreed to it: what they agreed to is the broker they were shown.
func (s *server) changedSince(id int, agreed model.ConnectionProfile) error {
	current, err := s.services.Connections.GetConnection(id)
	if err != nil {
		return fmt.Errorf("not done: connection %d is no longer stored", id)
	}
	if connection.Repointed(agreed, *current) {
		return errors.New("not done: the connection was pointed at another broker or given other " +
			"credentials in the window after the person agreed to this, so it is not what they agreed to")
	}
	return nil
}

// canonical is a call's arguments as an answer is checked against them. The
// input is a struct, so its fields always marshal in the same order.
func canonical(input any) string {
	encoded, err := json.Marshal(input)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// fill puts values where the window's i18next would, into {{name}}
// placeholders. Replacement is one pass, so a value that looks like a
// placeholder stays as written.
func fill(template string, values map[string]string) string {
	pairs := make([]string, 0, 2*len(values))
	for name, value := range values {
		pairs = append(pairs, "{{"+name+"}}", value)
	}
	return strings.NewReplacer(pairs...).Replace(template)
}
