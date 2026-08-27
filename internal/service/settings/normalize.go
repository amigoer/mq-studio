package settings

import (
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

func normalize(settings model.AppSettings) model.AppSettings {
	defaults := model.DefaultSettings()
	if settings.Theme != "system" && settings.Theme != "light" && settings.Theme != "dark" {
		settings.Theme = defaults.Theme
	}
	if settings.Language != "zh" && settings.Language != "en" {
		settings.Language = defaults.Language
	}
	if settings.FontSize < 12 || settings.FontSize > 18 {
		settings.FontSize = defaults.FontSize
	}
	if settings.CloseBehavior != model.CloseBehaviorMinimizeToTray &&
		settings.CloseBehavior != model.CloseBehaviorQuit {
		settings.CloseBehavior = defaults.CloseBehavior
	}
	if strings.TrimSpace(settings.UIFont) == "" {
		settings.UIFont = defaults.UIFont
	}
	if strings.TrimSpace(settings.MonospaceFont) == "" {
		settings.MonospaceFont = defaults.MonospaceFont
	}
	if settings.ConnectTimeoutMs < 500 || settings.ConnectTimeoutMs > 300000 {
		settings.ConnectTimeoutMs = defaults.ConnectTimeoutMs
	}
	if settings.RequestTimeoutMs < 500 || settings.RequestTimeoutMs > 300000 {
		settings.RequestTimeoutMs = defaults.RequestTimeoutMs
	}
	if settings.LagAlertThreshold < 0 {
		settings.LagAlertThreshold = 0
	}
	if settings.DiskAlertThreshold < 0 {
		settings.DiskAlertThreshold = 0
	}
	if settings.DiskAlertThreshold > 100 {
		settings.DiskAlertThreshold = 100
	}
	if settings.Timezone != "local" && settings.Timezone != "utc" {
		settings.Timezone = defaults.Timezone
	}
	if settings.TimestampFormat != "datetime" && settings.TimestampFormat != "ms" {
		settings.TimestampFormat = defaults.TimestampFormat
	}
	if settings.MaxPayloadRenderBytes < 64*1024 || settings.MaxPayloadRenderBytes > 4*1024*1024 {
		settings.MaxPayloadRenderBytes = defaults.MaxPayloadRenderBytes
	}
	if settings.FetchLimit <= 0 || settings.FetchLimit > 1000 {
		settings.FetchLimit = defaults.FetchLimit
	}
	if settings.ProxyType != "http" && settings.ProxyType != "socks5" {
		settings.ProxyType = defaults.ProxyType
	}
	settings.GlobalAccessKey = strings.TrimSpace(settings.GlobalAccessKey)
	return settings
}
