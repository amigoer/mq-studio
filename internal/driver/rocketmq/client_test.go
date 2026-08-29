package rocketmq

import (
	"reflect"
	"testing"
	"time"
)

func TestParseNameServers(t *testing.T) {
	got := ParseNameServers(" ns-a:9876;ns-b:9876, ns-a:9876\n[::1]:9876 ")
	want := []string{"ns-a:9876", "ns-b:9876", "[::1]:9876"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ParseNameServers() = %#v, want %#v", got, want)
	}
	if len(ParseNameServers("   ")) != 0 {
		t.Fatal("空白输入应得到空列表")
	}
	if len(ParseNameServers("a,a,a")) != 1 {
		t.Fatal("应去重")
	}
}

func TestNewClientConfigRejectsEmptyEndpoints(t *testing.T) {
	if _, err := NewClientConfig("  ", 5*time.Second, false, "", ""); err == nil {
		t.Fatal("空 NameServer 地址应当被拒绝")
	}
}

func TestNewClientConfigRequiresCredentialsWithACL(t *testing.T) {
	if _, err := NewClientConfig("ns:9876", 5*time.Second, true, "ak", ""); err == nil {
		t.Fatal("启用 ACL 但缺少 SecretKey 应当被拒绝")
	}
	config, err := NewClientConfig("ns-a:9876;ns-b:9876", 0, true, " ak ", " sk ")
	if err != nil {
		t.Fatalf("NewClientConfig() error = %v", err)
	}
	if config.AccessKey != "ak" || config.SecretKey != "sk" {
		t.Fatalf("凭据未去除空白: %#v", config)
	}
	// A zero timeout has to become a usable one, or every request would fail
	// its deadline immediately.
	if config.Timeout != defaultRequestTimeout {
		t.Fatalf("Timeout = %v, want the default %v", config.Timeout, defaultRequestTimeout)
	}
	if config.Address() != "ns-a:9876;ns-b:9876" {
		t.Fatalf("Address() = %q", config.Address())
	}
}
