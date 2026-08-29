package update

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeCommander records what would have been run, and can be told to fail one
// of the commands so the recovery paths are exercised too.
type fakeCommander struct {
	ran     []string
	started []string
	failOn  string
	// onRun runs before the command is recorded, so a test can make the world
	// look the way the real tool would have left it.
	onRun func(name string, args []string) error
}

func (f *fakeCommander) Run(_ context.Context, name string, args ...string) error {
	line := strings.Join(append([]string{name}, args...), " ")
	f.ran = append(f.ran, line)
	if f.onRun != nil {
		if err := f.onRun(name, args); err != nil {
			return err
		}
	}
	if f.failOn != "" && strings.Contains(line, f.failOn) {
		return fmt.Errorf("%s failed", name)
	}
	return nil
}

func (f *fakeCommander) Start(name string, args ...string) error {
	f.started = append(f.started, strings.Join(append([]string{name}, args...), " "))
	if f.failOn != "" && strings.Contains(name, f.failOn) {
		return fmt.Errorf("%s failed", name)
	}
	return nil
}

// bundle writes a directory that stands in for a .app, with one file inside so
// a replacement can be told apart from the original.
func bundle(t *testing.T, path, marker string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(path, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "Contents", "MacOS", "mq-studio"), []byte(marker), 0o755); err != nil {
		t.Fatal(err)
	}
}

func bundleMarker(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join(path, "Contents", "MacOS", "mq-studio"))
	if err != nil {
		t.Fatalf("reading the bundle marker: %v", err)
	}
	return string(content)
}

// dmgCommander stands in for hdiutil and ditto: attach lays the new bundle out
// in the mount point it was given, and ditto copies a directory.
func dmgCommander(t *testing.T, newMarker string) *fakeCommander {
	t.Helper()
	commander := &fakeCommander{}
	commander.onRun = func(name string, args []string) error {
		switch {
		case name == "hdiutil" && args[0] == "attach":
			mount := args[slicesIndex(args, "-mountpoint")+1]
			bundle(t, filepath.Join(mount, "MQ Studio.app"), newMarker)
		case name == "ditto":
			return copyTree(args[0], args[1])
		}
		return nil
	}
	return commander
}

func slicesIndex(values []string, want string) int {
	for index, value := range values {
		if value == want {
			return index
		}
	}
	return -1
}

func copyTree(source, destination string) error {
	return filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(destination, strings.TrimPrefix(path, source))
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, content, info.Mode())
	})
}

func TestApplyBundleSwapsTheAppAndDetachesTheImage(t *testing.T) {
	applications := t.TempDir()
	app := filepath.Join(applications, "MQ Studio.app")
	bundle(t, app, "old")
	image := filepath.Join(t.TempDir(), "mq-studio-1.0.0-mac-arm64.dmg")
	if err := os.WriteFile(image, []byte("disk image"), 0o644); err != nil {
		t.Fatal(err)
	}

	commander := dmgCommander(t, "new")
	location := Location{Kind: KindAppBundle, Root: app}
	if err := Apply(context.Background(), commander, location, image); err != nil {
		t.Fatalf("Apply() error = %v", err)
	}

	if got := bundleMarker(t, app); got != "new" {
		t.Errorf("bundle contains %q, want the new build", got)
	}
	if len(commander.ran) != 3 {
		t.Fatalf("ran %v, want attach, ditto and detach", commander.ran)
	}
	if !strings.HasPrefix(commander.ran[0], "hdiutil attach") {
		t.Errorf("first command = %q", commander.ran[0])
	}
	for _, flag := range []string{"-nobrowse", "-readonly", "-noverify"} {
		if !strings.Contains(commander.ran[0], flag) {
			t.Errorf("attach is missing %s: %q", flag, commander.ran[0])
		}
	}
	if !strings.HasPrefix(commander.ran[2], "hdiutil detach") {
		t.Errorf("last command = %q, want the image to be detached", commander.ran[2])
	}
	// Nothing may be left beside the bundle once the swap is done.
	entries, err := os.ReadDir(applications)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("left %d entries beside the bundle, want only the bundle", len(entries))
	}
}

func TestApplyBundleDetachesEvenWhenTheCopyFails(t *testing.T) {
	app := filepath.Join(t.TempDir(), "MQ Studio.app")
	bundle(t, app, "old")
	image := filepath.Join(t.TempDir(), "package.dmg")
	if err := os.WriteFile(image, []byte("disk image"), 0o644); err != nil {
		t.Fatal(err)
	}

	commander := dmgCommander(t, "new")
	commander.failOn = "ditto"
	err := Apply(context.Background(), commander, Location{Kind: KindAppBundle, Root: app}, image)
	if err == nil {
		t.Fatal("Apply() should report the failed copy")
	}
	if got := bundleMarker(t, app); got != "old" {
		t.Errorf("bundle contains %q, want the original to be left alone", got)
	}
	if !strings.HasPrefix(commander.ran[len(commander.ran)-1], "hdiutil detach") {
		t.Errorf("the image was not detached: %v", commander.ran)
	}
}

