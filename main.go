// Command mq-studio is the MQ Studio desktop application.
package main

import (
	"embed"
	"log"
	"runtime"
	"strconv"

	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/bridge"
	"github.com/amigoer/mq-studio/internal/macwindow"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/tray"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

// Tray artwork, drawn from the matching build/*.svg. Wails squares the image
// to the status bar thickness, so the 2:1 wordmark takes the full width and
// gets about half that in height. `wails3 generate icons` does not touch them.
var (
	//go:embed build/trayicon.png
	trayIcon []byte
	//go:embed build/trayicon-darkmode.png
	trayIconDark []byte
	//go:embed build/trayicon-template.png
	trayIconTemplate []byte
)

// version is injected at build time via -ldflags "-X main.version=...".
// The development fallback is intentionally not a release version.
var version = "dev"

const applicationName = "MQ Studio"

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	services, err := app.New()
	if err != nil {
		return err
	}
	defer services.Close()

	// The shell service is built here because its consumer, the tray, cannot
	// exist until the application does: the listener is registered below.
	shellService, onShellReport := bridge.NewShellService()

	wailsApp := application.New(application.Options{
		Name:        applicationName,
		Description: "Local-first desktop client for RocketMQ",
		Services:    bridge.Services(services, version, shellService),
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			// The tray keeps the process alive with no window on screen; the
			// closing hook below decides when the application actually quits.
			// The activation policy stays Regular so the Dock icon remains.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	wailsApp.Menu.Set(applicationMenu(wailsApp))

	window := wailsApp.Window.NewWithOptions(newWindowOptions())
	alignTrafficLights(window)

	trayController := tray.New(
		wailsApp, window,
		tray.Icons{Light: trayIcon, Dark: trayIconDark, Template: trayIconTemplate},
		applicationName, services.Settings.GetSettings().Language)
	bindTray(trayController, services, onShellReport)
	// Settings now have two writers. The renderer paints from its own copy, so
	// it has to hear about the tray's writes; it hears about its own too, and
	// re-reading what it just saved costs nothing.
	services.Settings.OnChange(func(*model.AppSettings) {
		wailsApp.Event.Emit(bridge.SettingsEvent, nil)
	})
	interceptClose(wailsApp, window, services)

	return wailsApp.Run()
}

// bindTray keeps the tray menu in step with the three things it draws: the
// preferences, the stored connections and whatever the renderer is showing.
//
// Only the last of those comes from the window. The other two are read from Go
// directly, which is what lets the menu still be right after the window has
// been hidden for an hour.
func bindTray(
	controller *tray.Controller,
	services *app.Services,
	onShellReport func(func(active string, page string, pages []bridge.ShellPage)),
) {
	publishConnections := func(profiles []*model.ConnectionProfile) {
		controller.SetConnections(trayConnections(profiles), services.Collector.Sampling())
	}
	publishConnections(services.Connections.GetConnections())

	publishPreferences := func(settings *model.AppSettings) {
		controller.SetPreferences(settings.Theme, settings.Language, settings.CloseBehavior)
	}
	publishPreferences(services.Settings.GetSettings())

	services.Settings.OnChange(publishPreferences)
	services.Connections.OnChange(publishConnections)
	controller.OnPreference(func(preference tray.Preference, value string) {
		next := *services.Settings.GetSettings()
		switch preference {
		case tray.PreferenceTheme:
			next.Theme = value
		case tray.PreferenceLanguage:
			next.Language = value
		case tray.PreferenceCloseBehavior:
			next.CloseBehavior = value
		}
		if _, err := services.Settings.UpdateSettings(next); err != nil {
			log.Printf("[tray] failed to apply %s: %v", preference, err)
		}
	})
	onShellReport(func(active string, page string, pages []bridge.ShellPage) {
		controller.SetShell(active, page, trayPages(pages))
	})
}

// trayConnections reshapes stored profiles into what the menu draws.
func trayConnections(profiles []*model.ConnectionProfile) []tray.Connection {
	items := make([]tray.Connection, 0, len(profiles))
	for _, profile := range profiles {
		if profile == nil {
			continue
		}
		items = append(items, tray.Connection{
			// The shell keys its tabs by the profile id as a string.
			Key:    strconv.Itoa(profile.ID),
			Name:   profile.Name,
			Family: profile.Kind.DisplayName(),
			Online: profile.Status == model.StatusOnline,
		})
	}
	return items
}

func trayPages(pages []bridge.ShellPage) []tray.Page {
	items := make([]tray.Page, 0, len(pages))
	for _, page := range pages {
		items = append(items, tray.Page{ID: page.ID, Label: page.Label})
	}
	return items
}

// interceptClose routes the close button through the user's preference. The
// hook runs ahead of the Wails listener that destroys the window, so cancelling
// the event is what keeps the process alive.
//
// Every native close path - the macOS traffic light, the renderer's own close
// button on Windows and Linux - arrives here as events.Common.WindowClosing.
func interceptClose(
	wailsApp *application.App,
	window *application.WebviewWindow,
	services *app.Services,
) {
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		event.Cancel()
		if services.Settings.GetSettings().CloseBehavior == model.CloseBehaviorMinimizeToTray {
			window.Hide()
			return
		}
		// Quit explicitly rather than letting the window be destroyed:
		// ApplicationShouldTerminateAfterLastWindowClosed is off, so a plain
		// close would leave the process running without a window.
		wailsApp.Quit()
	})
}

