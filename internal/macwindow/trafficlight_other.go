//go:build !darwin

// Package macwindow adjusts native macOS window chrome that Wails does not
// expose. On other platforms every function is a no-op.
package macwindow

import "unsafe"

// SetTrafficLightPosition does nothing outside macOS, the only platform whose
// native window buttons overlap the renderer's title bar.
func SetTrafficLightPosition(_ unsafe.Pointer, _, _ float64) {}
