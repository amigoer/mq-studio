// Package provider reaches the model services the assistant runs on, in the
// two protocols it speaks: the Messages API of the Claude models, and the
// OpenAI-compatible chat completions most other services and local runners
// expose.
//
// Every request carries only what the person configured in the window. The
// Messages API SDK reads credentials, base URLs and extra headers from the
// environment and from configuration files of its own by default, and none of
// that is used here: a key exported in a shell for another tool is never
// spent, and nothing meant for one service reaches another.
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Kind is the protocol a model service speaks.
type Kind string

const (
	// Anthropic is the Messages API.
	Anthropic Kind = "anthropic"
	// OpenAI is the OpenAI chat completions protocol, as OpenAI and the many
	// services and local runners compatible with it serve it.
	OpenAI Kind = "openai"
)

// Valid reports whether k is a protocol this package speaks.
func (k Kind) Valid() bool {
	return k == Anthropic || k == OpenAI
}

// Endpoint is how to reach one model service.
type Endpoint struct {
	Kind Kind
	// BaseURL is where the service is. Empty is the service's own address.
	BaseURL string
	// APIKey may be empty for a local runner that takes none.
	APIKey string
	// Proxy routes the requests, as a URL; empty uses the HTTPS_PROXY family
	// of environment variables, which is how a proxy reaches Go programs.
	Proxy string
	// Fallback asks the service to answer a request one model declined with
	// another, where the model supports it. Messages API only.
	Fallback bool
}

// Model is one model a service offers.
type Model struct {
	ID string `json:"id"`
	// Name is the service's display name for it, where it gives one.
	Name string `json:"name,omitempty"`
}

// Check is what a test of an endpoint found.
type Check struct {
	Model   string
	Elapsed time.Duration
}

// Reason is why a call to a model service failed, as a person can act on it.
type Reason string

const (
	// ReasonAuth is a key the service refused, or one it needed and did not get.
	ReasonAuth Reason = "auth"
	// ReasonNotFound is a model the service does not have, or an address that
	// is not the service.
	ReasonNotFound Reason = "notFound"
	// ReasonRejected is a request the service would not take as sent - a
	// model that takes no tools, or a gateway that does not pass an option on.
	ReasonRejected Reason = "rejected"
	// ReasonRateLimited is the service turning requests away for now.
	ReasonRateLimited Reason = "rateLimited"
	// ReasonServer is the service failing on its side.
	ReasonServer Reason = "server"
	// ReasonUnreachable is no answer at all: a wrong address, a proxy that is
	// down, a network that does not reach the service.
	ReasonUnreachable Reason = "unreachable"
	// ReasonTimeout is an answer that did not arrive in time.
	ReasonTimeout Reason = "timeout"
	// ReasonUnlisted is a service that does not list its models, which is not
	// the same as having none: its model ids can still be typed in.
	ReasonUnlisted Reason = "unlisted"
)

// Failure is a failed call, classified.
type Failure struct {
	Reason Reason
	// Status is the HTTP status the service answered with, 0 when it did not.
	Status int
	// Detail is the service's own words for it, or the transport's.
	Detail string
}

func (f *Failure) Error() string {
	if f.Status != 0 {
		return fmt.Sprintf("%s (%d): %s", f.Reason, f.Status, f.Detail)
	}
	return fmt.Sprintf("%s: %s", f.Reason, f.Detail)
}

// Models lists the models the service offers.
func Models(ctx context.Context, endpoint Endpoint) ([]Model, error) {
	client, err := httpClient(endpoint.Proxy)
	if err != nil {
		return nil, err
	}
	switch endpoint.Kind {
	case Anthropic:
		return anthropicModels(ctx, endpoint, client)
	case OpenAI:
		return openAIModels(ctx, endpoint, client)
	}
	return nil, fmt.Errorf("%q is not a protocol this application speaks", endpoint.Kind)
}

