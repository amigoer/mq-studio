package toolset

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

/*
 * A person confirms every destructive write before it is made.
 *
 * However the question reaches them - through an agent's client, or in the
 * window's own sidebar - it is the same question, so it is worded here: the
 * target and its consequences in front of them, the question the window asks
 * before it does the same, and no more than that.
 */

// questions is what a person is asked before each destructive operation. The
// keys resolve in the application's language, because the question is for
// the person, not for the model.
var questions = map[string]string{
	"destination.purge":  "mcp.confirm.purge",
	"destination.delete": "mcp.confirm.delete",
}

/*
 * Question is what a destructive call puts to a person, and the connection as
 * it stands while they read it - what ChangedSince holds the write to once
 * they have answered. Whatever would be refused anyway is refused here
 * instead: there is no point in a question whose yes leads nowhere.
 */
func (e *Env) Question(ctx context.Context, tool Tool, input any) (string, model.ConnectionProfile, error) {
	target, targeted := input.(Targeted)
	confirmable, names := input.(Confirmable)
	template := questions[tool.Operation]
	if !targeted || !names || template == "" {
		return "", model.ConnectionProfile{}, fmt.Errorf("%s puts no question to a person", tool.Name)
	}
	operation, _ := catalog.Find(tool.Operation)
	id := target.Target()

	conn, caveat, err := e.capable(id, operation.Capability)
	if err != nil {
		return "", model.ConnectionProfile{}, err
	}
	profile, err := e.Services.Connections.GetConnection(id)
	if err != nil {
		return "", model.ConnectionProfile{}, err
	}

	ref := confirmable.Destination()
	lines := []string{fill(e.say(template), map[string]string{
		"destination": describeRef(ref),
		"connection":  profile.Name,
		"family":      string(conn.Kind()),
	})}
	held, known, err := e.held(ctx, id, conn.Kind(), ref)
	if err != nil {
		return "", model.ConnectionProfile{}, err
	}
	if known {
		lines = append(lines, fill(e.say("mcp.confirm.depth"),
			map[string]string{"count": strconv.FormatInt(held, 10)}))
	}
	if caveat != "" {
		lines = append(lines, fill(e.say("mcp.confirm.caveat"), map[string]string{"caveat": caveat}))
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
func (e *Env) held(ctx context.Context, id int, kind model.MQKind, ref model.DestinationRef) (int64, bool, error) {
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()
	destination, err := e.Services.Topics.Detail(ctx, id, ref)
	if err != nil || destination == nil {
		return 0, false, nil
	}
	if err := consulted(kind, ref.Namespace, destination.Ref.Namespace); err != nil {
		return 0, false, err
	}
	return destination.Depth, destination.Depth >= 0, nil
}

// ChangedSince refuses a write whose connection was pointed elsewhere after
// the person agreed to it: what they agreed to is the broker they were shown.
func (e *Env) ChangedSince(id int, agreed model.ConnectionProfile) error {
	current, err := e.Services.Connections.GetConnection(id)
	if err != nil {
		return fmt.Errorf("not done: connection %d is no longer stored", id)
	}
	if connection.Repointed(agreed, *current) {
		return errors.New("not done: the connection was pointed at another broker or given other " +
			"credentials in the window after the person agreed to this, so it is not what they agreed to")
	}
	return nil
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
