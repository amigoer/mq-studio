package settings

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/atomicfile"
	"github.com/amigoer/mq-studio/internal/update"
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
	migrateLegacyFontSize(raw)
	migrateLegacyAutoCheckUpdate(raw)

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

// migrateLegacyFontSize folds the two shapes earlier builds wrote - the
// t-shirt sizes of the first, the 12-18 px integer of the second - into the
// uiScale ladder. A size that is not a step on it becomes "auto" rather than
// the nearest step: the ladder no longer offers it.
func migrateLegacyFontSize(raw map[string]json.RawMessage) {
	rawFontSize, ok := raw["fontSize"]
	if !ok {
		return
	}
	delete(raw, "fontSize")
	if _, alreadyMigrated := raw["uiScale"]; alreadyMigrated {
		return
	}

	scale := model.UIScaleAuto
	var tShirt string
	var pixels int
	switch {
	case json.Unmarshal(rawFontSize, &tShirt) == nil:
		if mapped, known := map[string]string{"small": "12", "medium": "14", "large": "16"}[tShirt]; known {
			scale = mapped
		}
	case json.Unmarshal(rawFontSize, &pixels) == nil:
		if step := strconv.Itoa(pixels); model.ValidUIScale(step) {
			scale = step
		}
	}
	raw["uiScale"], _ = json.Marshal(scale)
	log.Printf("[SettingsService] converted legacy fontSize %s to uiScale %q", rawFontSize, scale)
}

// migrateLegacyAutoCheckUpdate folds the boolean earlier builds wrote into the
// update policy ladder that replaced it. Off stays off; on becomes the notify
// rung, which is what the boolean actually did.
func migrateLegacyAutoCheckUpdate(raw map[string]json.RawMessage) {
	rawAutoCheck, ok := raw["autoCheckUpdate"]
	if !ok {
		return
	}
	delete(raw, "autoCheckUpdate")
	if _, alreadyMigrated := raw["updatePolicy"]; alreadyMigrated {
		return
	}
	policy := update.PolicyNotify
	var enabled bool
	if json.Unmarshal(rawAutoCheck, &enabled) == nil && !enabled {
		policy = update.PolicyOff
	}
	raw["updatePolicy"], _ = json.Marshal(string(policy))
	log.Printf("[SettingsService] converted legacy autoCheckUpdate %s to updatePolicy %q", rawAutoCheck, policy)
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
