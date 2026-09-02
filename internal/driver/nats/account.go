package nats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strconv"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys an account carries beyond the canonical fields.
const (
	AttrIsSystemAccount  = "systemAccount"
	AttrAccountJetStream = "jetstream"
	AttrServersReporting = "serversReporting"
	AttrInBytes          = "inBytes"
	AttrOutBytes         = "outBytes"
	AttrAPITotal         = "apiTotal"
	AttrAPIErrors        = "apiErrors"
)

// The limits an account row reports. Named once so the board reads the same
// keys the driver writes, the same way the attributes above work.
const (
	LimitMemory  = "maxMemory"
	LimitStorage = "maxStorage"
)

/*
 * Accounts are NATS's isolation boundary, and the only one it has.
 *
 * Two accounts on the same server share nothing: a subject published in one is
 * not delivered in the other, their streams are separate, their limits are
 * separate, and a connection belongs to exactly one. That is what makes this a
 * page rather than a filter - the same reason RabbitMQ's vhosts are one.
 *
 * Read-only, and that is the family rather than the driver stopping short.
 * There is no API anywhere in NATS that creates an account. In configuration
 * mode an account is a block in the server's file and appears when the file is
 * reloaded; in operator mode it is a JWT that nsc signs and pushes. Neither is
 * a request a client can make, with any credentials, so the capability list
 * declares namespace.list and not namespace.admin, and the page carries a line
 * saying where accounts do come from instead of a button that can only fail.
 */

// ListNamespaces enumerates the accounts on the cluster.
//
// Three questions rather than one, because no endpoint answers all of it: the
// roster says which accounts exist and which is the system one, the per-account
// stats say what each is carrying, and JetStream reports its own usage
// separately because an account can exist without it.
//
// Only the roster is required. The other two are detail on a page whose point
// is the list, so a cluster that answers the first and refuses the rest shows
// the accounts with empty figures rather than an error.
func (c *Conn) ListNamespaces(ctx context.Context) ([]*model.Namespace, error) {
	if err := c.requireClusterSource(); err != nil {
		return nil, err
	}

	roster, err := c.accountRoster(ctx)
	if err != nil {
		return nil, err
	}
	stats := c.accountStats(ctx)
	jetStream := c.accountJetStream(ctx)

	namespaces := make([]*model.Namespace, 0, len(roster.names))
	for _, name := range roster.names {
		namespaces = append(namespaces, namespaceOf(name, roster, stats[name], jetStream[name]))
	}
	sort.Slice(namespaces, func(i, j int) bool { return namespaces[i].Name < namespaces[j].Name })
	return namespaces, nil
}

// CreateNamespace is refused, and the message is the useful part.
//
// The capability is never declared, so nothing in the app calls this. It
// exists because NamespaceAdmin is one interface and listing is on it; an
// error that says where accounts actually come from is what a caller reaching
// here by mistake needs to read.
func (c *Conn) CreateNamespace(ctx context.Context, spec model.NamespaceSpec) error {
	return errAccountsAreConfiguration
}

// RemoveNamespace is refused for the same reason.
func (c *Conn) RemoveNamespace(ctx context.Context, name string) error {
	return errAccountsAreConfiguration
}

var errAccountsAreConfiguration = errors.New(
	"a NATS account cannot be created over a connection: it is a block in the " +
		"server's configuration file, or a JWT signed with nsc and pushed to the " +
		"account server")

// accountRoster is which accounts exist, and which of them is the system one.
type accountRoster struct {
	names  []string
	system string
	// servers is how many answered. One on a monitoring-only connection
	// whatever the size of the cluster, which is why the page says so.
	servers int
	source  string
}

func (r accountRoster) isSystem(name string) bool { return r.system != "" && name == r.system }

// accountRoster reads the account list from whichever tier answers.
func (c *Conn) accountRoster(ctx context.Context) (accountRoster, error) {
	if c.system != nil {
		replies, err := c.system.ping(ctx, endpointAccountz, 0)
		if err == nil && len(replies) > 0 {
			return rosterFromReplies(replies)
		}
		if c.monitor == nil {
			return accountRoster{}, err
		}
	}

	var response accountzResponse
	if err := c.monitor.get(ctx, pathAccountz, nil, &response); err != nil {
		return accountRoster{}, err
	}
	return accountRoster{
		names:   response.Accounts,
		system:  response.SystemAccount,
		servers: 1,
		source:  SourceMonitor,
	}, nil
}