func TestApplyBundleRejectsAnImageWithoutTheApp(t *testing.T) {
	app := filepath.Join(t.TempDir(), "MQ Studio.app")
	bundle(t, app, "old")
	image := filepath.Join(t.TempDir(), "package.dmg")
	if err := os.WriteFile(image, []byte("disk image"), 0o644); err != nil {
		t.Fatal(err)
	}

	// An attach that mounts nothing: the image is not one of ours.
	commander := &fakeCommander{}
	err := Apply(context.Background(), commander, Location{Kind: KindAppBundle, Root: app}, image)
	if err == nil || !strings.Contains(err.Error(), "MQ Studio.app") {
		t.Fatalf("Apply() error = %v, want it to name the missing bundle", err)
	}
	if got := bundleMarker(t, app); got != "old" {
		t.Errorf("bundle contains %q, want the original to be left alone", got)
	}
}

func TestApplyAppImageReplacesTheFileInPlace(t *testing.T) {
	directory := t.TempDir()
	current := filepath.Join(directory, "MQ Studio.AppImage")
	if err := os.WriteFile(current, []byte("old image"), 0o755); err != nil {
		t.Fatal(err)
	}
	downloaded := filepath.Join(t.TempDir(), "mq-studio-1.0.0-linux-amd64.AppImage")
	if err := os.WriteFile(downloaded, []byte("new image"), 0o644); err != nil {
		t.Fatal(err)
	}

	commander := &fakeCommander{}
	if err := Apply(context.Background(), commander, Location{Kind: KindAppImage, Root: current}, downloaded); err != nil {
		t.Fatalf("Apply() error = %v", err)
	}

	content, err := os.ReadFile(current)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "new image" {
		t.Errorf("AppImage contains %q, want the new one", content)
	}
	info, err := os.Stat(current)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("mode = %v, want the AppImage to stay executable", info.Mode())
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("left %d files behind, want only the AppImage", len(entries))
	}
}

func TestApplyInstallerHandsTheFileToWindows(t *testing.T) {
	installer := filepath.Join(t.TempDir(), "mq-studio-1.0.0-windows-amd64.exe")
	if err := os.WriteFile(installer, []byte("installer"), 0o755); err != nil {
		t.Fatal(err)
	}

	commander := &fakeCommander{}
	location := Location{Kind: KindInstaller, Root: `C:\Program Files\MQ Studio\mq-studio.exe`}
	if err := Apply(context.Background(), commander, location, installer); err != nil {
		t.Fatalf("Apply() error = %v", err)
	}
	if len(commander.started) != 1 || commander.started[0] != installer {
		t.Fatalf("started %v, want the installer itself", commander.started)
	}
	if len(commander.ran) != 0 {
		t.Errorf("ran %v, want nothing waited on", commander.ran)
	}
}

func TestApplyRefusesAnInstallItCannotTouch(t *testing.T) {
	packagePath := filepath.Join(t.TempDir(), "package.deb")
	if err := os.WriteFile(packagePath, []byte("package"), 0o644); err != nil {
		t.Fatal(err)
	}
	location := Location{Kind: KindManaged, Blocker: BlockerPackageManager}
	err := Apply(context.Background(), &fakeCommander{}, location, packagePath)
	if !errors.Is(err, ErrNotInstallable) {
		t.Fatalf("Apply() error = %v, want ErrNotInstallable", err)
	}
}

func TestApplyReportsAMissingPackage(t *testing.T) {
	location := Location{Kind: KindAppImage, Root: filepath.Join(t.TempDir(), "app.AppImage")}
	err := Apply(context.Background(), &fakeCommander{}, location, filepath.Join(t.TempDir(), "gone.AppImage"))
	if err == nil {
		t.Fatal("Apply() should report a package that is not on disk")
	}
}

func TestRelaunchWaitsForThisProcessToGo(t *testing.T) {
	pid := fmt.Sprint(os.Getpid())
	cases := []struct {
		kind     Kind
		root     string
		contains string
	}{
		{KindAppBundle, "/Applications/MQ Studio.app", "open '/Applications/MQ Studio.app'"},
		{KindAppImage, "/home/x/MQ Studio.AppImage", "exec '/home/x/MQ Studio.AppImage'"},
	}
	for _, testCase := range cases {
		commander := &fakeCommander{}
		if err := Relaunch(commander, Location{Kind: testCase.kind, Root: testCase.root}); err != nil {
			t.Fatalf("Relaunch(%s) error = %v", testCase.kind, err)
		}
		if len(commander.started) != 1 {
			t.Fatalf("Relaunch(%s) started %v", testCase.kind, commander.started)
		}
		line := commander.started[0]
		if !strings.Contains(line, "kill -0 "+pid) {
			t.Errorf("Relaunch(%s) does not wait for this process: %q", testCase.kind, line)
		}
		if !strings.Contains(line, testCase.contains) {
			t.Errorf("Relaunch(%s) = %q, want it to contain %q", testCase.kind, line, testCase.contains)
		}
	}
}

// Windows relaunches through its own installer, so nothing is spawned here.
func TestRelaunchLeavesWindowsToItsInstaller(t *testing.T) {
	commander := &fakeCommander{}
	if err := Relaunch(commander, Location{Kind: KindInstaller, Root: `C:\x\mq-studio.exe`}); err != nil {
		t.Fatalf("Relaunch() error = %v", err)
	}
	if len(commander.started) != 0 {
		t.Errorf("started %v, want nothing", commander.started)
	}
}

func TestShellQuoteSurvivesAnApostrophe(t *testing.T) {
	// A path under a home directory named with an apostrophe would otherwise
	// end the quoted string early and run the rest as a command.
	got := shellQuote("/Users/o'brien/MQ Studio.app")
	if want := `'/Users/o'\''brien/MQ Studio.app'`; got != want {
		t.Fatalf("shellQuote() = %s, want %s", got, want)
	}
}
