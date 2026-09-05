package connection

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// The switcher's whole job: one option changes and the open client is dialled
// again with it. Nothing else on the profile may move.
func TestSetOptionRedialsAnOpenConnection(t *testing.T) {
	service := newTestService(t, nil)
	var resolved model.ConnectionProfile
	runtime := newRecordingRuntime()
	service.runtime = &capturingRuntime{recordingRuntime: runtime, seen: &resolved}

	input := profileOf("p", "", "ns:9876", 5, true, "ak", "sk", "note")
	input.SetOption("namespace", "before")
	profile, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Connect(profile.ID); err != nil {
		t.Fatal(err)
	}

	updated, err := service.SetOption(profile.ID, "namespace", "after")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Option("namespace") != "after" {
		t.Fatalf("stored namespace = %q, want the new one", updated.Option("namespace"))
	}
	if updated.Status != model.StatusOnline {
		t.Fatalf("status = %q, want the reconnect to have completed", updated.Status)
	}
	if resolved.Option("namespace") != "after" {
		t.Fatalf("runtime dialled with namespace %q", resolved.Option("namespace"))
	}
	// The credentials are the reason this is not a form submission.
	if updated.Secret(model.SecretAccessKey) != "ak" || updated.Secret(model.SecretSecretKey) != "sk" {
		t.Fatalf("credentials did not survive the switch: %v", updated.ConfiguredSecrets())
	}
	if updated.Name != "p" || updated.Remark != "note" || updated.Endpoints != "ns:9876" {
		t.Fatalf("the switch moved something else: %#v", updated)
	}
}

// An empty value is the unscoped connection, and has to leave nothing behind:
// Option cannot tell a stored blank from an absent key.
func TestSetOptionClearsRatherThanStoresABlank(t *testing.T) {
	service := newTestService(t, nil)
	input := profileOf("p", "", "ns:9876", 5, false, "", "", "")
	input.SetOption("namespace", "ns")
	profile, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}

	updated, err := service.SetOption(profile.ID, "namespace", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, present := updated.Options["namespace"]; present {
		t.Fatalf("options kept the key: %v", updated.Options)
	}
}

// Re-picking what is already set must not cost the user their connection.
func TestSetOptionToTheCurrentValueKeepsTheClient(t *testing.T) {
	service := newTestService(t, nil)
	runtime := newRecordingRuntime()
	service.runtime = runtime

	input := profileOf("p", "", "ns:9876", 5, false, "", "", "")
	input.SetOption("namespace", "ns")
	profile, err := service.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Connect(profile.ID); err != nil {
		t.Fatal(err)
	}

	updated, err := service.SetOption(profile.ID, "namespace", "ns")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Status != model.StatusOnline {
		t.Fatalf("status = %q, want the client left alone", updated.Status)
	}
	if len(runtime.openIDs()) != 1 {
		t.Fatalf("open clients = %v, want the one that was already open", runtime.openIDs())
	}
}