// rosterFromReplies merges what each server said about its accounts.
//
// The union rather than the first answer. Accounts are configuration, so every
// server in a healthy cluster names the same set - but one restarted with a
// stale file names fewer, and dropping an account because a single server has
// not caught up would hide exactly the discrepancy this page is opened to find.
func rosterFromReplies(replies []systemReply) (accountRoster, error) {
	roster := accountRoster{servers: len(replies), source: SourceSystem}
	seen := make(map[string]bool)
	for _, reply := range replies {
		var response accountzResponse
		if err := json.Unmarshal(reply.Data, &response); err != nil {
			return accountRoster{}, fmt.Errorf("$SYS ACCOUNTZ answered something unexpected: %w", err)
		}
		if roster.system == "" {
			roster.system = response.SystemAccount
		}
		for _, name := range response.Accounts {
			if seen[name] {
				continue
			}
			seen[name] = true
			roster.names = append(roster.names, name)
		}
	}
	return roster, nil
}

// accountStats totals what each account is carrying.
//
// Summed across servers, unlike the JetStream figures below: a connection, a
// leaf node and a subscription each live on exactly one server, and each
// server counts only its own. On a three-server cluster read through the
// monitoring endpoint these are therefore one server's third of the truth,
// which is what AttrServersReporting is on the row to say.
//
// Best effort. A cluster that lists its accounts and refuses their stats still
// has a page worth drawing.
func (c *Conn) accountStats(ctx context.Context) map[string]*accountStat {
	totals := make(map[string]*accountStat)

	add := func(stats []accountStat) {
		for _, stat := range stats {
			name := stat.Account
			if name == "" {
				continue
			}
			running, ok := totals[name]
			if !ok {
				counted := stat
				totals[name] = &counted
				continue
			}
			running.Conns += stat.Conns
			running.LeafNodes += stat.LeafNodes
			running.TotalConns += stat.TotalConns
			running.NumSubs += stat.NumSubs
			running.SlowConsumers += stat.SlowConsumers
			running.Received.Msgs += stat.Received.Msgs
			running.Received.Bytes += stat.Received.Bytes
			running.Sent.Msgs += stat.Sent.Msgs
			running.Sent.Bytes += stat.Sent.Bytes
		}
	}

	if c.system != nil {
		replies, err := c.system.pingAccounts(ctx, endpointStatz, accountStatzRequest(), 0)
		if err == nil && len(replies) > 0 {
			for _, reply := range replies {
				var response accountStatzResponse
				if err := json.Unmarshal(reply.Data, &response); err != nil {
					continue
				}
				add(response.Accounts)
			}
			return totals
		}
		if c.monitor == nil {
			return totals
		}
	}

	var response accountStatzResponse
	// unused=1 so an account nobody is connected to still appears. Without it
	// the roster and the figures disagree, and an idle account looks like a
	// row that failed to load.
	if err := c.monitor.get(ctx, pathAccStatz, url.Values{"unused": {"1"}}, &response); err != nil {
		return totals
	}
	add(response.Accounts)
	return totals
}

// accountJetStream reads each account's JetStream usage against its limits.
//
// Not summed, unlike the counts above, and that difference is the trap here.
// JetStream tracks an account's usage cluster-wide: every server holds the
// local figure plus what its peers have reported, so all of them answer with
// the same total and adding them up would report three times the disk on a
// three-server cluster. The largest is taken because a server that has just
// joined has not yet heard from every peer, and the highest answer is the one
// closest to the truth.
//
// An account missing from this map has no JetStream, which is a fact the page
// shows rather than a figure it failed to read: /jsz lists the accounts that
// have it, and only those.
func (c *Conn) accountJetStream(ctx context.Context) map[string]jszAccount {
	usage := make(map[string]jszAccount)

	add := func(accounts []jszAccount) {
		for _, account := range accounts {
			name := account.ID
			if name == "" {
				name = account.Name
			}
			if name == "" {
				continue
			}
			account.ID = name
			running, seen := usage[name]
			if !seen || account.Store > running.Store || account.Memory > running.Memory {
				usage[name] = account
			}
		}
	}

	if c.system != nil {
		replies, err := c.system.pingWithBody(ctx, endpointJsz, jszRequest(), 0)
		if err == nil && len(replies) > 0 {
			for _, reply := range replies {
				var response jszResponse
				if err := json.Unmarshal(reply.Data, &response); err != nil {
					continue
				}
				add(response.Accounts)
			}
			return usage
		}
		if c.monitor == nil {
			return usage
		}
	}

	var response jszResponse
	if err := c.monitor.get(ctx, pathJsz, url.Values{"accounts": {"true"}}, &response); err != nil {
		return usage
	}
	add(response.Accounts)
	return usage
}

