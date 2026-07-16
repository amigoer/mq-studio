package settings

import (
	"testing"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func TestProvidersReturnConfiguredValues(t *testing.T) {
	service, _ := newTestService(t)
	next := *model.DefaultSettings()
	next.ConnectTimeoutMs = 2500
	next.RequestTimeoutMs = 7500
	next.FetchLimit = 128
	next.AutoConnectLast = false
	if _, err := service.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}

	if got := service.GetConnectTimeout(); got != 2500*time.Millisecond {
		t.Fatalf("connect timeout = %s", got)
	}
	if got := service.GetRequestTimeout(); got != 7500*time.Millisecond {
		t.Fatalf("request timeout = %s", got)
	}
	if got := service.GetFetchLimit(); got != 128 {
		t.Fatalf("fetch limit = %d", got)
	}
	if service.GetAutoConnectLast() {
		t.Fatal("auto-connect setting was not retained")
	}
}

func TestProvidersUseSafeFallbacks(t *testing.T) {
	service := &Service{settings: &model.AppSettings{}}
	if got := service.GetConnectTimeout(); got != 3*time.Second {
		t.Fatalf("connect timeout fallback = %s", got)
	}
	if got := service.GetRequestTimeout(); got != 5*time.Second {
		t.Fatalf("request timeout fallback = %s", got)
	}
	if got := service.GetFetchLimit(); got != 64 {
		t.Fatalf("fetch limit fallback = %d", got)
	}
}

func TestDefaultSettingsEnableAutomaticConnection(t *testing.T) {
	service, _ := newTestService(t)
	if !service.GetAutoConnectLast() {
		t.Fatal("automatic connection should be enabled by default")
	}
}
