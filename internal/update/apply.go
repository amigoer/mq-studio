package update

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

/*
 * Applying a verified package.
 *
 * Nothing here is behind a build tag: the three routines only assemble command
 * lines and move files, and a Location's Kind can never name the wrong one for
 * the host. Keeping them buildable everywhere is what lets the whole sequence
 * be tested with a fake Commander on any machine, which matters more than usual
 * for code whose failure mode is an application that no longer starts.
 */

// ErrNotInstallable is returned when an update is applied to a build that
// cannot replace itself: a package-manager install, a read-only location, or
// something that was never installed at all.
var ErrNotInstallable = errors.New("this installation cannot be updated in place")

// ErrElevationDeclined reports that the user dismissed the Windows elevation
// prompt. Nothing was installed because nothing was permitted to start, which
// is a different thing to tell someone than a failure.
var ErrElevationDeclined = errors.New("the update was not given permission to install")

// Commander runs external tools. Run waits for the command; Start spawns it and
// returns, which is what the trampolines below need -- they outlive the process
// that started them on purpose.
type Commander interface {
	Run(ctx context.Context, name string, args ...string) error
	Start(name string, args ...string) error
	// Elevate starts a program that may need administrator rights. On Windows
	// that is a different system call from Start, because the one Start uses
	// cannot raise a privilege prompt; everywhere else the two are the same.
	Elevate(name string, args ...string) error
}

// execCommander is the real implementation.
type execCommander struct{}

func (execCommander) Run(ctx context.Context, name string, args ...string) error {
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		if trimmed == "" {
			return fmt.Errorf("%s: %w", name, err)
		}
		return fmt.Errorf("%s: %w: %s", name, err, trimmed)
	}
	return nil
}

func (execCommander) Start(name string, args ...string) error {
	command := exec.Command(name, args...)
	if err := command.Start(); err != nil {
		return err
	}
	// Released rather than waited on: the trampoline is meant to outlive us.
	return command.Process.Release()
}

func (execCommander) Elevate(name string, args ...string) error {
	return elevate(name, args...)
}

// SystemCommander runs updates through the real operating system.
var SystemCommander Commander = execCommander{}

// Apply replaces the installation at location with the verified package, and
// reports whether the caller still has to quit for the change to take effect.
// It always does -- the running image is what is being replaced -- so the
// return exists only to keep the call sites from having to remember.
func Apply(ctx context.Context, commander Commander, location Location, packagePath string) error {
	if !location.CanInstall() {
		return fmt.Errorf("%w (%s)", ErrNotInstallable, location.Blocker)
	}
	if _, err := os.Stat(packagePath); err != nil {
		return fmt.Errorf("the downloaded update is missing: %w", err)
	}
	switch location.Kind {
	case KindAppBundle:
		return applyBundle(ctx, commander, location.Root, packagePath)
	case KindAppImage:
		return applyAppImage(location.Root, packagePath)
	case KindInstaller:
		return applyInstaller(commander, packagePath)
	}
	return fmt.Errorf("%w (%s)", ErrNotInstallable, location.Kind)
}