// namespaceOf maps one account onto the canonical model.
func namespaceOf(name string, roster accountRoster, stat *accountStat, js jszAccount) *model.Namespace {
	namespace := &model.Namespace{
		Name: name,
		// Messages have no account-wide total in NATS. JetStream counts bytes
		// per account and messages per stream, and core NATS keeps nothing at
		// all - so zero here would read as an account holding nothing, which
		// is a different claim from not being able to say.
		Messages:       model.UnknownMetric,
		Ready:          model.UnknownMetric,
		Unacknowledged: model.UnknownMetric,
		Limits:         map[string]int{},
		Attributes:     map[string]string{},
	}

	set := func(key, value string) {
		if value != "" {
			namespace.Attributes[key] = value
		}
	}
	set(AttrSource, roster.source)
	set(AttrServersReporting, strconv.Itoa(roster.servers))
	if roster.isSystem(name) {
		set(AttrIsSystemAccount, "true")
	}

	if stat != nil {
		set(AttrConnections, strconv.Itoa(stat.Conns))
		set(AttrLeafNodes, strconv.Itoa(stat.LeafNodes))
		set(AttrSubscriptions, strconv.FormatUint(uint64(stat.NumSubs), 10))
		set(AttrSlowConsumers, strconv.FormatInt(stat.SlowConsumers, 10))
		set(AttrInMsgs, strconv.FormatInt(stat.Received.Msgs, 10))
		set(AttrInBytes, strconv.FormatInt(stat.Received.Bytes, 10))
		set(AttrOutMsgs, strconv.FormatInt(stat.Sent.Msgs, 10))
		set(AttrOutBytes, strconv.FormatInt(stat.Sent.Bytes, 10))
	}

	if js.ID != "" {
		set(AttrAccountJetStream, "true")
		set(AttrJSMemory, strconv.FormatUint(js.Memory, 10))
		set(AttrJSStorage, strconv.FormatUint(js.Store, 10))
		set(AttrAPITotal, strconv.FormatUint(js.API.Total, 10))
		set(AttrAPIErrors, strconv.FormatUint(js.API.Errors, 10))
		if limit, capped := reservation(js.ReservedMemory); capped {
			namespace.Limits[LimitMemory] = limit
		}
		if limit, capped := reservation(js.ReservedStore); capped {
			namespace.Limits[LimitStorage] = limit
		}
	}
	return namespace
}

// reservation reads one JetStream reservation as a limit.
//
// The server holds these as int64 where -1 means no cap and publishes them as
// uint64, so an uncapped account arrives as 18446744073709551615 rather than
// as a negative number. Reported as an absent limit, which is what the model
// means by absent - and a cap of zero stays a cap of zero, because an account
// configured with no JetStream allowance is a real state.
func reservation(reserved uint64) (int, bool) {
	if reserved >= math.MaxInt64 {
		return 0, false
	}
	return int(reserved), true
}

// The monitoring endpoints and $SYS subjects this page reads.
const (
	pathAccountz = "/accountz"
	pathAccStatz = "/accstatz"
	pathJsz      = "/jsz"

	endpointAccountz = "ACCOUNTZ"
	endpointJsz      = "JSZ"
	endpointStatz    = "STATZ"
)

// accountStatzRequest asks for every account rather than only the busy ones.
func accountStatzRequest() any { return map[string]any{"include_unused": true} }

// jszRequest asks for the per-account breakdown and nothing else. Streams are
// deliberately not requested: that answer carries every stream's full state,
// and this page needs one total per account.
func jszRequest() any { return map[string]any{"accounts": true} }

// accountzResponse is the subset of /accountz this driver reads.
type accountzResponse struct {
	ID            string   `json:"server_id"`
	SystemAccount string   `json:"system_account"`
	Accounts      []string `json:"accounts"`
}

// accountStatzResponse is the subset of /accstatz this driver reads.
type accountStatzResponse struct {
	ID       string        `json:"server_id"`
	Accounts []accountStat `json:"account_statz"`
}

type accountStat struct {
	Account       string      `json:"acc"`
	Name          string      `json:"name"`
	Conns         int         `json:"conns"`
	LeafNodes     int         `json:"leafnodes"`
	TotalConns    int         `json:"total_conns"`
	NumSubs       uint32      `json:"num_subscriptions"`
	SlowConsumers int64       `json:"slow_consumers"`
	Received      accountData `json:"received"`
	Sent          accountData `json:"sent"`
}

// accountData is the flat half of the server's DataStats. The per-route,
// per-gateway and per-leaf breakdowns nested below it are not read: this page
// reports what an account carried, not which link carried it.
type accountData struct {
	Msgs  int64 `json:"msgs"`
	Bytes int64 `json:"bytes"`
}

// jszResponse is the subset of /jsz this driver reads.
type jszResponse struct {
	ID       string       `json:"server_id"`
	Accounts []jszAccount `json:"account_details"`
}

type jszAccount struct {
	// ID is the account name. Name is its name tag, which operator mode sets
	// and which is a label rather than an address - the two differ there and
	// are the same string everywhere else.
	ID             string `json:"id"`
	Name           string `json:"name"`
	Memory         uint64 `json:"memory"`
	Store          uint64 `json:"storage"`
	ReservedMemory uint64 `json:"reserved_memory"`
	ReservedStore  uint64 `json:"reserved_storage"`
	API            struct {
		Total  uint64 `json:"total"`
		Errors uint64 `json:"errors"`
	} `json:"api"`
}
