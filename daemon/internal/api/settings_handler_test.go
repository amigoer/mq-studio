package api

import (
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func TestRedactSettingsReportsCredentialStateWithoutSecrets(t *testing.T) {
	view := redactSettings(&model.AppSettings{
		GlobalAccessKey: "global-ak",
		GlobalSecretKey: "global-sk",
	})
	if view.GlobalAccessKey != "" || view.GlobalSecretKey != "" {
		t.Fatal("global credentials must not be returned to the renderer")
	}
	if !view.GlobalAccessKeyConfigured || !view.GlobalSecretKeyConfigured {
		t.Fatal("global credential configured flags should be returned")
	}
}
