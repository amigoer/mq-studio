package assistant

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/audit"
	"github.com/amigoer/mq-studio/internal/agent/provider"
)

func keptRecord(id, title string, seq int64, updated time.Time) record {
	return record{
		ID: id, Title: title, Provider: "p1", Model: "qwen3", Seq: seq,
		Connection: &audit.Connection{ID: 1, Name: "scratch", Family: "rabbitmq"},
		Created:    updated.Add(-time.Hour), Updated: updated,
		Items:    []Item{{ID: "1", Kind: ItemUser, Text: "why is legacy-sync behind?"}},
		Usage:    provider.Usage{Input: 10, Output: 2},
		Answered: true,
		History:  json.RawMessage(`[{"role":"user","content":"why is legacy-sync behind?"}]`),
	}
}

func TestAConversationIsKeptEncryptedAndReadBackWhole(t *testing.T) {
	directory := t.TempDir()
	archive := OpenArchive(directory)
	now := time.Date(2026, 10, 1, 14, 3, 0, 0, time.UTC)
	kept := keptRecord("0123456789ab", "legacy-sync backlog", 7, now)
	if err := archive.Save(kept); err != nil {
		t.Fatal(err)
	}

	for _, name := range []string{"0123456789ab.json", "index.json"} {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(string(raw), "ENC:") || strings.Contains(string(raw), "legacy-sync") {
			t.Errorf("%s is not sealed: %.80s", name, raw)
		}
		if info, _ := os.Stat(filepath.Join(directory, name)); runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
			t.Errorf("%s is readable by others: %v", name, info.Mode())
		}
	}

	read, err := OpenArchive(directory).Load("0123456789ab")
	if err != nil {
		t.Fatal(err)
	}
	read.Version = 0
	readJSON, _ := json.Marshal(read)
	keptJSON, _ := json.Marshal(kept)
	if string(readJSON) != string(keptJSON) {
		t.Errorf("read back\n%s\nfrom\n%s", readJSON, keptJSON)
	}
	listed, err := OpenArchive(directory).List()
	if err != nil || len(listed) != 1 || listed[0].Title != "legacy-sync backlog" || !listed[0].Updated.Equal(now) {
		t.Errorf("listed %+v, %v", listed, err)
	}
}

