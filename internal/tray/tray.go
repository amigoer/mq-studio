// Package tray puts MQ Studio in the system tray so closing the main window
// can leave the process running and the background collector sampling.
package tray

import (
	"runtime"
	"slices"
	"sync"

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

// NavigateEvent carries a destination to the renderer.
const NavigateEvent = "tray:navigate"

// NavigateRequest is the tray:navigate payload.
//
// A destination needs both halves now that the shell is a tab per connection:
// Connection is the profile id as a string, which is what the shell keys tabs
// by, and empty means whichever tab is already in front. Page is a PageId from
// frontend/src/design/data/protocols.ts, or one of the two constants below for
// the views that sit beside the tabs; empty leaves the tab where it was.
type NavigateRequest struct {
	Connection string `json:"connection"`
	Page       string `json:"page"`
}

// The two destinations that are not a page inside a tab.
const (
	ConnectionsPage = "connections"
	SettingsPage    = "settings"
)

// Connection is one stored profile as the menu draws it.
type Connection struct {
	// Key is the profile id as a string: what the shell keys its tabs by.
	Key  string
	Name string
	// Family is the broker family in display form, "RocketMQ" rather than the
	// stored kind.
	Family string
	Online bool
}

// Page is one destination in the active tab's sidebar, already translated.
type Page struct {
	ID    string
	Label string
}

// state is everything the menu draws. Each source owns its own fields and the
// controller rebuilds whenever one of them actually changes.
type state struct {
	language      string
	theme         string
	closeBehavior string
	connections   []Connection
	sampling      bool
	// active is the Key of the tab in front, empty when the shell shows none.
	active string
	page   string
	pages  []Page
}

func (s state) equal(other state) bool {
	return s.language == other.language &&
		s.theme == other.theme &&
		s.closeBehavior == other.closeBehavior &&
		s.sampling == other.sampling &&
		s.active == other.active &&
		s.page == other.page &&
		slices.Equal(s.connections, other.connections) &&
		slices.Equal(s.pages, other.pages)
}

// Controller owns the tray icon and keeps its menu in step with the app.
type Controller struct {
	app    *application.App
	window *application.WebviewWindow
	tray   *application.SystemTray

	mu    sync.Mutex
	state state
	write func(Preference, string)
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
		app:    app,
		window: window,
		tray:   app.SystemTray.New(),
		state:  state{language: normalizeLanguage(language)},
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
	// Before the tray runs this only stores the menu; afterwards the same call
	// rebinds the native one, which is what every later rebuild relies on.
	controller.tray.SetMenu(controller.buildMenu(controller.state))
	return controller
}

// Preference names a setting the menu can change.
type Preference string

const (
	PreferenceTheme         Preference = "theme"
	PreferenceLanguage      Preference = "language"
	PreferenceCloseBehavior Preference = "closeBehavior"
)

// OnPreference registers the writer the preferences submenu calls.
//
// Nothing is redrawn from the click itself. Wails moves the radio mark before
// the handler runs, and the settings change that follows is what redraws the
// menu, so a write that fails puts the mark back where it belongs.
func (c *Controller) OnPreference(write func(Preference, string)) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.write = write
}

// SetPreferences records the settings the menu both shows and changes. They
// arrive together because one settings save reports all of them.
func (c *Controller) SetPreferences(theme string, language string, closeBehavior string) {
	c.apply(func(next *state) {
		next.theme = theme
		next.language = normalizeLanguage(language)
		next.closeBehavior = closeBehavior
	})
}

// SetConnections replaces the profile list the connections submenu draws,
// along with whether the collector is sampling. The two arrive together
// because sampling follows the open connection, and one update is one rebuild.
func (c *Controller) SetConnections(connections []Connection, sampling bool) {
	c.apply(func(next *state) {
		next.connections = slices.Clone(connections)
		next.sampling = sampling
	})
}

// SetShell records what the renderer is showing: which tab is in front, which
// page it is on, and the pages that tab's protocol offers.
func (c *Controller) SetShell(active string, page string, pages []Page) {
	c.apply(func(next *state) {
		next.active = active
		next.page = page
		next.pages = slices.Clone(pages)
	})
}

// apply rebuilds the menu when the mutation actually changed something.
//
// The guard is load-bearing, not an optimisation: the sources overlap - one
// connect writes the profile list and then, once the renderer follows, the
// shell state - and every rebuild replaces every native menu item.
//
// A preferences click rebuilds from inside the open menu. That is safe because
// SetMenu dispatches to the main queue, and queued work does not run while the
// run loop is in menu tracking mode: the rebuild lands once the menu has
// closed. Holding the lock across it cannot deadlock for the same reason it is
// needed - menu callbacks run on their own goroutines, never on the thread the
// rebuild is handed to.
func (c *Controller) apply(mutate func(*state)) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	next := c.state
	mutate(&next)
	if next.equal(c.state) {
		return
	}
	c.state = next
	c.tray.SetMenu(c.buildMenu(next))
}

// setPreference persists one preference, if a writer has been registered.
func (c *Controller) setPreference(preference Preference, value string) {
	c.mu.Lock()
	write := c.write
	c.mu.Unlock()
	if write == nil {
		return
	}
	write(preference, value)
}

// navigate asks for a page in whichever tab is in front.
func (c *Controller) navigate(page string) {
	c.navigateTo("", page)
}

// navigateTo raises the window and asks the renderer for a destination.
func (c *Controller) navigateTo(connection string, page string) {
	c.showWindow()
	c.app.Event.Emit(NavigateEvent, NavigateRequest{Connection: connection, Page: page})
}

func (c *Controller) showWindow() {
	if c.window == nil {
		return
	}
	c.window.Show()
	c.window.Focus()
}
