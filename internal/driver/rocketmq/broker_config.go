package rocketmq

import (
	"context"
	"fmt"
	"strings"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// rawBrokerConfigKey is where the library puts a body it could not parse.
//
// A broker answers GET_BROKER_CONFIG with a Java Properties document, not
// JSON, so the library's json.Unmarshal always fails and the whole document
// lands under this one key. Every real setting is inside it.
const rawBrokerConfigKey = "raw"

// brokerConfig turns what the library returns into the settings it describes.
//
// Without this every lookup misses: config["aclEnable"] is empty on a broker
// that has ACL enabled, because the value is sitting inside the raw document
// rather than under its own key.
func brokerConfig(returned map[string]string) map[string]string {
	raw, hasRaw := returned[rawBrokerConfigKey]
	if !hasRaw {
		return returned
	}

	parsed := parseProperties(raw)
	// Anything the library did manage to key stays authoritative; the parsed
	// document fills in the rest.
	for key, value := range returned {
		if key == rawBrokerConfigKey {
			continue
		}
		parsed[key] = value
	}
	return parsed
}

// parseProperties reads a Java Properties document.
//
// Only what a broker actually sends is handled: `key=value` lines, `#` and `!`
// comments, and blank lines. Line continuations and unicode escapes are not,
// because no broker setting uses them.
func parseProperties(document string) map[string]string {
	values := make(map[string]string)
	for _, line := range strings.Split(document, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		values[key] = strings.TrimSpace(value)
	}
	return values
}

// NodeConfig returns one broker's effective settings.
//
// This is what the broker is running with, which is not always what its
// broker.conf says: anything changed at runtime, or defaulted, shows here and
// nowhere else.
func (c *Conn) NodeConfig(ctx context.Context, address string) (map[string]string, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return nil, fmt.Errorf("获取 Broker 配置失败: Broker 地址不能为空")
	}

	var returned map[string]string
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		returned, callErr = retryClient.GetBrokerConfig(ctx, address)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Broker 配置失败: %w", err)
	}
	return brokerConfig(returned), nil
}
