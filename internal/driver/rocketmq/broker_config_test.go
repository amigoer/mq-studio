package rocketmq

import "testing"

// A broker answers with a Properties document, so every setting arrives inside
// one "raw" string. Reading a key straight off what the library returns is how
// GetAclEnabled reported ACL as off on a broker that had it on.
func TestBrokerConfigParsesTheRawProperties(t *testing.T) {
	config := brokerConfig(map[string]string{
		rawBrokerConfigKey: "# a comment\n" +
			"aclEnable=true\n" +
			"brokerClusterName=AclCluster\n" +
			"\n" +
			"! another comment\n" +
			"  spaced  =  value  \n" +
			"noEquals\n" +
			"emptyValue=\n",
	})

	if config["aclEnable"] != "true" {
		t.Fatalf("aclEnable = %q, want true", config["aclEnable"])
	}
	if config["brokerClusterName"] != "AclCluster" {
		t.Fatalf("brokerClusterName = %q", config["brokerClusterName"])
	}
	if config["spaced"] != "value" {
		t.Fatalf("spaced = %q, want the padding trimmed", config["spaced"])
	}
	if _, present := config["noEquals"]; present {
		t.Error("a line with no separator became a key")
	}
	if value, present := config["emptyValue"]; !present || value != "" {
		t.Errorf("emptyValue = %q present=%v, want an empty value", value, present)
	}
	if _, present := config[rawBrokerConfigKey]; present {
		t.Error("the raw document survived into the parsed config")
	}
}

// A library that learns to parse this itself must not be undone by the
// workaround.
func TestBrokerConfigKeepsKeysTheLibraryParsed(t *testing.T) {
	config := brokerConfig(map[string]string{"aclEnable": "true"})
	if config["aclEnable"] != "true" {
		t.Fatalf("aclEnable = %q, want true", config["aclEnable"])
	}

	// Where both carry a key, the keyed one wins: it is what the library
	// actually decoded.
	both := brokerConfig(map[string]string{
		"aclEnable":        "true",
		rawBrokerConfigKey: "aclEnable=false\nother=1\n",
	})
	if both["aclEnable"] != "true" {
		t.Fatalf("aclEnable = %q, want the decoded value to win", both["aclEnable"])
	}
	if both["other"] != "1" {
		t.Fatalf("other = %q, want the raw document to fill in the rest", both["other"])
	}
}
