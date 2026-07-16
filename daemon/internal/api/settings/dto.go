package settings

import (
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type settingsView struct {
	model.AppSettings
	GlobalAccessKeyConfigured bool `json:"globalAccessKeyConfigured"`
	GlobalSecretKeyConfigured bool `json:"globalSecretKeyConfigured"`
}

type settingsUpdateRequest struct {
	model.AppSettings
	GlobalCredentialsMode string `json:"globalCredentialsMode"`
}

type importConfigRequest struct {
	Content string `json:"content"`
}

func redactSettings(settings *model.AppSettings) *settingsView {
	if settings == nil {
		return nil
	}
	view := *settings
	accessConfigured := strings.TrimSpace(view.GlobalAccessKey) != ""
	secretConfigured := strings.TrimSpace(view.GlobalSecretKey) != ""
	view.GlobalAccessKey = ""
	view.GlobalSecretKey = ""
	return &settingsView{
		AppSettings:               view,
		GlobalAccessKeyConfigured: accessConfigured,
		GlobalSecretKeyConfigured: secretConfigured,
	}
}
