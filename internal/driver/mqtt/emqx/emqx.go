// Package emqx reads EMQX's HTTP management API.
//
// It exists because MQTT itself has no administrative plane: the protocol can
// publish, subscribe and report a broker's own $SYS counters, and cannot
// enumerate who is connected, what they subscribed to, or end a session. EMQX
// answers all three over HTTP, and so do its peers, so a driver that probes
// for one gets a management plane on the deployments that have it and says so
// on the ones that do not.
//
// Scope is deliberately narrow. This is the read side an operator needs to see
// a broker's clients, plus the one write worth having - ending a session -
// rather than a wrapper over the whole API. EMQX's configuration, rule engine
// and authentication chains are its own dashboard's job.
package emqx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// apiPath is the base every request goes under. EMQX 5 introduced it and EMQX
// 6 kept it, so the version in the path is the API's rather than the broker's.
const apiPath = "/api/v5"

// maxPage bounds one listing. EMQX pages its own listings and a console asking
// for everything on a broker holding a million sessions would be asking the
// broker to serialise all of them.
const maxPage = 500

// ErrUnauthorised is a rejected API key, kept apart from every other failure
// because it is the one an operator fixes in this app rather than on the
// broker.
var ErrUnauthorised = errors.New("emqx rejected the api key")

// ErrNotFound is a resource that is not there - a client id that has already
// disconnected, most often.
var ErrNotFound = errors.New("emqx has no such resource")

// Client talks to one EMQX management endpoint.
type Client struct {
	endpoint string
	key      string
	secret   string
	http     *http.Client
}

// New builds a client. The endpoint is the dashboard's address, with or
// without the /api/v5 suffix: operators copy whichever their notes have.
func New(endpoint, key, secret string, timeout time.Duration) (*Client, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return nil, fmt.Errorf("management endpoint cannot be empty")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "http://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, fmt.Errorf("management endpoint %q is not a url: %w", endpoint, err)
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("management endpoint %q names no host", endpoint)
	}
	base := strings.TrimSuffix(parsed.Scheme+"://"+parsed.Host+parsed.Path, "/")
	base = strings.TrimSuffix(base, apiPath)

	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Client{
		endpoint: base,
		key:      key,
		secret:   secret,
		// The per-request context carries the real deadline; this is the
		// backstop for a caller that passes none.
		http: &http.Client{Timeout: timeout},
	}, nil
}

// Endpoint is the base address, for reporting which one answered.
func (c *Client) Endpoint() string { return c.endpoint }

// Status reports whether the endpoint answers this credential.
//
// It reads /nodes rather than /status, which is deliberate: /status answers
// without authentication, so a probe against it would pass with a wrong API
// key and every later call would fail.
func (c *Client) Status(ctx context.Context) error {
	_, err := c.Nodes(ctx)
	return err
}

// Nodes is the cluster's members.
func (c *Client) Nodes(ctx context.Context) ([]Node, error) {
	return getList[Node](ctx, c, "/nodes", nil)
}

// Stats is the per-node counters the overview reads.
func (c *Client) Stats(ctx context.Context) ([]Stats, error) {
	return getList[Stats](ctx, c, "/stats", nil)
}

// Metrics is the per-node throughput counters.
func (c *Client) Metrics(ctx context.Context) ([]Metrics, error) {
	return getList[Metrics](ctx, c, "/metrics", nil)
}

// Clients is who is connected, newest page first.
func (c *Client) Clients(ctx context.Context, limit int) ([]ClientInfo, error) {
	return getPaged[ClientInfo](ctx, c, "/clients", limit)
}

// ClientsByUsername is every session one username holds. The broker filters,
// rather than this app paging the whole list and matching: a username with two
// sessions on a broker holding thousands would mean fetching all of them.
func (c *Client) ClientsByUsername(ctx context.Context, username string) ([]ClientInfo, error) {
	query := url.Values{
		"username": {username},
		"limit":    {strconv.Itoa(maxPage)},
		"page":     {"1"},
	}
	var page struct {
		Data []ClientInfo `json:"data"`
	}
	if err := c.getInto(ctx, "/clients", query, &page); err != nil {
		return nil, err
	}
	return page.Data, nil
}

