package rocketmq

import (
	"context"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/resource"
	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// scopeTally counts the namespaces a set of broker-real names carries.
//
// A name with no namespace and a system resource both count towards nothing:
// the unscoped connection is not a namespace, it is the absence of one, and
// TBW102 belongs to every namespace at once.
type scopeTally struct {
	byName map[string]*model.Scope
	// groups is what stops a cluster of four brokers reporting one consumer
	// group four times: a group is configured on every broker it runs on.
	groups map[string]struct{}
}

func newScopeTally() *scopeTally {
	return &scopeTally{
		byName: make(map[string]*model.Scope),
		groups: make(map[string]struct{}),
	}
}

func (t *scopeTally) entry(name string) *model.Scope {
	namespace := resource.Of(name)
	if namespace == "" {
		return nil
	}
	if found, exists := t.byName[namespace]; exists {
		return found
	}
	created := &model.Scope{Name: namespace}
	t.byName[namespace] = created
	return created
}

func (t *scopeTally) addDestination(topic string) {
	if resource.IsSystemTopic(topic) {
		return
	}
	if entry := t.entry(topic); entry != nil {
		entry.Destinations++
	}
}

func (t *scopeTally) addSubscription(group string) {
	if resource.IsSystemGroup(group) {
		return
	}
	if _, counted := t.groups[group]; counted {
		return
	}
	t.groups[group] = struct{}{}
	if entry := t.entry(group); entry != nil {
		entry.Subscriptions++
	}
}

// scopes returns the tally by name, so the switcher's list holds still between
// reads rather than following Go's map order.
func (t *scopeTally) scopes() []*model.Scope {
	result := make([]*model.Scope, 0, len(t.byName))
	for _, entry := range t.byName {
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result
}

// ListScopes reports the namespaces this cluster's own names carry.
//
// RocketMQ keeps no namespace registry: a namespace is the prefix on a topic
// or group name and nothing anywhere records the set of them, so the only way
// to offer a list is to read the names and take them apart. A namespace
// nothing carries yet is therefore invisible here and has to be typed, which
// is what ValidateScope exists for.
//
// Deliberately unfiltered by this connection's own namespace: the whole point
// is to show what it could be switched to.
func (c *Conn) ListScopes(ctx context.Context) ([]*model.Scope, error) {
	tally := newScopeTally()
	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}
		for _, topic := range topicList.TopicList {
			tally.addDestination(topic)
		}
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return nil, err
	}

	c.tallyGroupScopes(ctx, clusterInfo, tally)
	return tally.scopes(), nil
}

// tallyGroupScopes adds the namespaces the subscription groups carry.
//
// Best-effort, and silently so: groups live on the brokers rather than on the
// name server, so one broker that will not answer would otherwise cost the
// switcher every namespace instead of the few that exist only as a group. A
// namespace missed here is still reachable by typing it.
func (c *Conn) tallyGroupScopes(ctx context.Context, clusterInfo *admin.ClusterInfo, tally *scopeTally) {
	if clusterInfo == nil {
		return
	}
	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		masterAddress := brokerData.BrokerAddrs["0"]
		if masterAddress == "" {
			continue
		}
		var groups map[string]*admin.SubscriptionGroupConfig
		groupErr := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
			var callErr error
			groups, callErr = retryClient.GetAllSubscriptionGroup(ctx, masterAddress)
			return callErr
		})
		if groupErr != nil {
			continue
		}
		for groupName := range groups {
			tally.addSubscription(groupName)
		}
	}
}

// ValidateScope reports whether a name can be used as a namespace. An empty
// name is the unscoped connection and is always valid.
func (c *Conn) ValidateScope(name string) error {
	return ValidateNamespace(strings.TrimSpace(name))
}
