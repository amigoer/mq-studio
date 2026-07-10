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
}

func TestSameClientConfig(t *testing.T) {
	base := ClientConfig{
		NameServers: []string{"ns-a:9876", "ns-b:9876"},
		Timeout:     5 * time.Second,
		EnableACL:   true,
		AccessKey:   "ak",
		SecretKey:   "sk",
	}
	copy := base
	copy.NameServers = append([]string(nil), base.NameServers...)
	if !sameClientConfig(base, copy) {
		t.Fatal("相同配置应当可以复用客户端")
	}
	copy.SecretKey = "changed"
	if sameClientConfig(base, copy) {
		t.Fatal("凭据变化后不得复用旧客户端")
	}
}
