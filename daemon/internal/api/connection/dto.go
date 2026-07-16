package connection

import (
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type connectionView struct {
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

type connectionRequest struct {
	Name        string `json:"name"`
	Env         string `json:"env"`
	NameServer  string `json:"nameServer"`
	TimeoutSec  int    `json:"timeoutSec"`
	EnableACL   bool   `json:"enableACL"`
	AccessKey   string `json:"accessKey"`
	SecretKey   string `json:"secretKey"`
	Remark      string `json:"remark"`
	Credentials string `json:"credentialsMode"`
}

func redactConnection(conn *model.Connection) *connectionView {
	if conn == nil {
		return nil
	}
	return &connectionView{
		ID: conn.ID, Name: conn.Name, Env: conn.Env, NameServer: conn.NameServer,
		TimeoutSec: conn.TimeoutSec, EnableACL: conn.EnableACL,
		AccessKeyConfigured: strings.TrimSpace(conn.AccessKey) != "",
		SecretKeyConfigured: strings.TrimSpace(conn.SecretKey) != "",
		Status:              conn.Status, LastCheck: conn.LastCheck, IsDefault: conn.IsDefault, Remark: conn.Remark,
	}
}

func redactConnections(connections []*model.Connection) []*connectionView {
	result := make([]*connectionView, 0, len(connections))
	for _, connection := range connections {
		if view := redactConnection(connection); view != nil {
			result = append(result, view)
		}
	}
	return result
}
