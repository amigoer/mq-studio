package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"

	"github.com/amigoer/rocket-leaf/internal/crypto"
	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/storage/atomicfile"
)

func (s *Service) loadFromFile() error {
	data, err := os.ReadFile(s.dataFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		log.Printf("[SettingsService] failed to parse settings file: %v", err)
		return nil
	}
	normalizeLegacyFontSize(raw)

	fixedData, err := json.Marshal(raw)
	if err != nil {
		return fmt.Errorf("failed to normalize settings data: %w", err)
	}
	loaded := model.DefaultSettings()
	if err := json.Unmarshal(fixedData, loaded); err != nil {
		log.Printf("[SettingsService] failed to decode settings: %v", err)
	}

	if loaded.GlobalAccessKey != "" {
		loaded.GlobalAccessKey, err = crypto.Decrypt(loaded.GlobalAccessKey, "globalAccessKey")
		if err != nil {
			return fmt.Errorf("failed to decrypt global AccessKey: %w", err)
		}
	}
	if loaded.GlobalSecretKey != "" {
		loaded.GlobalSecretKey, err = crypto.Decrypt(loaded.GlobalSecretKey, "globalSecretKey")
		if err != nil {
			return fmt.Errorf("failed to decrypt global SecretKey: %w", err)
		}
	}

	normalized := normalize(*loaded)
	s.settings = &normalized
	return nil
}

func normalizeLegacyFontSize(raw map[string]json.RawMessage) {
	rawFontSize, ok := raw["fontSize"]
	if !ok {
		return
	}
	var legacyValue string
	if json.Unmarshal(rawFontSize, &legacyValue) != nil {
		return
	}
	fontSizes := map[string]int{"small": 12, "medium": 14, "large": 16}
	fontSize := 14
	if mapped, ok := fontSizes[legacyValue]; ok {
		fontSize = mapped
	}
	raw["fontSize"], _ = json.Marshal(fontSize)
	log.Printf("[SettingsService] converted legacy fontSize %q to %d", legacyValue, fontSize)
}

func marshalForDisk(settings model.AppSettings) ([]byte, error) {
	toSave := settings
	var err error
	if toSave.GlobalAccessKey != "" {
		toSave.GlobalAccessKey, err = crypto.Encrypt(toSave.GlobalAccessKey, "globalAccessKey")
		if err != nil {
			return nil, fmt.Errorf("failed to encrypt global AccessKey: %w", err)
		}
	}
	if toSave.GlobalSecretKey != "" {
		toSave.GlobalSecretKey, err = crypto.Encrypt(toSave.GlobalSecretKey, "globalSecretKey")
		if err != nil {
			return nil, fmt.Errorf("failed to encrypt global SecretKey: %w", err)
		}
	}
	return json.MarshalIndent(&toSave, "", "  ")
}

// saveLocked persists settings while the caller holds the write lock.
func (s *Service) saveLocked() error {
	data, err := marshalForDisk(*s.settings)
	if err != nil {
		return err
	}
	return atomicfile.Write(s.dataFilePath, data)
}
