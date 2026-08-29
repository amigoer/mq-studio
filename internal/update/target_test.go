package update

import (
	"path/filepath"
	"testing"
)

// The names have to be exactly what the release workflow attaches, or the
// updater looks for an asset that is not there. Keep in step with PACKAGE_BASE
// in .github/workflows/package.yml.
func TestPackageNameMatchesTheReleaseWorkflow(t *testing.T) {
	cases := []struct {
		target  Target
		version string
		want    string
	}{
		{Target{OS: "mac", Arch: "arm64", Ext: "dmg"}, "0.1.3", "mq-studio-0.1.3-mac-arm64.dmg"},
		{Target{OS: "mac", Arch: "amd64", Ext: "dmg"}, "v0.1.3", "mq-studio-0.1.3-mac-amd64.dmg"},
		{Target{OS: "windows", Arch: "amd64", Ext: "exe"}, "1.0.0", "mq-studio-1.0.0-windows-amd64.exe"},
		{Target{OS: "linux", Arch: "arm64", Ext: "AppImage"}, "2.10.4", "mq-studio-2.10.4-linux-arm64.AppImage"},
		{Target{OS: "linux", Arch: "amd64", Ext: "deb"}, "1.2.3", "mq-studio-1.2.3-linux-amd64.deb"},
	}
	for _, testCase := range cases {
		if got := testCase.target.PackageName(testCase.version); got != testCase.want {
			t.Errorf("PackageName(%q) = %q, want %q", testCase.version, got, testCase.want)
		}
	}
}

func TestBundleRootWalksUpToTheApp(t *testing.T) {
	cases := []struct {
		executable string
		want       string
	}{
		{"/Applications/MQ Studio.app/Contents/MacOS/mq-studio", "/Applications/MQ Studio.app"},
		{"/Users/x/Desktop/MQ Studio.app/Contents/MacOS/mq-studio", "/Users/x/Desktop/MQ Studio.app"},
		{"/usr/local/bin/mq-studio", ""},
		{"/tmp/go-build123/b001/exe/mq-studio", ""},
	}
	for _, testCase := range cases {
		if got := bundleRoot(testCase.executable); got != testCase.want {
			t.Errorf("bundleRoot(%q) = %q, want %q", testCase.executable, got, testCase.want)
		}
	}
}

func anywhere(string) bool { return true }
func nowhere(string) bool  { return false }

func everywhereBut(path string) func(string) bool {
	return func(candidate string) bool { return candidate != path }
}

func TestLocateResolvesEachInstallShape(t *testing.T) {
	bundle := filepath.FromSlash("/Applications/MQ Studio.app")
	cases := []struct {
		name       string
		goos       string
		goarch     string
		executable string
		appImage   string
		writable   func(string) bool
		wantKind   Kind
		wantRoot   string
		wantBlock  Blocker
	}{
		{
			name: "macOS app bundle in Applications",
			goos: "darwin", goarch: "arm64",
			executable: filepath.Join(bundle, "Contents", "MacOS", "mq-studio"),
			writable:   anywhere,
			wantKind:   KindAppBundle, wantRoot: bundle, wantBlock: BlockerNone,
		},
		{
			name: "macOS bundle the user cannot replace",
			goos: "darwin", goarch: "amd64",
			executable: filepath.Join(bundle, "Contents", "MacOS", "mq-studio"),
			writable:   nowhere,
			wantKind:   KindAppBundle, wantRoot: bundle, wantBlock: BlockerReadOnly,
		},
		{
			name: "macOS binary that is not in a bundle",
			goos: "darwin", goarch: "arm64",
			executable: "/usr/local/bin/mq-studio",
			writable:   anywhere,
			wantKind:   KindUnknown, wantBlock: BlockerNotPackaged,
		},
		{
			name: "Windows install elevates rather than being blocked",
			goos: "windows", goarch: "amd64",
			executable: `C:\Program Files\MQ Studio\mq-studio.exe`,
			writable:   nowhere,
			wantKind:   KindInstaller, wantRoot: `C:\Program Files\MQ Studio\mq-studio.exe`, wantBlock: BlockerNone,
		},
		{
			name: "Linux AppImage",
			goos: "linux", goarch: "amd64",
			executable: "/tmp/.mount_abc/usr/bin/mq-studio",
			appImage:   "/home/x/Apps/MQ Studio.AppImage",
			writable:   anywhere,
			wantKind:   KindAppImage, wantRoot: "/home/x/Apps/MQ Studio.AppImage", wantBlock: BlockerNone,
		},
		{
			name: "Linux AppImage on a read-only volume",
			goos: "linux", goarch: "arm64",
			executable: "/tmp/.mount_abc/usr/bin/mq-studio",
			appImage:   "/mnt/ro/MQ Studio.AppImage",
			writable:   everywhereBut("/mnt/ro/MQ Studio.AppImage"),
			wantKind:   KindAppImage, wantRoot: "/mnt/ro/MQ Studio.AppImage", wantBlock: BlockerReadOnly,
		},
		{
			name: "Linux package manager install",
			goos: "linux", goarch: "amd64",
			executable: "/usr/bin/mq-studio",
			writable:   anywhere,
			wantKind:   KindManaged, wantBlock: BlockerPackageManager,
		},
		{
			name: "architecture with no release",
			goos: "linux", goarch: "386",
			executable: "/usr/bin/mq-studio",
			writable:   anywhere,
			wantKind:   KindUnknown, wantBlock: BlockerUnsupported,
		},
		{
			name: "operating system with no release",
			goos: "freebsd", goarch: "amd64",
			executable: "/usr/local/bin/mq-studio",
			writable:   anywhere,
			wantKind:   KindUnknown, wantBlock: BlockerUnsupported,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := locate(testCase.goos, testCase.goarch, testCase.executable, testCase.appImage, testCase.writable)
			if got.Kind != testCase.wantKind {
				t.Errorf("Kind = %q, want %q", got.Kind, testCase.wantKind)
			}
			if got.Root != testCase.wantRoot {
				t.Errorf("Root = %q, want %q", got.Root, testCase.wantRoot)
			}
			if got.Blocker != testCase.wantBlock {
				t.Errorf("Blocker = %q, want %q", got.Blocker, testCase.wantBlock)
			}
			if want := testCase.wantBlock == BlockerNone; got.CanInstall() != want {
				t.Errorf("CanInstall() = %v, want %v", got.CanInstall(), want)
			}
		})
	}
}

func TestWritablePathAnswersForRealPaths(t *testing.T) {
	directory := t.TempDir()
	if !writablePath(directory) {
		t.Error("a fresh temp directory should be writable")
	}
	if writablePath(filepath.Join(directory, "missing")) {
		t.Error("a path that does not exist is not writable")
	}
}
