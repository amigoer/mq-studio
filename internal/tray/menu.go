package tray

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// online and offline mark a profile's state inside its label rather than as a
// bitmap: the radio mark already owns the state column beside it, and the two
// answer different questions - connected, versus the tab you are looking at.
const (
	onlineMark  = "●"
	offlineMark = "○"
)

// buildMenu draws the whole menu from one state snapshot.
//
// Rebuilding wholesale rather than relabelling in place is what lets the
// connection and page sections change length: Wails exposes SetLabel and
// SetHidden on a live item, but no way to insert one.
func (c *Controller) buildMenu(current state) *application.Menu {
	text := labelsFor(current.language)
	menu := application.NewMenu()

	online := 0
	for _, connection := range current.connections {
		if connection.Online {
			online++
		}
	}
	menu.Add(text.summary(online, len(current.connections))).SetEnabled(false)
	menu.Add(text.sampling(current.sampling)).SetEnabled(false)
	menu.AddSeparator()

	menu.Add(text.show).OnClick(func(*application.Context) { c.showWindow() })
	menu.AddSeparator()

	c.addConnections(menu, text, current)
	c.addPages(menu, text, current)
	menu.AddSeparator()

	c.addPreferences(menu, text, current)
	menu.Add(text.settings).OnClick(func(*application.Context) { c.navigate(SettingsPage) })
	menu.AddSeparator()

	menu.Add(text.quit).OnClick(func(*application.Context) { c.app.Quit() })
	return menu
}

// addConnections lists the stored profiles, each opening or raising its tab.
//
// Clicking one sends no page: the tab keeps whatever it was last showing,
// which is the only answer that does not lose the user's place.
func (c *Controller) addConnections(menu *application.Menu, text labels, current state) {
	submenu := menu.AddSubmenu(text.connections)
	for _, connection := range current.connections {
		key := connection.Key
		submenu.
			AddRadio(connectionLabel(connection), key == current.active).
			OnClick(func(*application.Context) { c.navigateTo(key, "") })
	}
	if len(current.connections) > 0 {
		submenu.AddSeparator()
	}
	submenu.Add(text.manage).OnClick(func(*application.Context) { c.navigate(ConnectionsPage) })
}

// addPages offers the active tab's sidebar, as the renderer last reported it.
//
// The submenu is absent rather than empty when there is nothing to offer: with
// no tab in front there is no page to go to, and before the renderer has
// reported, Go has no idea which pages the tab's protocol even has.
func (c *Controller) addPages(menu *application.Menu, text labels, current state) {
	if len(current.pages) == 0 {
		return
	}
	submenu := menu.AddSubmenu(text.goTo)
	for _, page := range current.pages {
		id := page.ID
		submenu.
			AddRadio(page.Label, id == current.page).
			OnClick(func(*application.Context) { c.navigate(id) })
	}
}

func connectionLabel(connection Connection) string {
	mark := offlineMark
	if connection.Online {
		mark = onlineMark
	}
	if connection.Family == "" {
		return fmt.Sprintf("%s %s", mark, connection.Name)
	}
	return fmt.Sprintf("%s %s · %s", mark, connection.Name, connection.Family)
}

// option is one radio choice: the value written when it is picked, and the
// label it is picked by.
type option struct {
	value string
	label string
}

// addPreferences offers the three settings worth changing without opening the
// window. They are laid out flat under disabled headings rather than as three
// more submenus: a tray menu three levels deep is worse than one that shows
// every choice at once, and a heading closes the radio group above it just as
// a separator would.
func (c *Controller) addPreferences(menu *application.Menu, text labels, current state) {
	submenu := menu.AddSubmenu(text.preferences)

	groups := []struct {
		preference Preference
		heading    string
		selected   string
		options    []option
	}{
		{PreferenceTheme, text.theme, current.theme, []option{
			{"system", text.themeSystem},
			{"light", text.themeLight},
			{"dark", text.themeDark},
		}},
		{PreferenceLanguage, text.language, current.language, []option{
			// Endonyms: a language is named in itself, not in the current one.
			{"zh", "简体中文"},
			{"en", "English"},
		}},
		{PreferenceCloseBehavior, text.closing, current.closeBehavior, []option{
			{"minimizeToTray", text.closeTray},
			{"quit", text.closeQuit},
		}},
	}

	for index, group := range groups {
		if index > 0 {
			submenu.AddSeparator()
		}
		submenu.Add(group.heading).SetEnabled(false)
		for _, choice := range group.options {
			preference, value := group.preference, choice.value
			submenu.
				AddRadio(choice.label, value == group.selected).
				OnClick(func(*application.Context) { c.setPreference(preference, value) })
		}
	}
}
