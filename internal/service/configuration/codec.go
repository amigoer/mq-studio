package configuration

import (
	"encoding/json"
	"fmt"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/model"
)

const currentExportVersion = 2

// connectionStore is the exported shape.
//
// It carries records rather than profiles because a profile's secrets are
// json:"-": exporting profiles directly would silently write a config file
// with every credential dropped.
type connectionStore struct {
	Connections []*model.ConnectionRecord `json:"connections"`
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
		var list []*model.ConnectionRecord
		if listErr := json.Unmarshal(data, &list); listErr != nil {
			return connectionStore{}, err
		}
		store.Connections = list
	}
	if store.Connections == nil {
		store.Connections = make([]*model.ConnectionRecord, 0)
	}

	// Normalise before anything reads a credential: a version 1 payload keeps
	// them in the pre-kind top-level fields, and only Profile folds those into
	// the secrets map.
	for i, record := range store.Connections {
		if record != nil {
			store.Connections[i] = model.NewConnectionRecord(record.Profile())
		}
	}
	if !decryptCredentials {
		return store, nil
	}
	for _, connection := range store.Connections {
		if connection == nil {
			continue
		}
		for key, stored := range connection.Secrets {
			plain, err := crypto.Decrypt(stored, key)
			if err != nil {
				return connectionStore{}, fmt.Errorf("解密连接 %q 的 %s 失败: %w", connection.Name, key, err)
			}
			connection.SetSecret(key, plain)
		}
	}
	return store, nil
}
