package tray

import "fmt"

// labels holds the tray menu's own strings.
//
// The renderer's i18n bundles never reach the Go process, so the chrome
// strings live here. The per-protocol page labels deliberately do not: the
// renderer reports those already translated, which is what keeps six
// protocols' navigation - and its share of the bundles - out of Go.
type labels struct {
	show        string
	connections string
	manage      string
	goTo        string
	settings    string
	quit        string

	empty string
	// online takes the online count and the total, in that order.
	online      string
	samplingOn  string
	samplingOff string

	// Preferences. The wording follows the settings page, so the two places
	// offering the same choice do not name it differently.
	preferences string
	theme       string
	themeSystem string
	themeLight  string
	themeDark   string
	language    string
	closing     string
	closeTray   string
	closeQuit   string
}

var translations = map[string]labels{
	"zh": {
		show:        "显示主窗口",
		connections: "连接",
		manage:      "连接管理…",
		goTo:        "前往",
		settings:    "设置…",
		quit:        "退出 MQ Studio",
		empty:       "尚未添加连接",
		online:      "%d/%d 个连接在线",
		samplingOn:  "后台采集：进行中",
		samplingOff: "后台采集：已暂停",
		preferences: "偏好",
		theme:       "主题",
		themeSystem: "跟随系统",
		themeLight:  "浅色",
		themeDark:   "深色",
		language:    "界面语言",
		closing:     "关闭主窗口时",
		closeTray:   "最小化到系统托盘",
		closeQuit:   "退出应用",
	},
	"en": {
		show:        "Show Main Window",
		connections: "Connections",
		manage:      "Manage Connections…",
		goTo:        "Go To",
		settings:    "Settings…",
		quit:        "Quit MQ Studio",
		empty:       "No connections yet",
		online:      "%d of %d connections online",
		samplingOn:  "Background sampling: running",
		samplingOff: "Background sampling: paused",
		preferences: "Preferences",
		theme:       "Theme",
		themeSystem: "Follow system",
		themeLight:  "Light",
		themeDark:   "Dark",
		language:    "Interface language",
		closing:     "When the main window closes",
		closeTray:   "Minimise to the system tray",
		closeQuit:   "Quit the app",
	},
}

// normalizeLanguage falls back to the language every string is written in.
func normalizeLanguage(language string) string {
	if _, known := translations[language]; known {
		return language
	}
	return "en"
}

func labelsFor(language string) labels {
	return translations[normalizeLanguage(language)]
}

// summary is the disabled first line: the one thing the tray can report while
// the window is hidden and the menu is closed.
func (l labels) summary(online, total int) string {
	if total == 0 {
		return l.empty
	}
	return fmt.Sprintf(l.online, online, total)
}

// sampling names what the collector is doing. It is not the connection count
// restated: the collector reads one family, so a lone Kafka connection is
// online with nothing being sampled.
func (l labels) sampling(running bool) string {
	if running {
		return l.samplingOn
	}
	return l.samplingOff
}
