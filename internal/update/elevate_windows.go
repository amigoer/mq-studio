package update

import (
	"errors"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// elevate starts a program through ShellExecute rather than CreateProcess.
//
// CreateProcess, which is what os/exec uses, never reads a binary's manifest
// and never shows the UAC consent dialog. Against an installer that asks for
// administrator it does not prompt and does not run -- it fails outright with
// ERROR_ELEVATION_REQUIRED. ShellExecute is the only launcher that elevates, so
// for an installer it is the only one that works at all.
func elevate(name string, args ...string) error {
	verb, err := windows.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	var params *uint16
	if len(args) > 0 {
		if params, err = windows.UTF16PtrFromString(windows.ComposeCommandLine(args)); err != nil {
			return err
		}
	}
	directory, err := windows.UTF16PtrFromString(filepath.Dir(name))
	if err != nil {
		return err
	}

	err = windows.ShellExecute(0, verb, file, params, directory, windows.SW_SHOWNORMAL)
	if errors.Is(err, windows.ERROR_CANCELLED) {
		// Dismissing the prompt is an answer, not a fault. Reported as its own
		// error so the renderer can say what happened rather than show the user
		// a failure they caused deliberately.
		return ErrElevationDeclined
	}
	return err
}
