// Package bridge exposes the business services to the frontend as Wails services.
//
// Every exported method on a bridge service becomes a callable binding in the
// renderer. The bridge is the only place allowed to reshape business data for
// the UI: it redacts secrets that must never leave the Go process and resolves
// the credential modes the settings and connection forms rely on.
package bridge

import (
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Services returns every bridge service in registration order.
//
// The shell service is passed in rather than built here: its consumer is the
// system tray, which cannot exist until the application is running, so the
// caller keeps the handle and registers the listener afterwards.
func Services(services *app.Services, version string, shell *ShellService) []application.Service {
	return []application.Service{
		application.NewService(&SystemService{settings: services.Settings, version: version}),
		application.NewService(&WindowService{}),
		application.NewService(shell),
		application.NewService(&ConnectionService{service: services.Connections}),
		application.NewService(&SettingsService{service: services.Settings}),
		application.NewService(&ClusterService{service: services.Cluster}),
		application.NewService(&TopicService{service: services.Topics}),
		application.NewService(&ConsumerService{service: services.Consumers}),
		application.NewService(&MessageService{service: services.Messages}),
		application.NewService(&ACLService{service: services.ACL}),
		application.NewService(&DriverService{conns: services.Conns}),
		application.NewService(&RoutingService{service: services.Routing}),
	}
}
