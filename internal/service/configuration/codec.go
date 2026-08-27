package configuration

import (
	"encoding/json"
	"fmt"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/model"
)

const currentExportVersion = 2

type connectionStore struct {
	Connections []*model.Connection `json:"connections"`
}

type exportPayload struct {
	Version         int                `json:"version"`
	ContainsSecrets bool               `json:"containsSecrets"`
	ExportedAt      string             `json:"exportedAt"`
	Settings        *model.AppSettings `json:"settings"`
	Connections     connectionStore    `json:"connections"`
}

type importPayload struct {
	Version     int                `json:"version"`
	Settings    *model.AppSettings `json:"settings"`
	Connections json.RawMessage    `json:"connections"`
}

func decodeConnectionStore(data []byte, decryptCredentials bool) (connectionStore, error) {
	var store connectionStore
	if err := json.Unmarshal(data, &store); err != nil {
		var list []*model.Connection
		if listErr := json.Unmarshal(data, &list); listErr != nil {
			return connectionStore{}, err
		}
		store.Connections = list
	}
	if store.Connections == nil {
		store.Connections = make([]*model.Connection, 0)
	}
	if !decryptCredentials {
		return store, nil
	}
	for _, connection := range store.Connections {
		if connection == nil {
			continue
		}
		if connection.AccessKey != "" {
			plain, err := crypto.Decrypt(connection.AccessKey, "accessKey")
			if err != nil {
				return connectionStore{}, fmt.Errorf("解密连接 %q 的 AccessKey 失败: %w", connection.Name, err)
			}
			connection.AccessKey = plain
		}
		if connection.SecretKey != "" {
			plain, err := crypto.Decrypt(connection.SecretKey, "secretKey")
			if err != nil {
				return connectionStore{}, fmt.Errorf("解密连接 %q 的 SecretKey 失败: %w", connection.Name, err)
			}
			connection.SecretKey = plain
		}
	}
	return store, nil
}
