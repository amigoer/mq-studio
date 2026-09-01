// Package e2e gates the tests that need a real broker.
//
// It is imported only from _test.go files. It exists because the rule it
// carries was written four times, once per package, and the copies disagreed:
// two of them consulted the opt-in variable before probing anything, so the
// whole app-layer suite skipped every CI run from the day it was written
// (issue #48).
package e2e

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"testing"
	"time"
)

// OptIn is the variable a developer sets to run the live suites locally.
const OptIn = "MQ_STUDIO_E2E"

// probeTimeout is how long an environment has to answer that it is there. It
// is not how long the tests then give it to work.
const probeTimeout = 2 * time.Second

// Env is one broker environment a live test needs.
type Env struct {
	// Name reads inside a sentence: "kafka is not running".
	Name string
	// Start is the npm script that brings it up.
	Start string
	// Probe reports whether the environment is answering.
	Probe func() error
}

// verdict is what the gate decided to do with a test.
type verdict int

const (
	run        verdict = iota
	skipOptOut         // locally, and the developer did not ask for the live suites
	skipAbsent         // locally, and the environment is not up
	failAbsent         // in CI, where an absent environment is the run's problem
)

// decide is the policy, kept apart from testing.T so it can be pinned by a
// test of its own rather than only by the CI run it governs.
//
// Locally the suites are opt-in, so a plain `go test ./...` stays offline and
// quick whether or not the brokers happen to be up. In CI the opt-in is not
// consulted at all: the workflow starts every environment, so an absent one is
// a failure, and no variable anybody forgot to set can be the reason a suite
// did not run. That last clause is the whole fix - reading the opt-in first is
// what kept the app-layer suite silent in every CI run (#48).
//
// It returns the probe's error too, so the caller reports what it saw without
// probing a second time.
func decide(ci bool, optIn string, probe func() error) (verdict, error) {
	if !ci && optIn == "" {
		return skipOptOut, nil
	}
	switch err := probe(); {
	case err == nil:
		return run, nil
	case ci:
		return failAbsent, err
	default:
		return skipAbsent, err
	}
}

// Require skips the test when env is absent, and fails instead when CI is set.
func Require(t *testing.T, env Env) {
	t.Helper()
	switch decision, err := decide(inCI(), os.Getenv(OptIn), env.Probe); decision {
	case skipOptOut:
		t.Skipf("set %s=1 and run `%s` to exercise %s", OptIn, env.Start, env.Name)
	case skipAbsent:
		t.Skipf("%s is not running; start it with `%s` (%v)", env.Name, env.Start, err)
	case failAbsent:
		t.Fatalf("%s must be running in CI: %v", env.Name, err)
	}
}

// Missing reports a precondition the environment answered the probe but did
// not provide - an unseeded group, a broker that then refused the connection.
// Same rule as Require: a failure in CI, a skip with the remedy locally.
func Missing(t *testing.T, format string, args ...any) {
	t.Helper()
	if inCI() {
		t.Fatalf(format, args...)
	}
	t.Skipf(format, args...)
}

func inCI() bool { return os.Getenv("CI") != "" }

// DialTCP probes an environment by opening a connection to one of its ports.
func DialTCP(address string) func() error {
	return func() error {
		conn, err := net.DialTimeout("tcp", address, probeTimeout)
		if err != nil {
			return err
		}
		return conn.Close()
	}
}

// HTTPGet probes an environment through its management API.
func HTTPGet(url string) func() error {
	return func() error {
		client := &http.Client{Timeout: probeTimeout}
		response, err := client.Get(url)
		if err != nil {
			return err
		}
		return response.Body.Close()
	}
}

// DockerContainer probes an environment the test drives with docker exec
// rather than over the wire, where a reachable port is not enough.
func DockerContainer(name string) func() error {
	return func() error {
		if err := exec.Command("docker", "inspect", name).Run(); err != nil {
			return fmt.Errorf("docker inspect %s: %w", name, err)
		}
		return nil
	}
}