// applyBundle mounts the disk image and swaps the .app inside it for the one
// running. The image is attached read-only and without a Finder window, and is
// detached again whichever way the swap goes.
func applyBundle(ctx context.Context, commander Commander, bundle, image string) error {
	mount, err := os.MkdirTemp("", "mq-studio-dmg-")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(mount) }()

	if err := commander.Run(ctx, "hdiutil", "attach", image,
		"-mountpoint", mount, "-nobrowse", "-readonly", "-noverify", "-quiet"); err != nil {
		return fmt.Errorf("failed to open the downloaded disk image: %w", err)
	}
	defer func() { _ = commander.Run(context.WithoutCancel(ctx), "hdiutil", "detach", mount, "-force", "-quiet") }()

	// Only ever <name>.app for <name>.app: the image is ours, and a name that
	// does not match means something other than a release was downloaded.
	name := filepath.Base(bundle)
	source := filepath.Join(mount, name)
	if info, err := os.Stat(source); err != nil || !info.IsDir() {
		return fmt.Errorf("the downloaded disk image does not contain %s", name)
	}

	parent := filepath.Dir(bundle)
	staging := filepath.Join(parent, "."+name+".new")
	previous := filepath.Join(parent, "."+name+".old")
	_ = os.RemoveAll(staging)
	_ = os.RemoveAll(previous)

	// ditto rather than a Go walk: it carries the symlinks, the bundle bit and
	// the extended attributes a .app needs to stay launchable.
	if err := commander.Run(ctx, "ditto", source, staging); err != nil {
		_ = os.RemoveAll(staging)
		return fmt.Errorf("failed to copy the new version out of the disk image: %w", err)
	}

	if err := os.Rename(bundle, previous); err != nil {
		_ = os.RemoveAll(staging)
		return fmt.Errorf("failed to move the current version aside: %w", err)
	}
	if err := os.Rename(staging, bundle); err != nil {
		// Put back what was there rather than leave nothing installed.
		_ = os.Rename(previous, bundle)
		_ = os.RemoveAll(staging)
		return fmt.Errorf("failed to move the new version into place: %w", err)
	}
	_ = os.RemoveAll(previous)
	return nil
}

// applyAppImage writes the new image beside the running one and renames it over
// the top. The rename is atomic and leaves the running process on the old inode,
// so the swap is safe while the application is still up.
func applyAppImage(current, downloaded string) error {
	staging := current + ".new"
	if err := copyFile(downloaded, staging, 0o755); err != nil {
		_ = os.Remove(staging)
		return fmt.Errorf("failed to stage the new AppImage: %w", err)
	}
	if err := os.Rename(staging, current); err != nil {
		_ = os.Remove(staging)
		return fmt.Errorf("failed to move the new AppImage into place: %w", err)
	}
	return nil
}

// applyInstaller hands the NSIS installer to Windows and returns. It runs with
// its own window rather than silently: the installer is what handles the files
// of an application that is still shutting down, and a silent run gives the
// user nothing to look at while it does.
//
// Elevate rather than Start, because the installer asks for administrator and
// only one of the two launchers can answer that. Start could not: it fails with
// ERROR_ELEVATION_REQUIRED without ever prompting.
func applyInstaller(commander Commander, installer string) error {
	err := commander.Elevate(installer)
	if err == nil {
		return nil
	}
	// A declined prompt is already a whole sentence about what happened, and
	// the user is the one who caused it. Wrapping it in "failed to start"
	// would report their own answer back to them as a fault.
	if errors.Is(err, ErrElevationDeclined) {
		return err
	}
	return fmt.Errorf("failed to start the installer: %w", err)
}

// Relaunch starts the installed application again once this process is gone.
//
// The wait is what makes it a relaunch rather than a second instance: the
// trampoline polls for the current pid to disappear and only then starts the
// application, so the two never overlap. Windows is left out -- its installer
// owns what happens after the install.
func Relaunch(commander Commander, location Location) error {
	pid := strconv.Itoa(os.Getpid())
	switch location.Kind {
	case KindAppBundle:
		return commander.Start("/bin/sh", "-c",
			waitForExit(pid)+"open "+shellQuote(location.Root))
	case KindAppImage:
		return commander.Start("/bin/sh", "-c",
			waitForExit(pid)+"exec "+shellQuote(location.Root))
	}
	return nil
}

// waitForExit polls rather than waits: the trampoline is not our child, so it
// has nothing to wait on. kill -0 only tests for the process.
func waitForExit(pid string) string {
	return "while kill -0 " + pid + " 2>/dev/null; do sleep 0.2; done; "
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func copyFile(source, destination string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()

	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	// O_CREATE leaves an existing file's mode alone, so it is set explicitly.
	return os.Chmod(destination, mode)
}