// Subscriptions is every topic filter the broker is holding.
func (c *Client) Subscriptions(ctx context.Context, limit int) ([]Subscription, error) {
	return getPaged[Subscription](ctx, c, "/subscriptions", limit)
}

// RetainedMessages is every topic the broker is holding a last-known value
// for, which is the only list of topics MQTT can produce at all.
//
// It answers where subscribing to # does not: EMQX's default authorisation
// denies a subscription to exactly "#", so the protocol-level discovery this
// driver falls back to is refused on a stock EMQX.
func (c *Client) RetainedMessages(ctx context.Context, limit int) ([]RetainedMessage, error) {
	return getPaged[RetainedMessage](ctx, c, "/mqtt/retainer/messages", limit)
}

// ClientSubscriptions is one client's filters.
func (c *Client) ClientSubscriptions(ctx context.Context, clientID string) ([]Subscription, error) {
	return getList[Subscription](ctx, c, "/clients/"+url.PathEscape(clientID)+"/subscriptions", nil)
}

// Kick ends one client's session.
//
// EMQX answers 204 whether or not the client was there, so a caller cannot
// tell "disconnected it" from "it had already gone" - which is fine for the
// operation's purpose and worth not pretending otherwise about.
func (c *Client) Kick(ctx context.Context, clientID string) error {
	request, err := c.request(ctx, http.MethodDelete, "/clients/"+url.PathEscape(clientID), nil)
	if err != nil {
		return err
	}
	body, err := c.do(request)
	if err != nil {
		return err
	}
	_ = body
	return nil
}

// getPaged reads one page of a paginated listing.
func getPaged[T any](ctx context.Context, c *Client, path string, limit int) ([]T, error) {
	if limit <= 0 || limit > maxPage {
		limit = maxPage
	}
	query := url.Values{"limit": {strconv.Itoa(limit)}, "page": {"1"}}

	var page struct {
		Data []T `json:"data"`
	}
	if err := c.getInto(ctx, path, query, &page); err != nil {
		return nil, err
	}
	return page.Data, nil
}

// getList reads an endpoint that answers a bare array.
func getList[T any](ctx context.Context, c *Client, path string, query url.Values) ([]T, error) {
	var list []T
	if err := c.getInto(ctx, path, query, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func (c *Client) getInto(ctx context.Context, path string, query url.Values, into any) error {
	request, err := c.request(ctx, http.MethodGet, path, query)
	if err != nil {
		return err
	}
	body, err := c.do(request)
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("emqx answered %s with something that is not %T: %w", path, into, err)
	}
	return nil
}

func (c *Client) request(ctx context.Context, method, path string, query url.Values) (*http.Request, error) {
	address := c.endpoint + apiPath + path
	if len(query) > 0 {
		address += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, method, address, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	// EMQX takes an API key and its secret as ordinary basic auth. A dashboard
	// login would return a bearer token instead, and is not used: it expires,
	// and a console that has to re-login mid-session is a console that fails
	// at the least convenient moment.
	if c.key != "" {
		request.SetBasicAuth(c.key, c.secret)
	}
	return request, nil
}

func (c *Client) do(request *http.Request) ([]byte, error) {
	response, err := c.http.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}

	switch {
	case response.StatusCode == http.StatusUnauthorized,
		response.StatusCode == http.StatusForbidden:
		return nil, ErrUnauthorised
	case response.StatusCode == http.StatusNotFound:
		return nil, ErrNotFound
	case response.StatusCode >= 400:
		// EMQX puts a code and a message in the body; showing it beats showing
		// a bare status, because it names the field it did not like.
		return nil, fmt.Errorf("emqx answered %s: %s",
			response.Status, strings.TrimSpace(string(body)))
	}
	return body, nil
}
