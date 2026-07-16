package connection

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the connection operations required by the HTTP transport.
type Service interface {
	GetConnections() []*model.Connection
	GetConnection(int) (*model.Connection, error)
	AddConnection(string, string, string, int, bool, string, string, string) (*model.Connection, error)
	UpdateConnection(int, string, string, string, int, bool, string, string, string) (*model.Connection, error)
	DeleteConnection(int) error
	Connect(int) error
	Disconnect(int) error
	SetDefaultConnection(int) error
	ConnectDefault() error
	TestConnection(int) (string, error)
}
