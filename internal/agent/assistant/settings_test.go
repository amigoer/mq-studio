package assistant

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/agent/provider"
	"github.com/amigoer/mq-studio/internal/crypto"
)

func TestMain(m *testing.M) {
	directory, err := os.MkdirTemp("", "assistant-key-")
	if err != nil {
		panic(err)
	}
	if err := crypto.InitKey(directory); err != nil {
		panic(err)
	}
	code := m.Run()
	_ = os.RemoveAll(directory)
	os.Exit(code)
}

func storeIn(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "agent.json")
	return NewStore(path), path
}

func messagesService() Provider {
	return Provider{Name: "Anthropic", Kind: provider.Anthropic, APIKey: "sk-ant-secret", Model: "claude-opus-5-5",
		Fallback: true}
}

func TestANewStoreHasNothingConfiguredAndSensibleDefaults(t *testing.T) {
	store, path := storeIn(t)
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.Providers) != 0 || settings.Effort != EffortMedium || settings.Writes != WritesApprove ||
		settings.BodyBytes != 2048 {
		t.Errorf("a new store holds %+v", settings)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("reading the settings wrote the file")
	}
}

// The key is what all of this exists to protect: it is never on disk as
// typed, it comes back whole, and nothing else about the file hides it.
func TestAKeyIsStoredEncryptedAndReadBackWhole(t *testing.T) {
	store, path := storeIn(t)
	saved, err := store.SaveProvider(messagesService(), KeyReplace)
	if err != nil {
		t.Fatal(err)
	}
	if saved.ID == "" || saved.APIKey != "sk-ant-secret" {
		t.Fatalf("saved %+v", saved)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "sk-ant-secret") {
		t.Fatalf("the key is on disk as typed: %s", data)
	}
	if !strings.Contains(string(data), `"apiKey": "ENC:`) {
		t.Errorf("the key is not stored encrypted: %s", data)
	}
	if runtime.GOOS != "windows" {
		if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
			t.Errorf("agent.json is %v, readable by more than its owner", info.Mode().Perm())
		}
	}

	reopened, found, err := NewStore(path).Provider(saved.ID)
	if err != nil || !found {
		t.Fatalf("reopen: %v %v", found, err)
	}
	if reopened != saved {
		t.Errorf("read back %+v, saved %+v", reopened, saved)
	}
}

