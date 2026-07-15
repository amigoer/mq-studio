package service

import (
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func TestResolveACLCredentials_ConnectionWins(t *testing.T) {
	s := &ConnectionService{}
	conn := &model.Connection{
		EnableACL: true,
		AccessKey: "conn-ak",
		SecretKey: "conn-sk",
	}
	en, ak, sk := s.resolveACLCredentials(conn)
	if !en || ak != "conn-ak" || sk != "conn-sk" {
		t.Fatalf("got enable=%v ak=%q sk=%q", en, ak, sk)
	}
}

func TestResolveACLCredentials_NoACLNoGlobal(t *testing.T) {
	s := &ConnectionService{}
	conn := &model.Connection{EnableACL: false}
	en, ak, sk := s.resolveACLCredentials(conn)
	if en || ak != "" || sk != "" {
		t.Fatalf("expected no ACL, got enable=%v ak=%q sk=%q", en, ak, sk)
	}
}

func TestResolveACLCredentials_GlobalFallback(t *testing.T) {
	ss := NewSettingsService()
	// Mutate in-memory settings (no need to persist)
	ss.mu.Lock()
	ss.settings.GlobalAccessKey = "global-ak"
	ss.settings.GlobalSecretKey = "global-sk"
	ss.mu.Unlock()

	s := &ConnectionService{settingsService: ss}
	conn := &model.Connection{EnableACL: false}
	en, ak, sk := s.resolveACLCredentials(conn)
	if !en || ak != "global-ak" || sk != "global-sk" {
		t.Fatalf("got enable=%v ak=%q sk=%q", en, ak, sk)
	}
}
