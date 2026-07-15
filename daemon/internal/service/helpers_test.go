package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/amigoer/rocketmq-admin-go/protocol/remoting"
)

func TestIsSystemTopic(t *testing.T) {
	cases := []struct {
		topic string
		want  bool
	}{
		{"", true},
		{"orders", false},
		{"%RETRY%gid", false},
		{"%DLQ%gid", false},
		{"%SYS%internal", true},
		{"RMQ_SYS_TRACE_TOPIC", true},
		{"SCHEDULE_TOPIC_XXXX", true},
		{"TBW102", true},
		{"BenchmarkTest", true},
		{"business_topic", false},
	}
	for _, tc := range cases {
		if got := isSystemTopic(tc.topic); got != tc.want {
			t.Fatalf("isSystemTopic(%q) = %v, want %v", tc.topic, got, tc.want)
		}
	}
}

func TestIsSystemGroup(t *testing.T) {
	if !isSystemGroup("TOOLS_CONSUMER") {
		t.Fatal("TOOLS_CONSUMER 应为系统组")
	}
	if !isSystemGroup("CID_ONSAPI_FOO") {
		t.Fatal("CID_ONSAPI* 前缀应为系统组")
	}
	if isSystemGroup("orders-consumer") {
		t.Fatal("业务组不应被过滤")
	}
}

func TestValidateConsumerGroupInput(t *testing.T) {
	_, _, _, _, err := validateConsumerGroupInput("", "127.0.0.1:10911", string(model.ModeClustering), 16)
	if err == nil {
		t.Fatal("空组名应失败")
	}
	_, _, _, _, err = validateConsumerGroupInput("g1", "b1", "invalid", 1)
	if err == nil {
		t.Fatal("非法消费模式应失败")
	}
	_, _, _, _, err = validateConsumerGroupInput("g1", "b1", string(model.ModeBroadcasting), 100)
	if err == nil {
		t.Fatal("重试次数过大应失败")
	}
	g, b, m, r, err := validateConsumerGroupInput("  g1  ", "  b1  ", string(model.ModeClustering), 16)
	if err != nil || g != "g1" || b != "b1" || m != string(model.ModeClustering) || r != 16 {
		t.Fatalf("合法输入解析失败: %v %q %q %q %d", err, g, b, m, r)
	}
}

func TestValidateConnectionFields(t *testing.T) {
	_, _, err := validateConnectionFields("", "127.0.0.1:9876", 5)
	if err == nil {
		t.Fatal("空名称应失败")
	}
	_, _, err = validateConnectionFields("prod", "", 5)
	if err == nil {
		t.Fatal("空 NameServer 应失败")
	}
	_, _, err = validateConnectionFields("prod", "ns:9876", 999)
	if err == nil {
		t.Fatal("超时过大应失败")
	}
	// 0 会在后续 normalizeTimeoutSec 中变为默认值，校验仅拒绝负值与 >300
	name, ns, err := validateConnectionFields("  prod  ", " ns:9876;ns2:9876 ", 0)
	if err != nil || name != "prod" || ns != "ns:9876;ns2:9876" {
		t.Fatalf("合法输入失败: %v %q %q", err, name, ns)
	}
}

func TestNormalizeConnectionEnvAndACLAndTimeout(t *testing.T) {
	if normalizeConnectionEnv(model.ConnectionEnv("staging")) != model.EnvDevelopment {
		t.Fatal("未知环境应回落 development")
	}
	if normalizeConnectionEnv(model.EnvProduction) != model.EnvProduction {
		t.Fatal("production 应保留")
	}

	en, ak, sk, err := normalizeACLConfig(false, "a", "b")
	if err != nil || en || ak != "" || sk != "" {
		t.Fatalf("关闭 ACL 应清空凭证: %v %v %q %q", err, en, ak, sk)
	}
	_, _, _, err = normalizeACLConfig(true, "", "sk")
	if err == nil {
		t.Fatal("启用 ACL 缺 AK 应失败")
	}
	en, ak, sk, err = normalizeACLConfig(true, " ak ", " sk ")
	if err != nil || !en || ak != "ak" || sk != "sk" {
		t.Fatalf("ACL 规范化失败: %v %v %q %q", err, en, ak, sk)
	}

	if normalizeTimeoutSec(0) != defaultConnectionTimeout {
		t.Fatalf("0 超时应回落默认 %d", defaultConnectionTimeout)
	}
	if normalizeTimeoutSec(12) != 12 {
		t.Fatal("正超时应保留")
	}
}