// A key copied from one provider's entry onto another's is someone editing
// the file, and decrypting it anyway would hand one service another's key.
func TestAKeyMovedToAnotherProviderDoesNotDecrypt(t *testing.T) {
	store, path := storeIn(t)
	first, err := store.SaveProvider(messagesService(), KeyReplace)
	if err != nil {
		t.Fatal(err)
	}
	second := messagesService()
	second.Name, second.APIKey = "Gateway", "sk-ant-other"
	if _, err := store.SaveProvider(second, KeyReplace); err != nil {
		t.Fatal(err)
	}

	data, _ := os.ReadFile(path)
	var stored file
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	stored.Providers[1].APIKey = stored.Providers[0].APIKey
	tampered, _ := json.Marshal(stored)
	if err := os.WriteFile(path, tampered, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(path).Settings(); err == nil {
		t.Fatalf("%s's key decrypted as the gateway's", first.Name)
	}
}

// An edit form shows whether a key is set, never the key, so a blank one on
// save keeps what is there; replacing and clearing are said outright.
func TestAKeyIsKeptReplacedOrClearedAsAsked(t *testing.T) {
	store, _ := storeIn(t)
	saved, err := store.SaveProvider(messagesService(), KeyReplace)
	if err != nil {
		t.Fatal(err)
	}

	edit := saved
	edit.Name, edit.APIKey = "Renamed", ""
	kept, err := store.SaveProvider(edit, KeyPreserve)
	if err != nil || kept.APIKey != "sk-ant-secret" || kept.Name != "Renamed" {
		t.Fatalf("preserve: %+v %v", kept, err)
	}

	edit.APIKey = "sk-ant-new"
	replaced, err := store.SaveProvider(edit, KeyReplace)
	if err != nil || replaced.APIKey != "sk-ant-new" {
		t.Fatalf("replace: %+v %v", replaced, err)
	}

	edit.APIKey = ""
	if _, err := store.SaveProvider(edit, KeyReplace); err == nil {
		t.Error("an empty replacement was taken as a key")
	}
	// The Messages API takes no call without a key, so clearing it leaves a
	// service that cannot be saved; one that speaks the compatible protocol can.
	if _, err := store.SaveProvider(edit, KeyClear); err == nil {
		t.Error("a Messages API service was saved with no key")
	}
	local, err := store.SaveProvider(Provider{Name: "Ollama", Kind: provider.OpenAI,
		BaseURL: "http://127.0.0.1:11434/v1", Model: "qwen3:14b", APIKey: "ignored"}, KeyClear)
	if err != nil || local.APIKey != "" {
		t.Errorf("a keyless local runner: %+v %v", local, err)
	}
}

func TestAProviderIsRefusedWhatItCouldNotUse(t *testing.T) {
	store, _ := storeIn(t)
	for name, change := range map[string]func(*Provider){
		"no name":          func(p *Provider) { p.Name = "  " },
		"a long name":      func(p *Provider) { p.Name = strings.Repeat("名", 65) },
		"no model":         func(p *Provider) { p.Model = "" },
		"no protocol":      func(p *Provider) { p.Kind = "grpc" },
		"a relative URL":   func(p *Provider) { p.BaseURL = "api.example.com" },
		"a file URL":       func(p *Provider) { p.BaseURL = "file:///etc/passwd" },
		"an ftp proxy":     func(p *Provider) { p.Proxy = "ftp://proxy.example:21" },
		"a hostless proxy": func(p *Provider) { p.Proxy = "socks5://" },
	} {
		p := messagesService()
		change(&p)
		if _, err := store.SaveProvider(p, KeyReplace); err == nil {
			t.Errorf("%s was saved", name)
		}
	}
	settings, _ := store.Settings()
	if len(settings.Providers) != 0 {
		t.Errorf("a refused save left %+v", settings.Providers)
	}
}

// A key issued for one protocol means nothing to the other, so changing a
// provider's protocol would send it where it does not belong.
func TestAProviderKeepsItsProtocol(t *testing.T) {
	store, _ := storeIn(t)
	saved, err := store.SaveProvider(messagesService(), KeyReplace)
	if err != nil {
		t.Fatal(err)
	}
	saved.Kind = provider.OpenAI
	if _, err := store.SaveProvider(saved, KeyPreserve); err == nil {
		t.Error("a Messages API service turned into a compatible one")
	}
	saved.ID = "nonesuch"
	saved.Kind = provider.Anthropic
	if _, err := store.SaveProvider(saved, KeyPreserve); err == nil {
		t.Error("an id nothing has was saved as a change")
	}
}

func TestDeletingTheDefaultFallsBackToNone(t *testing.T) {
	store, path := storeIn(t)
	first, _ := store.SaveProvider(messagesService(), KeyReplace)
	second, _ := store.SaveProvider(Provider{Name: "Ollama", Kind: provider.OpenAI, Model: "qwen3:14b"}, KeyClear)
	if err := store.SavePreferences(Preferences{Default: second.ID, Effort: EffortHigh, Writes: WritesReadOnly,
		BodyBytes: 0}); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteProvider(second.ID); err != nil {
		t.Fatal(err)
	}
	settings, err := NewStore(path).Settings()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.Providers) != 1 || settings.Providers[0].ID != first.ID {
		t.Errorf("left %+v", settings.Providers)
	}
	if settings.Default != "" || settings.Effort != EffortHigh || settings.Writes != WritesReadOnly || settings.BodyBytes != 0 {
		t.Errorf("preferences after the delete: %+v", settings)
	}
	if err := store.DeleteProvider(second.ID); err == nil {
		t.Error("a provider was deleted twice")
	}
}

