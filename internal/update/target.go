package update

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

/*
 * Where the running build lives, and what an update is allowed to do to it.
 *
 * The release workflow names every artifact `mq-studio-<version>-<os>-<arch>.<ext>`
 * (see PACKAGE_BASE in .github/workflows/package.yml), so the app can work out
 * which file it needs without being told. What it cannot work out from the name
 * alone is whether it may replace itself: a .deb the package manager owns needs
 * root, and a build running out of a source tree is not an installation at all.
 */

// Kind is how the running build was installed. It decides both the asset to
// fetch and the way it is applied.
type Kind string

const (
	// KindAppBundle is a macOS .app, shipped inside a .dmg.
	KindAppBundle Kind = "appBundle"
	// KindInstaller is a Windows install, replaced by re-running the NSIS
	// installer.
	KindInstaller Kind = "installer"
	// KindAppImage is a Linux single-file AppImage, replaced in place.
	KindAppImage Kind = "appImage"
	// KindManaged is a Linux .deb or .rpm install, owned by the package
	// manager.
	KindManaged Kind = "managed"
	// KindUnknown is a bare binary or a `wails3 dev` run.
	KindUnknown Kind = "unknown"
)

// Blocker says why the running build cannot install an update itself. The
// values are keys, not prose: the renderer translates them.
type Blocker string

const (
	// BlockerNone means the update can be applied in place.
	BlockerNone Blocker = ""
	// BlockerPackageManager means apt/dnf owns the files and needs root.
	BlockerPackageManager Blocker = "packageManager"
	// BlockerReadOnly means the install location is not writable by this user.
	BlockerReadOnly Blocker = "readOnly"
	// BlockerNotPackaged means this is not an installed application.
	BlockerNotPackaged Blocker = "notPackaged"
	// BlockerUnsupported means no release is built for this OS or architecture.
	BlockerUnsupported Blocker = "unsupported"
)

// Target names the release asset a build installs from.
type Target struct {
	OS   string `json:"os"`
	Arch string `json:"arch"`
	Ext  string `json:"ext"`
}

// PackageName is the canonical release asset name for a version. Keep in step
// with PACKAGE_BASE in .github/workflows/package.yml.
func (t Target) PackageName(version string) string {
	return fmt.Sprintf("mq-studio-%s-%s-%s.%s", strings.TrimPrefix(version, "v"), t.OS, t.Arch, t.Ext)
}

// Location is where the running build lives and what may be done to it.
type Location struct {
	Kind   Kind   `json:"kind"`
	Target Target `json:"target"`
	// Root is what applying an update replaces: the .app bundle on macOS, the
	// AppImage file on Linux, the installed executable on Windows. Empty when
	// nothing can be replaced.
	Root string `json:"root"`
	// Blocker is why this build cannot install an update itself, "" when it can.
	Blocker Blocker `json:"blocker"`
}

// CanInstall reports whether the app may download and apply an update itself.
func (l Location) CanInstall() bool { return l.Blocker == BlockerNone }

// releaseArch maps a Go architecture onto the ones the workflow builds.
func releaseArch(goarch string) (string, bool) {
	switch goarch {
	case "amd64", "arm64":
		return goarch, true
	}
	return "", false
}

// bundleRoot walks up from an executable to the .app it lives in, or returns
// "" when it is not inside one. `/A/MQ Studio.app/Contents/MacOS/mq-studio`
// resolves to `/A/MQ Studio.app`.
func bundleRoot(executable string) string {
	for directory := filepath.Dir(executable); ; {
		if strings.EqualFold(filepath.Ext(directory), ".app") {
			return directory
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			return ""
		}
		directory = parent
	}
}

// locate resolves a Location from explicit inputs so the rules can be tested
// on any host. writable reports whether a path can be replaced by this user.
func locate(goos, goarch, executable, appImage string, writable func(string) bool) Location {
	arch, supported := releaseArch(goarch)
	if !supported {
		return Location{Kind: KindUnknown, Blocker: BlockerUnsupported}
	}

	switch goos {
	case "darwin":
		location := Location{Kind: KindAppBundle, Target: Target{OS: "mac", Arch: arch, Ext: "dmg"}}
		root := bundleRoot(executable)
		if root == "" {
			location.Kind = KindUnknown
			location.Blocker = BlockerNotPackaged
			return location
		}
		location.Root = root
		// The bundle is replaced by renaming it, which writes to the directory
		// holding it rather than to the bundle itself.
		if !writable(filepath.Dir(root)) {
			location.Blocker = BlockerReadOnly
		}
		return location

	case "windows":
		location := Location{Kind: KindInstaller, Target: Target{OS: "windows", Arch: arch, Ext: "exe"}}
		if executable == "" {
			location.Kind = KindUnknown
			location.Blocker = BlockerNotPackaged
			return location
		}
		// No writability check: the NSIS installer is launched elevated and
		// raises its own prompt, so the install directory need not be ours.
		location.Root = executable
		return location

	case "linux":
		if appImage == "" {
			// Everything that is not an AppImage came from a .deb or .rpm as
			// far as this can tell, and those are the package manager's to
			// replace. Guessing wrong only costs the in-app install: the
			// release page is still one click away.
			return Location{Kind: KindManaged, Target: Target{OS: "linux", Arch: arch, Ext: "deb"}, Blocker: BlockerPackageManager}
		}
		location := Location{
			Kind:   KindAppImage,
			Target: Target{OS: "linux", Arch: arch, Ext: "AppImage"},
			Root:   appImage,
		}
		if !writable(appImage) {
			location.Blocker = BlockerReadOnly
		}
		return location
	}

	return Location{Kind: KindUnknown, Blocker: BlockerUnsupported}
}

// writablePath reports whether this process can replace the given path.
func writablePath(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	if info.IsDir() {
		// Directories answer honestly only when actually written to: the mode
		// bits say nothing about ACLs or a read-only mount.
		probe, err := os.CreateTemp(path, ".mq-studio-update-*")
		if err != nil {
			return false
		}
		name := probe.Name()
		_ = probe.Close()
		_ = os.Remove(name)
		return true
	}
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
}

// Locate resolves where this build is installed and whether it can update
// itself. APPIMAGE is set by the AppImage runtime to the image's own path.
func Locate() Location {
	executable, err := os.Executable()
	if err != nil {
		return Location{Kind: KindUnknown, Blocker: BlockerNotPackaged}
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	return locate(runtime.GOOS, runtime.GOARCH, executable, os.Getenv("APPIMAGE"), writablePath)
}
