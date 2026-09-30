package main

import (
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
)

func TestAllowanceReadsRepeatedFlags(t *testing.T) {
	allow, err := allowance([]string{"--allow", "mutate", "--allow=scratch=destructive"})
	if err != nil {
		t.Fatal(err)
	}
	if allow.Everywhere != catalog.BlastMutate || allow.Named["scratch"] != catalog.BlastDestructive {
		t.Errorf("read as %+v", allow)
	}

	allow, err = allowance(nil)
	if err != nil || allow.Everywhere != catalog.BlastRead || len(allow.Named) != 0 {
		t.Errorf("no flags read as %+v, %v", allow, err)
	}
}

// "--allow destructive scratch" reads like a grant on scratch. Ignoring the
// word the flag package leaves over would make it one on every connection.
func TestAllowanceRefusesAWordLeftOver(t *testing.T) {
	_, err := allowance([]string{"--allow", "destructive", "scratch"})
	if err == nil {
		t.Fatal("a connection name after the tier widened every connection instead")
	}
	if !strings.Contains(err.Error(), "--allow <name>=<tier>") {
		t.Errorf("the refusal does not show the form that would have worked: %v", err)
	}
}