// Agreeing to one service is not agreeing to another, and a service deleted
// and added again has to be agreed to again.
func TestConsentIsPerServiceAndGoesWithIt(t *testing.T) {
	store, path := storeIn(t)
	cloud, _ := store.SaveProvider(messagesService(), KeyReplace)
	local, _ := store.SaveProvider(Provider{Name: "Ollama", Kind: provider.OpenAI, Model: "qwen3:14b"}, KeyClear)
	if err := store.Consent(local.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.Consent(local.ID); err != nil {
		t.Fatalf("agreeing twice: %v", err)
	}
	if err := store.Consent("nonesuch"); err == nil {
		t.Error("agreed to a service that does not exist")
	}
	settings, err := NewStore(path).Settings()
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(settings.Consented, []string{local.ID}) {
		t.Fatalf("read back %v, want only %s and not %s", settings.Consented, local.ID, cloud.ID)
	}

	if err := store.DeleteProvider(local.ID); err != nil {
		t.Fatal(err)
	}
	again, _ := store.SaveProvider(Provider{Name: "Ollama", Kind: provider.OpenAI, Model: "qwen3:14b"}, KeyClear)
	if settings, _ := NewStore(path).Settings(); len(settings.Consented) != 0 {
		t.Errorf("after deleting it and adding %s again, still agreed to %v", again.ID, settings.Consented)
	}
}

// Keeping nothing is a choice, and is not the same as a file written before
// there was a choice, which keeps the default.
func TestRetentionKeepsItsZero(t *testing.T) {
	store, path := storeIn(t)
	if settings, _ := store.Settings(); settings.Retention != 30 {
		t.Errorf("a new store keeps %d days", settings.Retention)
	}
	if err := os.WriteFile(path, []byte(`{"version":1,"providers":[],"effort":"low","writes":"approve","bodyBytes":0}`),
		0o600); err != nil {
		t.Fatal(err)
	}
	if settings, _ := NewStore(path).Settings(); settings.Retention != 30 || settings.Effort != EffortLow {
		t.Errorf("a file from before the setting keeps %d days", settings.Retention)
	}
	store = NewStore(path)
	if err := store.SavePreferences(Preferences{Effort: EffortLow, Writes: WritesApprove, Retention: 0}); err != nil {
		t.Fatal(err)
	}
	if settings, _ := NewStore(path).Settings(); settings.Retention != 0 {
		t.Errorf("keeping nothing read back as %d days", settings.Retention)
	}
}

func TestPreferencesAreOnlyWhatIsOffered(t *testing.T) {
	store, _ := storeIn(t)
	for name, preferences := range map[string]Preferences{
		"an unknown default":     {Default: "nonesuch", Effort: EffortLow, Writes: WritesApprove, BodyBytes: 2048},
		"an unknown effort":      {Effort: "max", Writes: WritesApprove, BodyBytes: 2048},
		"an unknown writes":      {Effort: EffortLow, Writes: "always", BodyBytes: 2048},
		"an unoffered limit":     {Effort: EffortLow, Writes: WritesApprove, BodyBytes: 1000},
		"an unoffered retention": {Effort: EffortLow, Writes: WritesApprove, BodyBytes: 2048, Retention: 45},
	} {
		if err := store.SavePreferences(preferences); err == nil {
			t.Errorf("%s was saved", name)
		}
	}
}

// A file this version cannot read is refused rather than overwritten, so a
// downgrade does not throw away what a newer version saved.
func TestAFileFromANewerVersionIsNotTouched(t *testing.T) {
	store, path := storeIn(t)
	if err := os.WriteFile(path, []byte(`{"version":2,"providers":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveProvider(messagesService(), KeyReplace); err == nil {
		t.Fatal("a newer file was overwritten")
	}
	data, _ := os.ReadFile(path)
	if string(data) != `{"version":2,"providers":[]}` {
		t.Errorf("the file became %s", data)
	}
}
