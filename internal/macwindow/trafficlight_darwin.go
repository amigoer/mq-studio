//go:build darwin

// Package macwindow adjusts native macOS window chrome that Wails does not
// expose. On other platforms every function is a no-op.
package macwindow

/*
#cgo CFLAGS: -x objective-c -fobjc-arc -Wno-deprecated-declarations
#cgo LDFLAGS: -framework Cocoa
#include "trafficlight_darwin.h"
*/
import "C"

import "unsafe"

// SetTrafficLightPosition moves the window buttons so the cluster starts left
// points from the window's left edge with its vertical centre centreY points
// below the top edge, matching the renderer's title bar.
//
// The position is re-applied automatically after resizes and fullscreen exits,
// which is when AppKit resets it.
func SetTrafficLightPosition(nsWindow unsafe.Pointer, left, centreY float64) {
	if nsWindow == nil {
		return
	}
	C.RLSetTrafficLightPosition(nsWindow, C.double(left), C.double(centreY))
}
