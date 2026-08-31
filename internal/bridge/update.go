package bridge

import (
	"context"
	"time"

	"github.com/amigoer/mq-studio/internal/update"
	"github.com/wailsapp/wails/v3/pkg/application"
)

/*
 * The update lifecycle, as the renderer sees it.
 *
 * Every decision -- when to check, whether to download, whether to install --
 * belongs to the Manager. This is the doorway: it forwards calls, and it owns
 * the one thing Go cannot do from inside the manager, which is to end the
 * process once the running image has been replaced.
 */

// quitDelay lets the binding's reply reach the renderer before the process
// goes. Without it the window dies mid-call and the user is left looking at a
// button that never came back.
const quitDelay = 400 * time.Millisecond

// installTimeout bounds the swap. It runs on the shutdown path, where a hung
// hdiutil would otherwise leave the application unable to exit.
const installTimeout = 3 * time.Minute

// UpdateService exposes the update lifecycle to the renderer.
type UpdateService struct {
	manager *update.Manager
}

// NewUpdateService wraps a manager for the renderer.
func NewUpdateService(manager *update.Manager) *UpdateService {
	return &UpdateService{manager: manager}
}

// State returns everything the update panel draws.
func (s *UpdateService) State() update.State {
	return s.manager.State()
}

// Check asks GitHub now, whatever the policy says. Pressing the button is the
// one case that reports every outcome, including "you are up to date".
func (s *UpdateService) Check() (update.State, error) {
	return s.manager.Check(context.Background(), true)
}

// Download fetches and verifies the package for the newest release.
func (s *UpdateService) Download() error {
	return s.manager.Download(context.Background(), update.Result{})
}

// Cancel stops a download in flight.
func (s *UpdateService) Cancel() { s.manager.Cancel() }

// Install applies the downloaded package and quits, having arranged for the
// application to start again once this process is gone.
func (s *UpdateService) Install() error {
	ctx, cancel := context.WithTimeout(context.Background(), installTimeout)
	defer cancel()
	if err := s.manager.Install(ctx); err != nil {
		return err
	}
	go func() {
		time.Sleep(quitDelay)
		application.Get().Quit()
	}()
	return nil
}

// Skip stops a release from being announced again.
func (s *UpdateService) Skip(version string) { s.manager.Skip(version) }
