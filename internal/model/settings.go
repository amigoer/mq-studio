// Package model defines the application's data models.
package model

// UIScaleAuto sizes the interface from the window instead of pinning a step.
const UIScaleAuto = "auto"

// ValidUIScale reports whether value names a step on the interface size ladder.
// Keep in step with FONT_SIZES in frontend/src/lib/uiScale.ts.
func ValidUIScale(value string) bool {
	switch value {
	case UIScaleAuto, "12", "13", "14", "15", "16", "18", "20":
		return true
	}
	return false
}

// Close behaviours for the main window.
const (
	// CloseBehaviorMinimizeToTray hides the window and keeps the process alive
	// so the background collector keeps sampling.
	CloseBehaviorMinimizeToTray = "minimizeToTray"
	// CloseBehaviorQuit terminates the application.
	CloseBehaviorQuit = "quit"
)

// AppSettings holds application settings.
type AppSettings struct {
	// General
	Theme           string `json:"theme"`           // Theme: "system" | "light" | "dark"
	Language        string `json:"language"`        // Language: "en" | "zh"
	UIScale         string `json:"uiScale"`         // Interface size: "auto" or a px step
	UIFont          string `json:"uiFont"`          // UI font
	MonospaceFont   string `json:"monospaceFont"`   // Monospace font
	AutoConnectLast bool   `json:"autoConnectLast"` // Auto-connect to last cluster on startup
	AutoCheckUpdate bool   `json:"autoCheckUpdate"` // Check GitHub for a newer release in the background
	CloseBehavior   string `json:"closeBehavior"`   // Close behaviour: "minimizeToTray" | "quit"

	// Connection and network
	ConnectTimeoutMs int    `json:"connectTimeoutMs"` // Connect timeout (ms)
	RequestTimeoutMs int    `json:"requestTimeoutMs"` // Request timeout (ms)
	GlobalAccessKey  string `json:"globalAccessKey"`  // Default AccessKey
	GlobalSecretKey  string `json:"globalSecretKey"`  // Default SecretKey
	SkipTlsVerify    bool   `json:"skipTlsVerify"`    // Skip TLS verification
	ProxyEnabled     bool   `json:"proxyEnabled"`     // Enable proxy
	ProxyType        string `json:"proxyType"`        // Proxy type: "http" | "socks5"
	ProxyHost        string `json:"proxyHost"`        // Proxy host
	ProxyPort        string `json:"proxyPort"`        // Proxy port

	// Monitoring and alerts
	LagAlertThreshold    int  `json:"lagAlertThreshold"`    // Consumer lag alert threshold (0=disabled)
	DiskAlertThreshold   int  `json:"diskAlertThreshold"`   // CommitLog disk alert threshold percent (0=disabled)
	DesktopNotifications bool `json:"desktopNotifications"` // System notification on new alerts

	// Messages and display
	Timezone              string `json:"timezone"`              // Timezone: "local" | "utc"
	TimestampFormat       string `json:"timestampFormat"`       // Timestamp format: "datetime" | "ms"
	AutoFormatJson        bool   `json:"autoFormatJson"`        // Auto-format JSON
	MaxPayloadRenderBytes int    `json:"maxPayloadRenderBytes"` // Message truncation threshold (bytes)
	FetchLimit            int    `json:"fetchLimit"`            // Page fetch size
}

// DefaultSettings returns the default settings.
func DefaultSettings() *AppSettings {
	return &AppSettings{
		Theme:                 "system",
		Language:              "zh",
		UIScale:               UIScaleAuto,
		UIFont:                "system",
		MonospaceFont:         "JetBrains Mono",
		AutoConnectLast:       true,
		AutoCheckUpdate:       true,
		CloseBehavior:         CloseBehaviorMinimizeToTray,
		ConnectTimeoutMs:      3000,
		RequestTimeoutMs:      5000,
		GlobalAccessKey:       "",
		GlobalSecretKey:       "",
		SkipTlsVerify:         false,
		ProxyEnabled:          false,
		ProxyType:             "http",
		ProxyHost:             "",
		ProxyPort:             "",
		LagAlertThreshold:     10000,
		DiskAlertThreshold:    75,
		DesktopNotifications:  false,
		Timezone:              "local",
		TimestampFormat:       "datetime",
		AutoFormatJson:        true,
		MaxPayloadRenderBytes: 512 * 1024, // 500KB
		FetchLimit:            64,
	}
}
