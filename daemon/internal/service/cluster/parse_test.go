package cluster

import "testing"

func TestParseHelpers(t *testing.T) {
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
	values := appendCapped([]int{1, 2, 3}, 4, 3)
	if len(values) != 3 || values[0] != 2 || values[2] != 4 {
		t.Fatalf("appendCapped = %#v", values)
	}
}