func TestNormalizeSettingsDiskAndTheme(t *testing.T) {
	s := *model.DefaultSettings()
	s.Theme = "neon"
	s.Language = "fr"
	s.DiskAlertThreshold = 150
	s.LagAlertThreshold = -1
	s.FontSize = 99
	out := normalizeSettings(s)
	if out.Theme != "system" || out.Language != "zh" {
		t.Fatalf("theme/lang not normalized: %q %q", out.Theme, out.Language)
	}
	if out.DiskAlertThreshold != 100 {
		t.Fatalf("disk cap 100, got %d", out.DiskAlertThreshold)
	}
	if out.LagAlertThreshold != 0 {
		t.Fatalf("negative lag should clamp to 0, got %d", out.LagAlertThreshold)
	}
	if out.FontSize != model.DefaultSettings().FontSize {
		t.Fatalf("fontSize not reset: %d", out.FontSize)
	}
}

func TestClusterParseHelpers(t *testing.T) {
	if parseIntSafe("42x") != 42 {
		t.Fatal("parseIntSafe")
	}
	if parseInt64Safe("100") != 100 {
		t.Fatal("parseInt64Safe")
	}
	if parseFloatSafe("3.5") != 3.5 {
		t.Fatal("parseFloatSafe")
	}
	if extractFirstValue("12 34") != "12" {
		t.Fatal("extractFirstValue space")
	}
	if extractFirstValue("solo") != "solo" {
		t.Fatal("extractFirstValue whole")
	}
	arr := appendCapped([]int{1, 2, 3}, 4, 3)
	if len(arr) != 3 || arr[0] != 2 || arr[2] != 4 {
		t.Fatalf("appendCapped = %#v", arr)
	}
}

func TestIsRetryableNetworkError(t *testing.T) {
	if isRetryableNetworkError(nil) {
		t.Fatal("nil 不可重试")
	}
	if !isRetryableNetworkError(errors.New("connection reset by peer")) {
		t.Fatal("应识别 connection reset")
	}
	if !isRetryableNetworkError(fmt.Errorf("所有 nameserver 请求失败: timeout")) {
		t.Fatal("应识别中文 nameserver 失败")
	}
	if isRetryableNetworkError(errors.New("topic not exist")) {
		t.Fatal("业务错误不应重试")
	}
}

func TestIsRequestCodeNotSupported(t *testing.T) {
	if isRequestCodeNotSupported(nil) {
		t.Fatal("nil")
	}
	if isRequestCodeNotSupported(errors.New("plain")) {
		t.Fatal("普通错误")
	}
	err := &admin.AdminError{Code: remoting.RequestCodeNotSupported, Message: "nope"}
	if !isRequestCodeNotSupported(err) {
		t.Fatal("应识别 REQUEST_CODE_NOT_SUPPORTED")
	}
	if !isRequestCodeNotSupported(fmt.Errorf("wrap: %w", err)) {
		t.Fatal("应透过 wrap 识别")
	}
}

func TestConvertMessageExtStatuses(t *testing.T) {
	s := NewMessageService(nil)
	dlq := s.convertMessageExt(&admin.MessageExt{
		Topic: "%DLQ%gid",
		MsgId: "m1",
		Body:  []byte("x"),
	})
	if dlq.Status != model.MsgDLQ {
		t.Fatalf("DLQ status = %s", dlq.Status)
	}
	normal := s.convertMessageExt(&admin.MessageExt{
		Topic: "orders",
		MsgId: "m2",
		Body:  []byte(`{"a":1}`),
		Properties: map[string]string{
			"TAGS": "t",
			"KEYS": "k",
		},
	})
	if normal.Status != model.MsgNormal || normal.Tags != "t" || normal.Keys != "k" {
		t.Fatalf("normal convert failed: %#v", normal)
	}
}

func TestWriteAtomicFile(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/out.json"
	if err := writeAtomicFile(path, []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	// second write overwrites
	if err := writeAtomicFile(path, []byte(`{"ok":false}`)); err != nil {
		t.Fatal(err)
	}
}
