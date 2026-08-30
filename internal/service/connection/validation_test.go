package connection

import "testing"

func TestValidateConnectionFields(t *testing.T) {
	if _, _, err := validateConnectionFields("", "127.0.0.1:9876", 5); err == nil {
		t.Fatal("empty name should fail")
	}
	if _, _, err := validateConnectionFields("prod", "", 5); err == nil {
		t.Fatal("empty NameServer should fail")
	}
	if _, _, err := validateConnectionFields("prod", "ns:9876", 999); err == nil {
		t.Fatal("timeout greater than 300 seconds should fail")
	}
	name, nameServer, err := validateConnectionFields("  prod  ", " ns:9876;ns2:9876 ", 0)
	if err != nil || name != "prod" || nameServer != "ns:9876;ns2:9876" {
		t.Fatalf("valid input was not normalized: err=%v name=%q nameServer=%q", err, name, nameServer)
	}
}

func TestNormalizeConnectionGroupACLAndTimeout(t *testing.T) {
	if normalizeConnectionGroup("  \t ") != "" {
		t.Fatal("a blank group should normalize to ungrouped")
	}
	if normalizeConnectionGroup("  staging   cluster ") != "staging cluster" {
		t.Fatal("group whitespace should be trimmed and collapsed")
	}

	enabled, accessKey, secretKey, err := normalizeACLConfig(false, "a", "b")
	if err != nil || enabled || accessKey != "" || secretKey != "" {
		t.Fatalf("disabled ACL should clear credentials: err=%v enabled=%v accessKey=%q secretKey=%q", err, enabled, accessKey, secretKey)
	}
	if _, _, _, err := normalizeACLConfig(true, "", "sk"); err == nil {
		t.Fatal("enabled ACL without AccessKey should fail")
	}
	enabled, accessKey, secretKey, err = normalizeACLConfig(true, " ak ", " sk ")
	if err != nil || !enabled || accessKey != "ak" || secretKey != "sk" {
		t.Fatalf("ACL normalization failed: err=%v enabled=%v accessKey=%q secretKey=%q", err, enabled, accessKey, secretKey)
	}
}
