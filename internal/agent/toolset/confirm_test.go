package toolset

import "testing"

// fill replaces in one pass, so a destination named like a placeholder
// appears as named rather than as whatever that placeholder holds.
func TestFillLeavesAPlaceholderInAValueAlone(t *testing.T) {
	got := fill("Delete {{destination}} on {{connection}}?",
		map[string]string{"destination": "{{connection}}", "connection": "scratch"})
	if got != "Delete {{connection}} on scratch?" {
		t.Errorf("got %q", got)
	}
}
