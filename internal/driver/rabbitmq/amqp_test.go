package rabbitmq

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestAmqpAddressDerivesTheHostFromTheManagementUrl(t *testing.T) {
	uri, err := amqpAddress("", "http://broker.internal:15672", "/", "user", "pass", false)
	if err != nil {
		t.Fatalf("amqpAddress: %v", err)
	}
	if uri.Host != "broker.internal" {
		t.Errorf("host = %q, want the management host", uri.Host)
	}
	// The management port must not carry over: the two planes are two
	// listeners and 15672 speaks HTTP.
	if uri.Port != 5672 {
		t.Errorf("port = %d, want the AMQP default 5672", uri.Port)
	}
	if uri.Scheme != "amqp" {
		t.Errorf("scheme = %q", uri.Scheme)
	}
}

func TestAmqpAddressDerivesTheTlsPortWhenTlsIsOn(t *testing.T) {
	uri, err := amqpAddress("", "https://broker.internal:15671", "/", "user", "pass", true)
	if err != nil {
		t.Fatalf("amqpAddress: %v", err)
	}
	if uri.Scheme != "amqps" || uri.Port != 5671 {
		t.Errorf("got %s://%s:%d, want amqps on 5671", uri.Scheme, uri.Host, uri.Port)
	}
}

func TestAmqpAddressAcceptsWhatUsersActuallyType(t *testing.T) {
	cases := []struct {
		raw  string
		host string
		port int
	}{
		{"amqp://rabbit:5672", "rabbit", 5672},
		{"rabbit:5672", "rabbit", 5672},
		{"rabbit", "rabbit", 5672},
		{"amqp://rabbit", "rabbit", 5672},
		{"192.168.1.9:5673", "192.168.1.9", 5673},
	}
	for _, testCase := range cases {
		t.Run(testCase.raw, func(t *testing.T) {
			uri, err := amqpAddress(testCase.raw, "http://x:15672", "/", "u", "p", false)
			if err != nil {
				t.Fatalf("amqpAddress(%q): %v", testCase.raw, err)
			}
			if uri.Host != testCase.host || uri.Port != testCase.port {
				t.Errorf("got %s:%d, want %s:%d", uri.Host, uri.Port, testCase.host, testCase.port)
			}
		})
	}
}

// The switch is the authority. A profile that turns TLS on after the address
// was typed must not keep connecting in plaintext.
func TestTlsSwitchOverridesTheSchemeInTheAddress(t *testing.T) {
	uri, err := amqpAddress("amqp://rabbit:5672", "http://x:15672", "/", "u", "p", true)
	if err != nil {
		t.Fatalf("amqpAddress: %v", err)
	}
	if uri.Scheme != "amqps" {
		t.Errorf("scheme = %q, want amqps", uri.Scheme)
	}
	if uri.Port != 5671 {
		t.Errorf("port = %d, want the plain default swapped for the TLS one", uri.Port)
	}

	// An explicitly non-default port is the user's choice and stays put.
	kept, err := amqpAddress("amqp://rabbit:9999", "http://x:15672", "/", "u", "p", true)
	if err != nil {
		t.Fatalf("amqpAddress: %v", err)
	}
	if kept.Port != 9999 {
		t.Errorf("port = %d, want the explicit 9999 kept", kept.Port)
	}
}

func TestAmqpAddressCarriesCredentialsAndVhost(t *testing.T) {
	uri, err := amqpAddress("rabbit:5672", "http://x:15672", "orders", "alice", "s3cret", false)
	if err != nil {
		t.Fatalf("amqpAddress: %v", err)
	}
	if uri.Username != "alice" || uri.Password != "s3cret" {
		t.Errorf("credentials = %q/%q", uri.Username, uri.Password)
	}
	if uri.Vhost != "orders" {
		t.Errorf("vhost = %q, want orders", uri.Vhost)
	}
}

func TestAmqpAddressRejectsAManagementUrlWithNoHost(t *testing.T) {
	if _, err := amqpAddress("", "not a url at all", "/", "u", "p", false); err == nil {
		t.Fatal("a management address with no host was accepted")
	}
}

// The URI holds the password, so it must not reach a message a user can see.
func TestDataPlaneErrorsDoNotLeakThePassword(t *testing.T) {
	uri, err := amqpAddress("127.0.0.1:1", "http://x:15672", "/", "alice", "hunter2", false)
	if err != nil {
		t.Fatalf("amqpAddress: %v", err)
	}
	plane := newDataPlane(uri, connectionName("test"), nil, 500*time.Millisecond)
	defer plane.close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	dialErr := plane.ping(ctx)
	if dialErr == nil {
		t.Fatal("dialling a closed port succeeded")
	}
	if strings.Contains(dialErr.Error(), "hunter2") {
		t.Errorf("the password reached an error message: %v", dialErr)
	}
	if !strings.Contains(dialErr.Error(), "127.0.0.1:1") {
		t.Errorf("the error names no address: %v", dialErr)
	}
}

func TestConnectionNameCarriesTheProfile(t *testing.T) {
	if got := connectionName("rabbit-staging"); got != "mq-studio: rabbit-staging" {
		t.Errorf("connectionName = %q", got)
	}
	// An unnamed profile still identifies the app, which is the part an
	// operator staring at the broker's connection list needs.
	if got := connectionName("   "); got != clientName {
		t.Errorf("connectionName on a blank name = %q, want %q", got, clientName)
	}
}
