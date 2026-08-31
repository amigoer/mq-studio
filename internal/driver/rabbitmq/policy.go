package rabbitmq

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// ListPolicies returns both kinds, marked apart.
//
// Both in one list because the broker applies both and a page showing only
// user policies would be describing half of what is in force. Which kind a
// policy is stays on the row, because it decides who can change it and which
// value wins when the two set the same key.
func (c *Conn) ListPolicies(ctx context.Context) ([]*model.Policy, error) {
	user, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.Policy, error) {
		return client.ListPolicies()
	})
	if err != nil {
		return nil, fmt.Errorf("list policies: %w", err)
	}

	policies := make([]*model.Policy, 0, len(user))
	for i := range user {
		policies = append(policies, policyFrom(&user[i], false))
	}

	// Operator policies need the policymaker tag to read. A user without it
	// should still see its own policies rather than an error page.
	if operator, opErr := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.OperatorPolicy, error) {
		return client.ListOperatorPolicies()
	}); opErr == nil {
		for i := range operator {
			policies = append(policies, operatorPolicyFrom(&operator[i]))
		}
	}
	return policies, nil
}

// MatchingPolicies asks the broker which policy actually applies to one
// destination.
//
// The single most useful call on this page, because the rule is not what
// people expect: policies do not merge, only the highest-priority match
// applies, and working that out by reading patterns is where mistakes come
// from. This is the broker's own answer.
func (c *Conn) MatchingPolicies(ctx context.Context, ref model.DestinationRef, kind string) ([]*model.Policy, error) {
	target := rabbithole.PolicyTargetQueues
	if kind == "exchange" {
		target = rabbithole.PolicyTargetExchanges
	}
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.Policy, error) {
		return client.ListMatchingPolicies(c.vhostOr(ref.Namespace), ref.Name, target)
	})
	if err != nil {
		return nil, fmt.Errorf("matching policies for %q: %w", ref.Name, err)
	}
	policies := make([]*model.Policy, 0, len(found))
	for i := range found {
		policies = append(policies, policyFrom(&found[i], false))
	}
	return policies, nil
}

// SavePolicy creates a policy or replaces one of the same name.
func (c *Conn) SavePolicy(ctx context.Context, policy model.Policy) error {
	definition, err := decodeDefinition(policy.Definition)
	if err != nil {
		return fmt.Errorf("policy %q: %w", policy.Name, err)
	}

	if policy.Operator {
		err = exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.PutOperatorPolicy(policy.Namespace, policy.Name, rabbithole.OperatorPolicy{
				Vhost:      policy.Namespace,
				Name:       policy.Name,
				Pattern:    policy.Pattern,
				ApplyTo:    policy.ApplyTo,
				Priority:   policy.Priority,
				Definition: rabbithole.PolicyDefinition(definition),
			})
		})
	} else {
		err = exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.PutPolicy(policy.Namespace, policy.Name, rabbithole.Policy{
				Vhost:      policy.Namespace,
				Name:       policy.Name,
				Pattern:    policy.Pattern,
				ApplyTo:    policy.ApplyTo,
				Priority:   policy.Priority,
				Definition: rabbithole.PolicyDefinition(definition),
			})
		})
	}
	if err != nil {
		return fmt.Errorf("save policy %q: %w", policy.Name, err)
	}
	return nil
}

// RemovePolicy deletes one.
//
// Every destination it was applying to reverts to whatever it was declared
// with, at once and with no warning from the broker.
func (c *Conn) RemovePolicy(ctx context.Context, namespace, name string, operator bool) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		if operator {
			return client.DeleteOperatorPolicy(namespace, name)
		}
		return client.DeletePolicy(namespace, name)
	})
	if err != nil {
		return fmt.Errorf("delete policy %q: %w", name, err)
	}
	return nil
}

// ListRuntimeParameters returns every component's stored configuration.
func (c *Conn) ListRuntimeParameters(ctx context.Context) ([]*model.RuntimeParameter, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.RuntimeParameter, error) {
		return client.ListRuntimeParameters()
	})
	if err != nil {
		return nil, fmt.Errorf("list runtime parameters: %w", err)
	}
	parameters := make([]*model.RuntimeParameter, 0, len(found))
	for _, parameter := range found {
		encoded, marshalErr := json.Marshal(parameter.Value)
		if marshalErr != nil {
			// A value this app cannot re-encode is still worth listing: the
			// component and name are what tell an operator it exists.
			encoded = []byte(`null`)
		}
		parameters = append(parameters, &model.RuntimeParameter{
			Component: parameter.Component,
			Namespace: parameter.Vhost,
			Name:      parameter.Name,
			Value:     string(encoded),
		})
	}
	return parameters, nil
}

// RemoveRuntimeParameter deletes one component's stored configuration.
//
// There is no generic setter here on purpose: a parameter's shape belongs to
// whichever plugin owns the component, and a form that accepted arbitrary JSON
// for an arbitrary component would be a way to write configuration nothing
// validates. Shovels and federation upstreams get their own typed pages.
func (c *Conn) RemoveRuntimeParameter(ctx context.Context, component, namespace, name string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteRuntimeParameter(component, namespace, name)
	})
	if err != nil {
		return fmt.Errorf("delete parameter %q/%q: %w", component, name, err)
	}
	return nil
}

func policyFrom(policy *rabbithole.Policy, operator bool) *model.Policy {
	return &model.Policy{
		Namespace:  policy.Vhost,
		Name:       policy.Name,
		Pattern:    policy.Pattern,
		ApplyTo:    policy.ApplyTo,
		Priority:   policy.Priority,
		Definition: encodeArguments(policy.Definition),
		Operator:   operator,
	}
}

func operatorPolicyFrom(policy *rabbithole.OperatorPolicy) *model.Policy {
	return &model.Policy{
		Namespace:  policy.Vhost,
		Name:       policy.Name,
		Pattern:    policy.Pattern,
		ApplyTo:    policy.ApplyTo,
		Priority:   policy.Priority,
		Definition: encodeArguments(policy.Definition),
		Operator:   true,
	}
}

// decodeDefinition reads the JSON the form sends, with the same integer
// correction the queue arguments need: JSON has one number type and RabbitMQ
// refuses a float where it wants a whole number.
func decodeDefinition(encoded string) (map[string]interface{}, error) {
	definition := decodeArguments(encoded)
	if definition == nil && encoded != "" && encoded != "{}" {
		return nil, fmt.Errorf("the definition is not valid JSON")
	}
	if definition == nil {
		definition = map[string]interface{}{}
	}
	return definition, nil
}
