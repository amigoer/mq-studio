package mcpserver

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
)

// audited is every record in an audit log, in the order written.
func audited(t *testing.T, path string) []auditRecord {
	t.Helper()
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	var records []auditRecord
	lines := bufio.NewScanner(file)
	for lines.Scan() {
		var record auditRecord
		if err := json.Unmarshal(lines.Bytes(), &record); err != nil {
			t.Fatalf("a line of the audit log is not a record: %v\n%s", err, lines.Text())
		}
		records = append(records, record)
	}
	if err := lines.Err(); err != nil {
		t.Fatal(err)
	}
	return records
}

/*
 * A write is recorded before it is made and again once it has been, and a
 * refusal once - read back from the file, since the file is the promise.
 */
func TestEveryWriteIsRecordedBeforeAndAfter(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := world.confirming(t)
	scratch, production := world.ids["scratch"], world.ids["production"]

	callTool(t, clientSession, "destinations_list", map[string]any{"connection": scratch})
	if records := audited(t, world.paths.AgentAuditFile); len(records) != 0 {
		t.Fatalf("a read was recorded: %+v", records)
	}

	callTool(t, clientSession, "destination_delete", map[string]any{"connection": scratch, "name": "orders"})
	callTool(t, clientSession, "message_resend", map[string]any{
		"connection": scratch, "group": "billing", "destination": "orders", "messageId": "m-1"})
	callTool(t, clientSession, "destination_delete", map[string]any{"connection": production, "name": "orders"})

	records := audited(t, world.paths.AgentAuditFile)
	if len(records) != 6 {
		t.Fatalf("recorded %d lines for two writes and a refusal, want 6: %+v", len(records), records)
	}
	asked, started, done, resent, failed, refused := records[0], records[1], records[2], records[3],
		records[4], records[5]

	if asked.Phase != phaseAsked || started.Phase != phaseStarted || done.Phase != phaseDone ||
		asked.Call != started.Call || started.Call != done.Call || started.Session != done.Session {
		t.Errorf("the delete is not a question, a start and its outcome: %+v / %+v / %+v", asked, started, done)
	}
	if !strings.Contains(asked.Question, "Delete orders on scratch") || !started.Confirmed {
		t.Errorf("the delete does not record what the person was asked and that they agreed: %+v / %+v",
			asked, started)
	}
	if started.Tool != "destination_delete" || started.Operation != "destination.delete" ||
		started.Blast != string(catalog.BlastDestructive) || started.Allow != string(catalog.BlastDestructive) {
		t.Errorf("the start does not say what was asked for: %+v", started)
	}
	if started.Connection != (auditConnection{ID: scratch, Name: "scratch", Family: "rabbitmq"}) {
		t.Errorf("the start names connection %+v", started.Connection)
	}
	if !strings.Contains(string(started.Arguments), `"name":"orders"`) {
		t.Errorf("the start does not carry the arguments: %s", started.Arguments)
	}
	if started.Client != "test test" {
		t.Errorf("client = %q, want the client as it introduced itself", started.Client)
	}
	if !strings.Contains(done.Changed, "deleted orders") || done.Millis == nil {
		t.Errorf("the outcome does not say what changed and how long it took: %+v", done)
	}

	if resent.Phase != phaseStarted || failed.Phase != phaseFailed || failed.Call != resent.Call ||
		!strings.Contains(failed.Error, "no concept") {
		t.Errorf("a write the family cannot do is not a start and a failure: %+v / %+v", resent, failed)
	}

	if refused.Phase != phaseRefused || refused.Allow != string(catalog.BlastRead) ||
		refused.Connection.Name != "production" || !strings.Contains(refused.Error, "no further than read") {
		t.Errorf("the refusal on production reads %+v", refused)
	}
}

/*
 * A write whose start cannot be recorded is not made.
 *
 * Otherwise the log would be complete only when nothing had gone wrong, which
 * is the one time nobody reads it.
 */
func TestAWriteThatCannotBeRecordedIsNotMade(t *testing.T) {
	world := newGrantedWorld(t)
	// A directory where the log should be: the open fails, whatever the user.
	if err := os.Mkdir(world.paths.AgentAuditFile, 0o700); err != nil {
		t.Fatal(err)
	}
	clientSession := world.confirming(t)

	refused, text := callTool(t, clientSession, "destination_create",
		map[string]any{"connection": world.ids["scratch"], "name": "orders"})
	if !refused || !strings.Contains(text, "not done") || !strings.Contains(text, "audit log") {
		t.Fatalf("a write that could not be recorded was not refused for it: %q", text)
	}
	if world.dials.Load() != 0 {
		t.Fatalf("dialled %d times for a write with no record", world.dials.Load())
	}

	// A destructive one is refused before the question, which is recorded
	// first: nobody is asked to agree to something that would then be refused.
	refused, text = callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": world.ids["scratch"], "name": "orders"})
	if !refused || !strings.Contains(text, "audit log") || len(world.conn.removed) != 0 {
		t.Fatalf("a delete that could not be recorded: %q, removed %v", text, world.conn.removed)
	}
}

/*
 * Every tool that writes is recorded, including where nothing is checked.
 *
 * Walked from the tool list with every write allowed everywhere, which is the
 * one configuration the allowance adds no wrapper for - so a write tool
 * registered around the recording would be caught here and nowhere else.
 */
func TestEveryWriteToolIsRecordedWhateverTheAllowance(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := connect(t, world.server, Grants{everywhere: catalog.BlastDestructive},
		clientSetup{answer: accept})

	tools, err := clientSession.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	written := 0
	for _, tool := range tools.Tools {
		if tool.Annotations == nil || tool.Annotations.ReadOnlyHint {
			continue
		}
		written++
		callTool(t, clientSession, tool.Name, requiredArguments(t, tool, world.ids["scratch"]))
		records := audited(t, world.paths.AgentAuditFile)
		if len(records) < 2 {
			t.Fatalf("%s left %d records", tool.Name, len(records))
		}
		start, outcome := records[len(records)-2], records[len(records)-1]
		if start.Tool != tool.Name || start.Phase != phaseStarted ||
			outcome.Call != start.Call || (outcome.Phase != phaseDone && outcome.Phase != phaseFailed) {
			t.Errorf("%s was not recorded as a start and an outcome: %+v / %+v", tool.Name, start, outcome)
		}
		if destructive := tool.Annotations.DestructiveHint; destructive != nil && *destructive {
			if asked := records[len(records)-3]; asked.Phase != phaseAsked || asked.Call != start.Call {
				t.Errorf("%s destroys and was made without a question first: %+v", tool.Name, asked)
			}
		}
	}
	if written < 6 {
		t.Fatalf("found %d tools that write, and the server has at least six", written)
	}
}

// Calls run at once, and each record has to arrive as a whole line.
func TestRecordsWrittenAtOnceStayWholeLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-audit.jsonl")
	audit := newJournal(path)

	var writers sync.WaitGroup
	for call := range 64 {
		writers.Go(func() {
			if err := audit.append(auditRecord{Call: int64(call), Phase: phaseStarted,
				Arguments: json.RawMessage(`{"body":"` + strings.Repeat("x", 2048) + `"}`)}); err != nil {
				t.Error(err)
			}
		})
	}
	writers.Wait()

	if records := audited(t, path); len(records) != 64 {
		t.Fatalf("64 records came back as %d", len(records))
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if mode := info.Mode().Perm(); mode != 0o600 {
			t.Errorf("the audit log is %v, readable by more than its owner", mode)
		}
	}
}
