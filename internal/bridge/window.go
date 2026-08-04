package bridge

import "github.com/wailsapp/wails/v3/pkg/application"

// MainWindowName identifies the single application window.
const MainWindowName = "main"

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

// BackgroundColour returns the window colour for the requested appearance.
func BackgroundColour(dark bool) application.RGBA {
	if dark {
		return backgroundDark
	}
	return backgroundLight
}
