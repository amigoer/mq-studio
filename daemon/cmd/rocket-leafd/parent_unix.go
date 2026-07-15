//go:build unix

package main

import "syscall"

func processAlive(pid int) bool {
	// Signal 0 checks existence / permission without delivering a signal.
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
