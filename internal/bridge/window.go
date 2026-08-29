package bridge

import (
	"github.com/amigoer/mq-studio/internal/macwindow"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// MainWindowName identifies the single application window.
const MainWindowName = "main"

// Title bar geometry shared with the renderer. Keep in step with the .tb2 and
// .tb2--mac rules in frontend/src/design/tokens.css.
const (
	TitleBarHeight   = 40.0
	TrafficLightLeft = 16.0
)

// ZoomEvent asks the renderer to change its UI scale. The payload is one of
// "in", "out" or "reset"; see useUIScale in the frontend.
const ZoomEvent = "ui:zoom"

// Window chrome colours mirror the renderer --background token, so the native
// frame never flashes the wrong shade while the webview paints.
var (
	backgroundLight = application.NewRGB(0xFF, 0xFF, 0xFF)
	backgroundDark  = application.NewRGB(0x12, 0x12, 0x12)
)

// WindowService keeps the native window chrome in step with the renderer theme.
//
// Everything else about the window - minimise, maximise, close - is driven from
// the frontend through the Wails window runtime and needs no binding here.
type WindowService struct{}

// SetAppearance applies the light or dark window background colour.
func (s *WindowService) SetAppearance(dark bool) {
	window, found := application.Get().Window.GetByName(MainWindowName)
	if !found {
		return
	}
	if dark {
		window.SetBackgroundColour(backgroundDark)
		return
	}
	window.SetBackgroundColour(backgroundLight)
}

// SetTitleBarHeight re-centres the macOS window buttons in a title bar the
// renderer has scaled. The buttons are native and keep their own size, so only
// the bar's height changes with the UI scale. No-op off macOS.
func (s *WindowService) SetTitleBarHeight(height float64) {
	if height <= 0 {
		return
	}
	window, found := application.Get().Window.GetByName(MainWindowName)
	if !found {
		return
	}
	macwindow.SetTrafficLightPosition(window.NativeWindow(), TrafficLightLeft, height/2)
}

// BackgroundColour returns the window colour for the requested appearance.
func BackgroundColour(dark bool) application.RGBA {
	if dark {
		return backgroundDark
	}
	return backgroundLight
}
