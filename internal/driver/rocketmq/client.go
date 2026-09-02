// Package rocketmq wraps the RocketMQ Admin client.
package rocketmq

import (
	"context"
	"fmt"
	"strings"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// ClientConfig is everything needed to dial one NameServer set.
//
// A Conn keeps its own copy rather than looking one up: reconnecting after a
// network drop re-dials with exactly these parameters, and SendMessage builds
// its producer from them, so neither has to reach for shared state that
// another connection could have changed underneath it.
type ClientConfig struct {
	NameServers []string
	Timeout     time.Duration
	EnableACL   bool
	AccessKey   string
	SecretKey   string

	// Namespace scopes every topic and group this connection names. It is not
	// a dial parameter: RocketMQ namespaces are a client-side naming
	// convention, so it never reaches the admin library - the driver wraps the
	// names it sends and unwraps the ones it shows. Empty means unscoped.
	Namespace string
}

// ParseNameServers converts semicolon-, comma-, or whitespace-delimited addresses into a client address list.
func ParseNameServers(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ';' || r == ',' || r == ' ' || r == '\t' || r == '\r' || r == '\n'
	})
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		addr := strings.TrimSpace(part)
		if addr == "" {
			continue
		}
		if _, exists := seen[addr]; exists {
			continue
		}
		seen[addr] = struct{}{}
		result = append(result, addr)
	}
	return result
}

// NewClientConfig validates the raw connection parameters into a dialable config.
func NewClientConfig(endpoints string, timeout time.Duration, enableACL bool, accessKey, secretKey string) (ClientConfig, error) {
	nameServers := ParseNameServers(endpoints)
	if len(nameServers) == 0 {
		return ClientConfig{}, fmt.Errorf("NameServer 地址不能为空")
	}
	if timeout <= 0 {
		timeout = defaultRequestTimeout
	}
	config := ClientConfig{
		NameServers: nameServers,
		Timeout:     timeout,
		EnableACL:   enableACL,
		AccessKey:   strings.TrimSpace(accessKey),
		SecretKey:   strings.TrimSpace(secretKey),
	}
	if config.EnableACL && (config.AccessKey == "" || config.SecretKey == "") {
		return ClientConfig{}, fmt.Errorf("启用 ACL 时 AccessKey/SecretKey 不能为空")
	}
	return config, nil
}

// ValidateNamespace checks a namespace can be composed into a resource name.
//
// '%' is the separator RocketMQ joins with, so a namespace carrying one would
// produce a name nothing could take apart again. The rest follows the broker's
// own rule for a topic or group, ^[%|a-zA-Z0-9_-]+$, minus the separator.
func ValidateNamespace(namespace string) error {
	for _, r := range namespace {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '|':
		default:
			return fmt.Errorf("Namespace 只能包含字母、数字、下划线和短横线: %q", namespace)
		}
	}
	return nil
}

// Address renders the config's NameServers the way a profile writes them.
func (c ClientConfig) Address() string { return strings.Join(c.NameServers, ";") }

// options are the dial parameters. Namespace is deliberately absent: the admin
// library has no namespace option, and adding one here would suggest the
// library honours something it never sees.
func (c ClientConfig) options() []admin.Option {
	options := []admin.Option{
		admin.WithNameServers(c.NameServers),
		admin.WithTimeout(c.Timeout),
	}
	if c.EnableACL {
		options = append(options, admin.WithACL(c.AccessKey, c.SecretKey))
	}
	return options
}

// Dial opens a client and verifies it can reach a NameServer.
//
// The caller owns the returned client and must Close it. Nothing is cached:
// two profiles pointing at the same NameServer get two clients, which is what
// lets either be closed without disturbing the other.
func Dial(config ClientConfig) (*admin.Client, error) {
	client, err := admin.NewClient(config.options()...)
	if err != nil {
		return nil, fmt.Errorf("创建客户端失败: %w", err)
	}
	if err := client.Start(); err != nil {
		client.Close()
		return nil, fmt.Errorf("启动客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), config.Timeout)
	defer cancel()
	if _, err := client.ExamineBrokerClusterInfo(ctx); err != nil {
		client.Close()
		return nil, fmt.Errorf("无法连接到 NameServer: %w", err)
	}
	return client, nil
}