func newWindowOptions() application.WebviewWindowOptions {
	options := application.WebviewWindowOptions{
		Name:      bridge.MainWindowName,
		Title:     applicationName,
		Width:     1152,
		Height:    780,
		MinWidth:  1024,
		MinHeight: 750,
		URL:       "/",
		// The renderer paints its own title bar on every platform; macOS keeps
		// the native frame so the traffic lights stay in place.
		Frameless:        runtime.GOOS != "darwin",
		BackgroundColour: bridge.BackgroundColour(false),
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBarHidden,
		},
	}
	return options
}

// alignTrafficLights centres the macOS window buttons in the renderer's title
// bar. The native window only exists once the app is running, so the first
// placement waits for the window to become key.
func alignTrafficLights(window *application.WebviewWindow) {
	if runtime.GOOS != "darwin" {
		return
	}
	apply := func(*application.WindowEvent) {
		macwindow.SetTrafficLightPosition(
			window.NativeWindow(), bridge.TrafficLightLeft, bridge.TitleBarHeight/2)
	}
	window.OnWindowEvent(events.Mac.WindowDidBecomeKey, apply)
}

// zoomCommands maps the View menu's zoom entries to the renderer's UI scale.
var zoomCommands = map[application.Role]string{
	application.ZoomIn:    "in",
	application.ZoomOut:   "out",
	application.ResetZoom: "reset",
}

// applicationMenu is the platform's default menu with those three entries
// retargeted. Zoom is the renderer's own UI scale - it drives the container
// queries the boards reflow on - so the webview's page zoom, which the default
// entries drive, would silently stack a second scale on top of it.
func applicationMenu(wailsApp *application.App) *application.Menu {
	menu := application.DefaultApplicationMenu()
	for role, command := range zoomCommands {
		item := menu.FindByRole(role)
		if item == nil {
			continue
		}
		/*
		 * The role's own accelerator is CmdOrCtrl+plus, which AppKit never
		 * matches: typing + takes Shift, and the mask is Command alone. `=` is
		 * the same physical key and does match, so the menu carries that and
		 * useUIScale reads the shifted press the menu cannot claim.
		 */
		if role == application.ZoomIn {
			item.SetAccelerator("CmdOrCtrl+=")
		}
		item.OnClick(func(*application.Context) {
			wailsApp.Event.Emit(bridge.ZoomEvent, command)
		})
	}
	return menu
}
