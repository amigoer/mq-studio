//go:build !windows

package update

// elevate is Start everywhere but Windows: no other platform gates starting a
// program on a privilege prompt, and the only caller is the Windows installer.
func elevate(name string, args ...string) error {
	return execCommander{}.Start(name, args...)
}
