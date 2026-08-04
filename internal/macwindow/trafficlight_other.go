//go:build !darwin

// Package macwindow adjusts native macOS window chrome that Wails does not
// expose. On other platforms every function is a no-op.
package macwindow

import "unsafe"

// SetTrafficLightPosition does nothing outside macOS, where the renderer draws
// the window buttons itself.
func SetTrafficLightPosition(_ unsafe.Pointer, _, _ float64) {}
