// Command mq-studio is the MQ Studio desktop application.
package main

import (
	"embed"
	"log"
	"runtime"

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

// trayIcon is the menu bar / notification area icon, downscaled from
// build/appicon.png. `wails3 generate icons` does not touch this file.
//
//go:embed build/trayicon.png
var trayIcon []byte

// version is injected at build time via -ldflags "-X main.version=...".
// The development fallback is intentionally not a release version.
var version = "dev"

const applicationName = "MQ Studio"

// Title bar geometry, shared with the renderer. Keep in step with the
// .mqs-title-bar rule in frontend/src/styles/app.css.
const (
	titleBarHeight   = 44.0
	trafficLightLeft = 16.0
)

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

	wailsApp := application.New(application.Options{
		Name:        applicationName,
		Description: "Local-first desktop client for RocketMQ",
		Services:    bridge.Services(services, version),
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

	window := wailsApp.Window.NewWithOptions(newWindowOptions())
	alignTrafficLights(window)

	trayController := tray.New(
		wailsApp, window, trayIcon, applicationName, services.Settings.GetSettings().Language)
	services.Settings.OnChange(func(settings *model.AppSettings) {
		trayController.SetLanguage(settings.Language)
	})
	interceptClose(wailsApp, window, services)

	return wailsApp.Run()
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
			window.NativeWindow(), trafficLightLeft, titleBarHeight/2)
	}
	window.OnWindowEvent(events.Mac.WindowDidBecomeKey, apply)
}