// Ids come back from the renderer, and the only ones made into a path are
// the ones the manager mints.
func TestAnIDThatIsNotOneNeverBecomesAPath(t *testing.T) {
	directory := t.TempDir()
	outside := filepath.Join(filepath.Dir(directory), "agent.json")
	if err := os.WriteFile(outside, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	archive := OpenArchive(directory)
	for _, id := range []string{"../agent", "../../agent", "0123456789AB", "", "0123456789ab/.."} {
		if _, err := archive.Load(id); err == nil {
			t.Errorf("loaded %q", id)
		}
		if err := archive.Delete(id); err == nil {
			t.Errorf("deleted %q", id)
		}
		if err := archive.Save(keptRecord(id, "x", 1, time.Now())); err == nil {
			t.Errorf("saved %q", id)
		}
	}
	if _, err := os.Stat(outside); err != nil {
		t.Errorf("a file outside the archive went: %v", err)
	}
}

// A conversation's file copied over another's does not decrypt: each is
// bound to the conversation it holds.
func TestAConversationCopiedOverAnotherDoesNotDecrypt(t *testing.T) {
	directory := t.TempDir()
	archive := OpenArchive(directory)
	if err := archive.Save(keptRecord("aaaaaaaaaaaa", "first", 1, time.Now())); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(filepath.Join(directory, "aaaaaaaaaaaa.json"))
	if err := os.WriteFile(filepath.Join(directory, "bbbbbbbbbbbb.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := archive.Load("bbbbbbbbbbbb"); err == nil {
		t.Error("a copied conversation decrypted under another id")
	}
}

// The index is only a summary of the files: one that is missing or damaged
// is built again from them, leaving out what does not decrypt.
func TestAnIndexThatIsGoneIsBuiltAgain(t *testing.T) {
	directory := t.TempDir()
	archive := OpenArchive(directory)
	for _, id := range []string{"aaaaaaaaaaaa", "bbbbbbbbbbbb"} {
		if err := archive.Save(keptRecord(id, id, 1, time.Now())); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "cccccccccccc.json"), []byte("ENC:not really"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, damage := range map[string]func() error{
		"missing": func() error { return os.Remove(filepath.Join(directory, "index.json")) },
		"damaged": func() error { return os.WriteFile(filepath.Join(directory, "index.json"), []byte("ENC:xx"), 0o600) },
	} {
		if err := damage(); err != nil {
			t.Fatal(err)
		}
		listed, err := OpenArchive(directory).List()
		ids := make([]string, 0, len(listed))
		for _, summary := range listed {
			ids = append(ids, summary.ID)
		}
		slices.Sort(ids)
		if err != nil || !slices.Equal(ids, []string{"aaaaaaaaaaaa", "bbbbbbbbbbbb"}) {
			t.Errorf("with the index %s, listed %v, %v", name, ids, err)
		}
	}
}

// Two writes of one conversation can race - a rename while a run ends - and
// the later in the conversation wins whichever lands last.
func TestTheLaterWriteOfAConversationWins(t *testing.T) {
	archive := OpenArchive(t.TempDir())
	if err := archive.Save(keptRecord("aaaaaaaaaaaa", "later", 9, time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := archive.Save(keptRecord("aaaaaaaaaaaa", "earlier", 4, time.Now())); err != nil {
		t.Fatal(err)
	}
	if read, _ := archive.Load("aaaaaaaaaaaa"); read.Title != "later" {
		t.Errorf("kept %q", read.Title)
	}
}

func TestPruneDeletesWhatIsPastTheCutoff(t *testing.T) {
	directory := t.TempDir()
	archive := OpenArchive(directory)
	now := time.Now()
	for id, updated := range map[string]time.Time{
		"aaaaaaaaaaaa": now.AddDate(0, 0, -40),
		"bbbbbbbbbbbb": now.AddDate(0, 0, -40),
		"cccccccccccc": now.AddDate(0, 0, -2),
	} {
		if err := archive.Save(keptRecord(id, id, 1, updated)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Prune(now.AddDate(0, 0, -30), func(id string) bool { return id == "bbbbbbbbbbbb" }); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(directory, "aaaaaaaaaaaa.json")); !os.IsNotExist(err) {
		t.Errorf("an expired conversation is still on disk: %v", err)
	}
	listed, _ := OpenArchive(directory).List()
	if len(listed) != 2 {
		t.Errorf("listed %+v", listed)
	}
}

// keeping is a world whose manager keeps conversations in an archive.
func keeping(t *testing.T) (*world, string) {
	t.Helper()
	w := newWorld(t)
	directory := filepath.Join(t.TempDir(), "sessions")
	w.manager.archive = OpenArchive(directory)
	return w, directory
}

/*
 * A conversation outlives the window: listed when it opens again, read back
 * when asked for, and carried on on the model it was written for, from the
 * history the last run left.
 */
func TestAConversationIsTakenUpAfterTheWindowCloses(t *testing.T) {
	w, directory := keeping(t)
	w.plays(says("It holds 1204."))
	session := w.send("How deep is orders?", Context{Connection: w.id})
	w.ended()
	first := w.model.chat(t, 0)
	kept, _ := first.History()

	if _, err := w.store.SaveProvider(Provider{ID: w.provider, Name: "local", Kind: provider.OpenAI, Model: "newer"},
		KeyPreserve); err != nil {
		t.Fatal(err)
	}
	reopened := NewManager(Config{Store: w.store, Services: w.services, Archive: OpenArchive(directory),
		Emit: func(event Event) { w.events <- event }})
	reopened.newChat = w.model.newChat
	summaries, err := reopened.Sessions()
	if err != nil || len(summaries) != 1 || summaries[0].ID != session || summaries[0].Open ||
		summaries[0].Title != "How deep is orders?" || summaries[0].Connection.Name != "scratch" {
		t.Fatalf("listed %+v, %v", summaries, err)
	}
	snapshot, err := reopened.Snapshot(session)
	if err != nil || len(snapshot.Items) != 2 || snapshot.Items[1].Text != "It holds 1204." || snapshot.Model != "qwen3" {
		t.Fatalf("read back %+v, %v", snapshot, err)
	}

	w.plays(says("Still 1204."))
	if err := reopened.Send(session, "And now?", Context{}); err != nil {
		t.Fatal(err)
	}
	w.ended()
	built := w.model.built[len(w.model.built)-1]
	if built.Model != "qwen3" || string(built.History) != string(kept) {
		t.Errorf("carried on as %+v from %s", built, built.History)
	}
	if last := len(w.model.chats) - 1; len(w.model.chat(t, last).said) != 1 {
		t.Errorf("the carried-on chat was told %q", w.model.chat(t, last).said)
	}
}

func TestKeepingNoneKeepsNothingAndClearsWhatWasKept(t *testing.T) {
	w, directory := keeping(t)
	w.plays(says("One."), says("Two."))
	w.send("first", Context{})
	w.ended()
	if listed, _ := w.manager.archive.List(); len(listed) != 1 {
		t.Fatalf("kept %+v", listed)
	}

	if err := w.store.SavePreferences(Preferences{Effort: EffortMedium, Writes: WritesApprove, BodyBytes: 2048,
		Retention: 0}); err != nil {
		t.Fatal(err)
	}
	if err := w.manager.Prune(); err != nil {
		t.Fatal(err)
	}
	w.send("second", Context{})
	w.ended()
	entries, _ := os.ReadDir(directory)
	for _, entry := range entries {
		if entry.Name() != "index.json" {
			t.Errorf("%s is still on disk", entry.Name())
		}
	}
}

func TestAConversationPastItsRetentionIsDeleted(t *testing.T) {
	w, directory := keeping(t)
	w.plays(says("One."))
	session := w.send("first", Context{})
	w.ended()

	later := NewManager(Config{Store: w.store, Services: w.services, Archive: OpenArchive(directory)})
	later.now = func() time.Time { return time.Now().AddDate(0, 0, 31) }
	if summaries, err := later.Sessions(); err != nil || len(summaries) != 0 {
		t.Errorf("a month-old conversation is still listed: %+v, %v", summaries, err)
	}
	if _, err := os.Stat(filepath.Join(directory, session+".json")); !os.IsNotExist(err) {
		t.Errorf("it is still on disk: %v", err)
	}
}

func TestAConversationIsRenamedAndDeleted(t *testing.T) {
	w, directory := keeping(t)
	w.plays(says("One."), func(ctx context.Context, _ func(provider.Delta)) (provider.Turn, error) {
		<-ctx.Done()
		return provider.Turn{}, ctx.Err()
	})
	session := w.send("first", Context{})
	w.ended()

	if err := w.manager.Rename(session, "  orders   backlog \n"); err != nil {
		t.Fatal(err)
	}
	renamed := w.until(func(event Event) bool { return event.Kind == EventTitle })
	if renamed.Text != "orders backlog" {
		t.Errorf("renamed to %q", renamed.Text)
	}
	if kept, _ := OpenArchive(directory).Load(session); kept.Title != "orders backlog" {
		t.Errorf("kept %q", kept.Title)
	}
	if err := w.manager.Rename(session, "   "); err == nil {
		t.Error("renamed to nothing")
	}

	if err := w.manager.Send(session, "second", Context{}); err != nil {
		t.Fatal(err)
	}
	if err := w.manager.Delete(session); err == nil {
		t.Error("deleted a conversation while it answered")
	}
	if err := w.manager.Stop(session); err != nil {
		t.Fatal(err)
	}
	w.ended()
	if err := w.manager.Delete(session); err != nil {
		t.Fatal(err)
	}
	w.until(func(event Event) bool { return event.Kind == EventGone && event.Session == session })
	if summaries := w.sessions(); len(summaries) != 0 {
		t.Errorf("still listed %+v", summaries)
	}
	if _, err := os.Stat(filepath.Join(directory, session+".json")); !os.IsNotExist(err) {
		t.Errorf("still on disk: %v", err)
	}
}

func TestClearKeepsOnlyTheConversationAnswering(t *testing.T) {
	w, _ := keeping(t)
	w.plays(says("One."), func(ctx context.Context, _ func(provider.Delta)) (provider.Turn, error) {
		<-ctx.Done()
		return provider.Turn{}, ctx.Err()
	})
	w.send("first", Context{})
	w.ended()
	answering := w.send("second", Context{})
	if err := w.manager.Clear(); err != nil {
		t.Fatal(err)
	}
	if summaries := w.sessions(); len(summaries) != 1 || summaries[0].ID != answering {
		t.Errorf("listed %+v", summaries)
	}
	if listed, _ := w.manager.archive.List(); len(listed) != 0 {
		t.Errorf("kept %+v", listed)
	}
	if err := w.manager.Stop(answering); err != nil {
		t.Fatal(err)
	}
	w.ended()
}
