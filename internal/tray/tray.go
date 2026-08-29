// Package tray puts MQ Studio in the system tray so closing the main window
// can leave the process running and the background collector sampling.
package tray

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Icons carries the tray artwork for every platform. Template is a silhouette
// that macOS tints itself for the light and dark menu bars; Light and Dark are
// the colour variants Windows and Linux switch between by system theme.
type Icons struct {
	Light    []byte
	Dark     []byte
	Template []byte
}

// NavigateEvent carries a sidebar destination to the renderer. The payload is
// one of the NavId values in frontend/src/layout/Sidebar.tsx.
const NavigateEvent = "tray:navigate"

// navTargets are the destinations offered in the menu, in display order.
var navTargets = []string{"home", "topics", "consumers", "messages"}

// labels holds the tray menu strings. They cannot come from the renderer's i18n
// bundles, which the Go process never loads, so the few strings live here.
type labels struct {
	show     string
	settings string
	quit     string
	nav      map[string]string
}

var translations = map[string]labels{
	"zh": {
		show:     "显示主窗口",
		settings: "设置",
		quit:     "退出 MQ Studio",
		nav: map[string]string{
			"home":      "概览",
			"topics":    "主题",
			"consumers": "消费者组",
			"messages":  "消息查询",
		},
	},
	"en": {
		show:     "Show Main Window",
		settings: "Settings",
		quit:     "Quit MQ Studio",
		nav: map[string]string{
			"home":      "Overview",
			"topics":    "Topics",
			"consumers": "Consumer Groups",
			"messages":  "Messages",
		},
	},
}

func labelsFor(language string) labels {
	if found, ok := translations[language]; ok {
		return found
	}
	return translations["en"]
}

// Controller owns the tray icon and keeps its menu in the current language.
type Controller struct {
	app    *application.App
	window *application.WebviewWindow
	tray   *application.SystemTray

	showItem     *application.MenuItem
	navItems     map[string]*application.MenuItem
	settingsItem *application.MenuItem
	quitItem     *application.MenuItem

	language string
}

// New installs the tray icon. Either mouse button opens the menu, whose first
// entry restores the window; the menu is also the only guaranteed way to quit
// on Windows and Linux, where the app has no menu bar of its own.
//
// No click handler is registered on purpose. Wails only routes a tray click
// into native menu tracking when both the click handler and the attached
// window are unset (systrayPreClickCallback in systemtray_darwin.go); setting
// one falls back to a deprecated code path where the left button does nothing
// on current macOS.
func New(
	app *application.App,
	window *application.WebviewWindow,
	icons Icons,
	tooltip string,
	language string,
) *Controller {
	controller := &Controller{
		app:      app,
		window:   window,
		tray:     app.SystemTray.New(),
		navItems: make(map[string]*application.MenuItem, len(navTargets)),
	}
	// SetTemplateIcon is a no-op on Windows, so the icon has to be set the
	// plain way there or the tray would show none at all.
	if runtime.GOOS == "darwin" {
		controller.tray.SetTemplateIcon(icons.Template)
	} else {
		controller.tray.SetIcon(icons.Light)
		controller.tray.SetDarkModeIcon(icons.Dark)
	}
	controller.tray.SetTooltip(tooltip)
	controller.buildMenu()
	controller.SetLanguage(language)
	return controller
}

// buildMenu assembles the menu once. The native menu is bound when the tray
// first runs and is not rebound afterwards, so replacing the menu later would
// leave the visible one stale; only the item labels are updated after this.
func (c *Controller) buildMenu() {
	menu := application.NewMenu()

	c.showItem = menu.Add("")
	c.showItem.OnClick(func(*application.Context) { c.showWindow() })
	menu.AddSeparator()

	for _, target := range navTargets {
		item := menu.Add("")
		item.OnClick(func(*application.Context) { c.navigate(target) })
		c.navItems[target] = item
	}
	menu.AddSeparator()

	c.settingsItem = menu.Add("")
	c.settingsItem.OnClick(func(*application.Context) { c.navigate("settings") })
	menu.AddSeparator()

	c.quitItem = menu.Add("")
	c.quitItem.OnClick(func(*application.Context) { c.app.Quit() })

	c.tray.SetMenu(menu)
}

// SetLanguage relabels the menu. Before the tray runs this only records the
// strings; afterwards MenuItem.SetLabel updates the live native items.
func (c *Controller) SetLanguage(language string) {
	if c == nil || c.showItem == nil {
		return
	}
	if _, known := translations[language]; !known {
		language = "en"
	}
	if c.language == language {
		return
	}
	c.language = language

	text := labelsFor(language)
	c.showItem.SetLabel(text.show)
	c.settingsItem.SetLabel(text.settings)
	c.quitItem.SetLabel(text.quit)
	for target, item := range c.navItems {
		item.SetLabel(text.nav[target])
	}
}

// navigate raises the window and asks the renderer to switch pages.
func (c *Controller) navigate(target string) {
	c.showWindow()
	c.app.Event.Emit(NavigateEvent, target)
}

func (c *Controller) showWindow() {
	if c.window == nil {
		return
	}
	c.window.Show()
	c.window.Focus()
}
