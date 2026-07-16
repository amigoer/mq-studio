package connection

import (
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func TestRedactConnectionNeverReturnsCredentials(t *testing.T) {
	view := redactConnection(&model.Connection{
		ID: 7, Name: "prod", AccessKey: "access-secret", SecretKey: "secret-secret", EnableACL: true,
	})
	if view.AccessKey != "" || view.SecretKey != "" {
		t.Fatal("credentials must not appear in connection view")
	}
	if !view.AccessKeyConfigured || !view.SecretKeyConfigured {
		t.Fatal("credential configured flags should be preserved")
	}
}