/*
 * Probe sends the service one small request carrying a tool, the way every
 * request the assistant makes will carry its tools.
 *
 * A model that takes no tools is no use to the assistant whatever else it can
 * do, and a gateway that refuses an option the assistant sends is no use
 * either - so this is the request shape, not a ping. It costs a few hundred
 * tokens, which is the price of finding out here rather than mid-conversation.
 */
func Probe(ctx context.Context, endpoint Endpoint, model string) (Check, error) {
	model = strings.TrimSpace(model)
	if model == "" {
		return Check{}, errors.New("name the model to test")
	}
	client, err := httpClient(endpoint.Proxy)
	if err != nil {
		return Check{}, err
	}
	began := time.Now()
	switch endpoint.Kind {
	case Anthropic:
		err = anthropicProbe(ctx, endpoint, client, model)
	case OpenAI:
		err = openAIProbe(ctx, endpoint, client, model)
	default:
		err = fmt.Errorf("%q is not a protocol this application speaks", endpoint.Kind)
	}
	if err != nil {
		return Check{}, err
	}
	return Check{Model: model, Elapsed: time.Since(began)}, nil
}

// probeTool and probePrompt are what Probe sends. The tool does nothing; it
// is there so the request carries one.
const (
	probeTool        = "report_ready"
	probeDescription = "Report that this connection works. Takes no arguments."
	probePrompt      = "This is a connection test. Reply with the single word OK."
)

/*
 * httpClient is the transport for one service.
 *
 * It sets no overall timeout. http.Client.Timeout covers reading the whole
 * body, and a streamed answer is read for as long as the model writes it, so
 * that bound would cut answers off mid-sentence. The three that remain bound
 * what can hang without anything arriving: the dial, the TLS handshake and the
 * wait for the response headers. A call is bounded by its context.
 */
func httpClient(proxy string) (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	if proxy = strings.TrimSpace(proxy); proxy != "" {
		parsed, err := url.Parse(proxy)
		if err != nil || parsed.Host == "" {
			return nil, fmt.Errorf("%q is not a proxy address", proxy)
		}
		switch parsed.Scheme {
		case "http", "https", "socks5", "socks5h":
		default:
			return nil, fmt.Errorf("%q is not a proxy address: it has to start with http, https or socks5", proxy)
		}
		transport.Proxy = http.ProxyURL(parsed)
	}
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = dialer.DialContext
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ResponseHeaderTimeout = 90 * time.Second
	return &http.Client{Transport: transport}, nil
}

// classify turns an SDK's error into a Failure. status and body are the HTTP
// status and response the service answered with, when it answered at all.
func classify(err error, status int, body string) error {
	if err == nil {
		return nil
	}
	if status == 0 {
		var netErr net.Error
		switch {
		case errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()):
			return &Failure{Reason: ReasonTimeout, Detail: err.Error()}
		case errors.Is(err, context.Canceled):
			return err
		}
		return &Failure{Reason: ReasonUnreachable, Detail: err.Error()}
	}
	failure := &Failure{Status: status, Detail: serviceMessage(body)}
	switch {
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		failure.Reason = ReasonAuth
	case status == http.StatusNotFound:
		failure.Reason = ReasonNotFound
	case status == http.StatusTooManyRequests:
		failure.Reason = ReasonRateLimited
	case status >= 500:
		failure.Reason = ReasonServer
	default:
		failure.Reason = ReasonRejected
	}
	return failure
}

// serviceMessage is the message an error response carries. Both protocols
// put it at error.message; a gateway that answers with something else is
// quoted as it answered, cut short.
func serviceMessage(body string) string {
	var envelope struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if json.Unmarshal([]byte(body), &envelope) == nil {
		if envelope.Error.Message != "" {
			return envelope.Error.Message
		}
		if envelope.Message != "" {
			return envelope.Message
		}
	}
	body = strings.TrimSpace(body)
	if len(body) > 300 {
		body = body[:300] + "..."
	}
	return body
}
