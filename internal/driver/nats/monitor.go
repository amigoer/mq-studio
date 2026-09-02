package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// monitorClient reads the server's HTTP monitoring endpoint.
//
// It answers for exactly one server - the one whose port the form named - and
// that is the whole difference between it and the system account, which fans a
// request out to every server in the cluster. Where both are configured the
// system account is the better source; where only this one is, a single-server
// answer is still better than none.
//
// Plain net/http rather than a library: these are documented JSON documents on
// documented paths, and the only thing a client would add is a second set of
// structs to keep in step with the server's.
type monitorClient struct {
	base string
	http *http.Client
}

func newMonitorClient(base string, timeout time.Duration) *monitorClient {
	if timeout <= 0 {
		timeout = defaultDialTimeout
	}
	return &monitorClient{base: base, http: &http.Client{Timeout: timeout}}
}

// The endpoints this driver reads. They are spelled out rather than built from
// a caller's string so that a typo is a compile error. More arrive with the
// pages that read them.
const (
	pathVarz    = "/varz"
	pathHealthz = "/healthz"
)

// varz is the server's own view of itself: identity, version, configuration
// and running totals.
func (m *monitorClient) varz(ctx context.Context) (*varzResponse, error) {
	var response varzResponse
	if err := m.get(ctx, pathVarz, nil, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

// get fetches one endpoint and decodes it.
//
// A non-2xx status is returned as an error carrying the body, because the
// monitoring endpoints answer failures in prose rather than in the JSON shape
// the caller is expecting - /healthz on an unhealthy server is the ordinary
// case, and it says what is wrong.
func (m *monitorClient) get(ctx context.Context, path string, query url.Values, out any) error {
	endpoint := m.base + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	response, err := m.http.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(response.Body, maxMonitorBody))
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &monitorError{Path: path, Status: response.StatusCode, Body: string(body)}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(body, out)
}

// maxMonitorBody bounds one answer. /connz on a busy server is the largest of
// these by far, and an unbounded read of a server that is misbehaving is how a
// monitoring call takes the app down with it.
const maxMonitorBody = 32 << 20

// monitorError is a monitoring endpoint that answered with a status rather
// than a document.
type monitorError struct {
	Path   string
	Status int
	Body   string
}

func (e *monitorError) Error() string {
	return fmt.Sprintf("nats monitoring %s answered %d: %s", e.Path, e.Status, e.Body)
}

// varzResponse is the subset of /varz this driver reads.
//
// Deliberately partial. The document carries well over a hundred fields and
// grows with every release; naming the ones the pages use keeps the contract
// visible and lets an unknown field arrive without breaking the decode.
type varzResponse struct {
	ID            string   `json:"server_id"`
	Name          string   `json:"server_name"`
	Version       string   `json:"version"`
	Go            string   `json:"go"`
	Host          string   `json:"host"`
	Port          int      `json:"port"`
	AuthRequired  bool     `json:"auth_required"`
	TLSRequired   bool     `json:"tls_required"`
	MaxPayload    int64    `json:"max_payload"`
	MaxConn       int      `json:"max_connections"`
	ConnectURLs   []string `json:"connect_urls"`
	Start         string   `json:"start"`
	Now           string   `json:"now"`
	Uptime        string   `json:"uptime"`
	Mem           int64    `json:"mem"`
	Cores         int      `json:"cores"`
	CPU           float64  `json:"cpu"`
	Connections   int      `json:"connections"`
	TotalConns    int64    `json:"total_connections"`
	Routes        int      `json:"routes"`
	Remotes       int      `json:"remotes"`
	LeafNodes     int      `json:"leafnodes"`
	InMsgs        int64    `json:"in_msgs"`
	OutMsgs       int64    `json:"out_msgs"`
	InBytes       int64    `json:"in_bytes"`
	OutBytes      int64    `json:"out_bytes"`
	SlowConsumers int64    `json:"slow_consumers"`
	Subscriptions uint32   `json:"subscriptions"`
	SystemAccount string   `json:"system_account"`

	Cluster struct {
		Name        string   `json:"name"`
		Addr        string   `json:"addr"`
		ClusterPort int      `json:"cluster_port"`
		URLs        []string `json:"urls"`
	} `json:"cluster"`

	// JetStream is absent on a server built without it, which is what makes a
	// pointer the right shape here: an empty struct and a missing one would
	// otherwise be the same thing.
	JetStream *struct {
		Config *struct {
			MaxMemory int64  `json:"max_memory"`
			MaxStore  int64  `json:"max_storage"`
			StoreDir  string `json:"store_dir"`
		} `json:"config"`
		Stats *struct {
			Memory   int64 `json:"memory"`
			Store    int64 `json:"storage"`
			Accounts int   `json:"accounts"`
			HAAssets int   `json:"ha_assets"`
		} `json:"stats"`
		Meta *struct {
			Name        string `json:"name"`
			Leader      string `json:"leader"`
			ClusterSize int    `json:"cluster_size"`
		} `json:"meta"`
	} `json:"jetstream"`
}
