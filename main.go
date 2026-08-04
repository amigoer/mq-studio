// Command rocket-leaf is the Rocket Leaf desktop application.
package main

import (
	"embed"
	"log"
	"runtime"

	"github.com/amigoer/rocket-leaf/internal/app"
	"github.com/amigoer/rocket-leaf/internal/bridge"
	"github.com/amigoer/rocket-leaf/internal/macwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

// version is injected at build time via -ldflags "-X main.version=...".
// The development fallback is intentionally not a release version.
var version = "dev"

const applicationName = "Rocket Leaf"

// Title bar geometry, shared with the renderer. Keep in step with the
// .rl-title-bar rule in frontend/src/styles/app.css.
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
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	window := wailsApp.Window.NewWithOptions(newWindowOptions())
	alignTrafficLights(window)

	return wailsApp.Run()
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
