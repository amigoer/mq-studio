// Package model 定义应用程序的数据模型
package model

// AppSettings 应用设置
type AppSettings struct {
	// 通用设置
	Theme           string `json:"theme"`           // 主题: "system" | "light" | "dark"
	Language        string `json:"language"`        // 语言: "en" | "zh"
	FontSize        int    `json:"fontSize"`        // 字体大小(px): 12-18
	UIFont          string `json:"uiFont"`          // 界面字体
	MonospaceFont   string `json:"monospaceFont"`   // 等宽字体
	AutoConnectLast bool   `json:"autoConnectLast"` // 启动时自动连接上次集群

	// 连接与网络
	ConnectTimeoutMs int    `json:"connectTimeoutMs"` // 连接超时(ms)
	RequestTimeoutMs int    `json:"requestTimeoutMs"` // 请求超时(ms)
	GlobalAccessKey  string `json:"globalAccessKey"`  // 默认 AccessKey
	GlobalSecretKey  string `json:"globalSecretKey"`  // 默认 SecretKey
	SkipTlsVerify   bool   `json:"skipTlsVerify"`    // 跳过 TLS 校验
	ProxyEnabled    bool   `json:"proxyEnabled"`     // 启用代理
	ProxyType       string `json:"proxyType"`        // 代理类型: "http" | "socks5"
	ProxyHost       string `json:"proxyHost"`        // 代理地址
	ProxyPort       string `json:"proxyPort"`        // 代理端口

	// 监控与告警
	LagAlertThreshold int `json:"lagAlertThreshold"` // 消费积压告警阈值(0=关闭)

	// 消息与显示
	Timezone              string `json:"timezone"`              // 时区: "local" | "utc"
	TimestampFormat       string `json:"timestampFormat"`       // 时间戳格式: "datetime" | "ms"
	AutoFormatJson        bool   `json:"autoFormatJson"`        // JSON 自动格式化
	MaxPayloadRenderBytes int    `json:"maxPayloadRenderBytes"` // 消息截断阈值(字节)
	FetchLimit            int    `json:"fetchLimit"`            // 单页拉取数量
}

// DefaultSettings 返回默认设置
func DefaultSettings() *AppSettings {
	return &AppSettings{
		Theme:                "system",
		Language:              "zh",
		FontSize:              14,
		UIFont:                "system",
		MonospaceFont:         "JetBrains Mono",
		AutoConnectLast:       true,
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
		Timezone:              "local",
		TimestampFormat:       "datetime",
		AutoFormatJson:        true,
		MaxPayloadRenderBytes: 512 * 1024, // 500KB
		FetchLimit:            64,
	}
}
