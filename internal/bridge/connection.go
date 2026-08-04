package bridge

import (
	"errors"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/service/connection"
)

// ConnectionService exposes RocketMQ connection management to the frontend.
type ConnectionService struct {
	service *connection.Service
}

// ConnectionView is the connection shape sent to the frontend.
//
// AccessKey and SecretKey are always empty: the stored credentials never leave
// the Go process. The frontend decides what to render from the *Configured
// flags instead.
type ConnectionView struct {
	ID                  int                    `json:"id"`
	Name                string                 `json:"name"`
	Env                 model.ConnectionEnv    `json:"env"`
	NameServer          string                 `json:"nameServer"`
	TimeoutSec          int                    `json:"timeoutSec"`
	EnableACL           bool                   `json:"enableACL"`
	AccessKey           string                 `json:"accessKey"`
	SecretKey           string                 `json:"secretKey"`
	AccessKeyConfigured bool                   `json:"accessKeyConfigured"`
	SecretKeyConfigured bool                   `json:"secretKeyConfigured"`
	Status              model.ConnectionStatus `json:"status"`
	LastCheck           string                 `json:"lastCheck"`
	IsDefault           bool                   `json:"isDefault"`
	Remark              string                 `json:"remark"`
}

// ConnectionInput carries a connection form submission.
type ConnectionInput struct {
	Name            string `json:"name"`
	Env             string `json:"env"`
	NameServer      string `json:"nameServer"`
	TimeoutSec      int    `json:"timeoutSec"`
	EnableACL       bool   `json:"enableACL"`
	AccessKey       string `json:"accessKey"`
	SecretKey       string `json:"secretKey"`
	Remark          string `json:"remark"`
	CredentialsMode string `json:"credentialsMode"`
}

func redactConnection(conn *model.Connection) *ConnectionView {
	if conn == nil {
		return nil
	}
	return &ConnectionView{
		ID: conn.ID, Name: conn.Name, Env: conn.Env, NameServer: conn.NameServer,
		TimeoutSec: conn.TimeoutSec, EnableACL: conn.EnableACL,
		AccessKeyConfigured: strings.TrimSpace(conn.AccessKey) != "",
		SecretKeyConfigured: strings.TrimSpace(conn.SecretKey) != "",
		Status:              conn.Status, LastCheck: conn.LastCheck,
		IsDefault: conn.IsDefault, Remark: conn.Remark,
	}
}

func redactConnections(connections []*model.Connection) []*ConnectionView {
	result := make([]*ConnectionView, 0, len(connections))
	for _, conn := range connections {
		if view := redactConnection(conn); view != nil {
			result = append(result, view)
		}
	}
	return result
}

// List returns every configured connection with credentials redacted.
func (s *ConnectionService) List() []*ConnectionView {
	return redactConnections(s.service.GetConnections())
}

// Add stores a new connection and returns it with credentials redacted.
func (s *ConnectionService) Add(input ConnectionInput) (*ConnectionView, error) {
	created, err := s.service.AddConnection(input.Name, input.Env, input.NameServer,
		input.TimeoutSec, input.EnableACL, input.AccessKey, input.SecretKey, input.Remark)
	if err != nil {
		return nil, err
	}
	return redactConnection(created), nil
}

// Update applies a connection form submission, resolving the credentials mode
// against the currently stored secrets.
func (s *ConnectionService) Update(id int, input ConnectionInput) (*ConnectionView, error) {
	current, err := s.service.GetConnection(id)
	if err != nil {
		return nil, err
	}
	accessKey, secretKey := input.AccessKey, input.SecretKey
	switch input.CredentialsMode {
	case "preserve", "":
		if input.EnableACL && accessKey == "" && secretKey == "" {
			accessKey, secretKey = current.AccessKey, current.SecretKey
		}
	case "clear":
		input.EnableACL, accessKey, secretKey = false, "", ""
	case "replace":
	default:
		return nil, errors.New("invalid credentials mode")
	}
	updated, err := s.service.UpdateConnection(id, input.Name, input.Env, input.NameServer,
		input.TimeoutSec, input.EnableACL, accessKey, secretKey, input.Remark)
	if err != nil {
		return nil, err
	}
	return redactConnection(updated), nil
}

// Remove deletes a connection.
func (s *ConnectionService) Remove(id int) error {
	return s.service.DeleteConnection(id)
}

// Connect opens the RocketMQ client for a connection.
func (s *ConnectionService) Connect(id int) error {
	return s.service.Connect(id)
}

// Disconnect closes the RocketMQ client for a connection.
func (s *ConnectionService) Disconnect(id int) error {
	return s.service.Disconnect(id)
}

// ConnectDefault opens the client for the default connection.
func (s *ConnectionService) ConnectDefault() error {
	return s.service.ConnectDefault()
}

// SetDefault marks a connection as the default one.
func (s *ConnectionService) SetDefault(id int) error {
	return s.service.SetDefaultConnection(id)
}

// Test probes a connection and reports the resulting status.
func (s *ConnectionService) Test(id int) (string, error) {
	return s.service.TestConnection(id)
}
