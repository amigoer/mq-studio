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

func TestAdminClientManagerSetDefaultMissingClient(t *testing.T) {
	m := GetClientManager()
	if err := m.SetDefaultConnection("__missing_client_for_unit_test__:9876"); err == nil {
		t.Fatal("不存在的客户端设为默认应失败")
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
