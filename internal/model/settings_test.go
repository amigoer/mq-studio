package model

import "testing"

func TestDefaultSettingsSaneBounds(t *testing.T) {
	s := DefaultSettings()
	if s == nil {
		t.Fatal("DefaultSettings should not return nil")
	}
	if s.Theme != "system" {
		t.Fatalf("theme = %q", s.Theme)
	}
	if s.FontSize < 12 || s.FontSize > 18 {
		t.Fatalf("fontSize out of range: %d", s.FontSize)
	}
	if s.CloseBehavior != CloseBehaviorMinimizeToTray {
		t.Fatalf("closeBehavior default = %q", s.CloseBehavior)
	}
	if s.LagAlertThreshold != 10000 {
		t.Fatalf("lag default = %d", s.LagAlertThreshold)
	}
	if s.DiskAlertThreshold != 75 {
		t.Fatalf("disk default = %d", s.DiskAlertThreshold)
	}
	if s.DesktopNotifications {
		t.Fatal("desktop notifications should default off")
	}
	if s.MaxPayloadRenderBytes < 64*1024 {
		t.Fatalf("payload limit too small: %d", s.MaxPayloadRenderBytes)
	}
	if s.FetchLimit <= 0 {
		t.Fatalf("fetchLimit = %d", s.FetchLimit)
	}
}
