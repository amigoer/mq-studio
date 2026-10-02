// Package assistant is the window's own agent: the model services it runs on
// and how a person has set it up.
//
// What it keeps lives in agent.json beside the window's other files, and not
// in settings.json. The settings file is read redacted by the renderer, so a
// key kept there would be wiped by the next save of any other setting; it is
// exported in plain text; it is replaced whole on import; and the MCP process
// re-reads it before every call. None of that is any place for an API key.
package assistant

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"

	"github.com/amigoer/mq-studio/internal/agent/provider"
	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/storage/atomicfile"
)

// Effort is how hard a model is asked to think before it answers.
type Effort string

// The efforts a person can choose from.
const (
	EffortLow    Effort = "low"
	EffortMedium Effort = "medium"
	EffortHigh   Effort = "high"
)

// Writes is whether the assistant is offered the tools that write.
type Writes string

// The two ways of treating writes.
const (
	// WritesApprove offers them, and each call waits for a person's yes.
	WritesApprove Writes = "approve"
	// WritesReadOnly offers none of them.
	WritesReadOnly Writes = "readonly"
)

// BodyLimits are the caps a person can put on how much of each message body
// a tool hands the model. Zero sends none of it.
var BodyLimits = []int{0, 2048, 8192, 32768}

// Retentions are how many days a person can keep conversations for. Zero
// keeps none on disk.
var Retentions = []int{0, 7, 30, 90}

// Provider is one model service the assistant can run on.
type Provider struct {
	ID   string
	Name string
	Kind provider.Kind
	// BaseURL is empty for the service's own address.
	BaseURL string
	// APIKey is plain in memory and encrypted on disk.
	APIKey string
	// Model is what a conversation on this service runs.
	Model string
	Proxy string
	// Fallback asks for the server-side fallback where the model takes one.
	Fallback bool
}

// Endpoint is how to reach the service.
func (p Provider) Endpoint() provider.Endpoint {
	return provider.Endpoint{Kind: p.Kind, BaseURL: p.BaseURL, APIKey: p.APIKey, Proxy: p.Proxy, Fallback: p.Fallback}
}

// Settings is everything the assistant is set up with.
type Settings struct {
	Providers []Provider
	// Default is the provider a new conversation runs on. Empty is the first.
	Default   string
	Effort    Effort
	Writes    Writes
	BodyBytes int
	// Retention is how many days a conversation is kept after it last
	// changed. Zero keeps none.
	Retention int
	// Consented names the providers a person agreed to send their questions
	// and their brokers' data to. Agreeing is per service: one that runs on
	// this machine and one on the internet are not the same decision.
	Consented []string
}

// Preferences is the part of Settings that is not a provider.
type Preferences struct {
	Default   string
	Effort    Effort
	Writes    Writes
	BodyBytes int
	Retention int
}

// KeyChange is what a save does to a provider's stored key: an edit form
// shows the key as set or not, never the key, so leaving it blank has to mean
// keeping it.
type KeyChange string

// What a save can do to a key.
const (
	KeyPreserve KeyChange = "preserve"
	KeyReplace  KeyChange = "replace"
	KeyClear    KeyChange = "clear"
)

func defaults() Settings {
	return Settings{Effort: EffortMedium, Writes: WritesApprove, BodyBytes: 2048, Retention: 30}
}

// Store keeps the settings in agent.json. Only the window writes it.
type Store struct {
	path string

	mu       sync.Mutex
	loaded   bool
	settings Settings
}

// NewStore keeps the settings at path. Nothing is read until they are asked
// for, so a process that never asks never decrypts a key.
func NewStore(path string) *Store {
	return &Store{path: path}
}

// Settings returns a copy of the settings.
func (s *Store) Settings() (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return Settings{}, err
	}
	return s.settings.clone(), nil
}

// Provider returns one provider by id.
func (s *Store) Provider(id string) (Provider, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return Provider{}, false, err
	}
	index := s.settings.index(id)
	if index < 0 {
		return Provider{}, false, nil
	}
	return s.settings.Providers[index], true, nil
}

/*
 * SaveProvider adds a provider, or changes the one whose id it carries, and
 * returns it as stored.
 *
 * The kind is fixed once a provider exists: a key issued by one service is
 * meaningless to the other protocol, and turning one kind into the other would
 * quietly send it there.
 */
func (s *Store) SaveProvider(next Provider, key KeyChange) (Provider, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return Provider{}, err
	}

	next.Name = strings.TrimSpace(next.Name)
	next.BaseURL = strings.TrimSpace(next.BaseURL)
	next.Model = strings.TrimSpace(next.Model)
	next.Proxy = strings.TrimSpace(next.Proxy)
	next.APIKey = strings.TrimSpace(next.APIKey)

	index := -1
	if next.ID != "" {
		if index = s.settings.index(next.ID); index < 0 {
			return Provider{}, fmt.Errorf("there is no model service %q to change", next.ID)
		}
		if current := s.settings.Providers[index]; current.Kind != next.Kind {
			return Provider{}, errors.New("a model service cannot change protocol; add a new one instead")
		}
	}
	switch key {
	case KeyPreserve, "":
		next.APIKey = ""
		if index >= 0 {
			next.APIKey = s.settings.Providers[index].APIKey
		}
	case KeyClear:
		next.APIKey = ""
	case KeyReplace:
		if next.APIKey == "" {
			return Provider{}, errors.New("a replaced API key cannot be empty; clear it instead")
		}
	default:
		return Provider{}, fmt.Errorf("%q is not a way to change a key", key)
	}
	if err := validate(next); err != nil {
		return Provider{}, err
	}

	updated := s.settings.clone()
	if index >= 0 {
		updated.Providers[index] = next
	} else {
		id, err := newID()
		if err != nil {
			return Provider{}, err
		}
		next.ID = id
		updated.Providers = append(updated.Providers, next)
	}
	if err := s.saveLocked(updated); err != nil {
		return Provider{}, err
	}
	return next, nil
}

// Consent records that a person agreed to use a provider.
func (s *Store) Consent(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	if s.settings.index(id) < 0 {
		return fmt.Errorf("there is no model service %q to agree to", id)
	}
	if slices.Contains(s.settings.Consented, id) {
		return nil
	}
	updated := s.settings.clone()
	updated.Consented = append(updated.Consented, id)
	return s.saveLocked(updated)
}

// DeleteProvider removes a provider, and its key with it. A default that named
// it falls back to the first that is left.
func (s *Store) DeleteProvider(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	index := s.settings.index(id)
	if index < 0 {
		return fmt.Errorf("there is no model service %q to delete", id)
	}
	updated := s.settings.clone()
	updated.Providers = slices.Delete(updated.Providers, index, index+1)
	if updated.Default == id {
		updated.Default = ""
	}
	// A service added again later is a new decision.
	updated.Consented = slices.DeleteFunc(updated.Consented, func(one string) bool { return one == id })
	return s.saveLocked(updated)
}

// SavePreferences replaces everything that is not a provider.
func (s *Store) SavePreferences(next Preferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.loadLocked(); err != nil {
		return err
	}
	if next.Default != "" && s.settings.index(next.Default) < 0 {
		return fmt.Errorf("there is no model service %q to make the default", next.Default)
	}
	switch next.Effort {
	case EffortLow, EffortMedium, EffortHigh:
	default:
		return fmt.Errorf("%q is not an effort: it is low, medium or high", next.Effort)
	}
	switch next.Writes {
	case WritesApprove, WritesReadOnly:
	default:
		return fmt.Errorf("%q is not a way to treat writes: it is approve or readonly", next.Writes)
	}
	if !slices.Contains(BodyLimits, next.BodyBytes) {
		return fmt.Errorf("%d is not a body limit this application offers: %v", next.BodyBytes, BodyLimits)
	}
	if !slices.Contains(Retentions, next.Retention) {
		return fmt.Errorf("%d days is not a retention this application offers: %v", next.Retention, Retentions)
	}
	updated := s.settings.clone()
	updated.Default, updated.Effort, updated.Writes, updated.BodyBytes, updated.Retention =
		next.Default, next.Effort, next.Writes, next.BodyBytes, next.Retention
	return s.saveLocked(updated)
}

func validate(p Provider) error {
	if !p.Kind.Valid() {
		return fmt.Errorf("%q is not a protocol this application speaks", p.Kind)
	}
	if p.Name == "" {
		return errors.New("a model service needs a name")
	}
	if len([]rune(p.Name)) > 64 {
		return errors.New("a model service's name is at most 64 characters")
	}
	if p.Model == "" {
		return errors.New("a model service needs a model to run")
	}
	if p.Kind == provider.Anthropic && p.APIKey == "" {
		return errors.New("this protocol needs an API key")
	}
	if p.BaseURL != "" {
		parsed, err := url.Parse(p.BaseURL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return fmt.Errorf("%q is not an http or https address", p.BaseURL)
		}
	}
	if p.Proxy != "" {
		parsed, err := url.Parse(p.Proxy)
		if err != nil || parsed.Host == "" ||
			!slices.Contains([]string{"http", "https", "socks5", "socks5h"}, parsed.Scheme) {
			return fmt.Errorf("%q is not a proxy address: it starts with http, https or socks5", p.Proxy)
		}
	}
	return nil
}

func (s Settings) index(id string) int {
	return slices.IndexFunc(s.Providers, func(p Provider) bool { return p.ID == id })
}

func (s Settings) clone() Settings {
	s.Providers = slices.Clone(s.Providers)
	s.Consented = slices.Clone(s.Consented)
	return s
}

func newID() (string, error) {
	var raw [6]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw[:]), nil
}

// keyField binds a key's ciphertext to the provider it belongs to, so one
// copied onto another provider's entry does not decrypt.
func keyField(id string) string {
	return "agent/provider/" + id
}

// file is agent.json as it is written.
type file struct {
	Version   int              `json:"version"`
	Providers []storedProvider `json:"providers"`
	Default   string           `json:"default,omitempty"`
	Effort    Effort           `json:"effort"`
	Writes    Writes           `json:"writes"`
	BodyBytes int              `json:"bodyBytes"`
	// Retention is a pointer because zero is a choice: keep nothing. A file
	// without it predates the setting, and keeps the default.
	Retention *int     `json:"retention,omitempty"`
	Consented []string `json:"consented,omitempty"`
}

type storedProvider struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Kind     provider.Kind `json:"kind"`
	BaseURL  string        `json:"baseURL,omitempty"`
	APIKey   string        `json:"apiKey,omitempty"`
	Model    string        `json:"model"`
	Proxy    string        `json:"proxy,omitempty"`
	Fallback bool          `json:"fallback,omitzero"`
}

const fileVersion = 1

func (s *Store) loadLocked() error {
	if s.loaded {
		return nil
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.settings, s.loaded = defaults(), true
		return nil
	}
	if err != nil {
		return fmt.Errorf("read %s: %w", s.path, err)
	}
	var stored file
	if err := json.Unmarshal(data, &stored); err != nil {
		return fmt.Errorf("%s is not readable: %w", s.path, err)
	}
	if stored.Version > fileVersion {
		return fmt.Errorf("%s was written by a newer version of this application", s.path)
	}
	settings := defaults()
	settings.Default = stored.Default
	if stored.Effort != "" {
		settings.Effort = stored.Effort
	}
	if stored.Writes != "" {
		settings.Writes = stored.Writes
	}
	if slices.Contains(BodyLimits, stored.BodyBytes) {
		settings.BodyBytes = stored.BodyBytes
	}
	if stored.Retention != nil && slices.Contains(Retentions, *stored.Retention) {
		settings.Retention = *stored.Retention
	}
	for _, entry := range stored.Providers {
		key, err := crypto.Decrypt(entry.APIKey, keyField(entry.ID))
		if err != nil {
			return fmt.Errorf("the API key of %q could not be decrypted: %w", entry.Name, err)
		}
		settings.Providers = append(settings.Providers, Provider{
			ID: entry.ID, Name: entry.Name, Kind: entry.Kind, BaseURL: entry.BaseURL, APIKey: key,
			Model: entry.Model, Proxy: entry.Proxy, Fallback: entry.Fallback,
		})
	}
	if settings.index(settings.Default) < 0 {
		settings.Default = ""
	}
	for _, id := range stored.Consented {
		if settings.index(id) >= 0 && !slices.Contains(settings.Consented, id) {
			settings.Consented = append(settings.Consented, id)
		}
	}
	s.settings, s.loaded = settings, true
	return nil
}

// saveLocked writes updated and only then makes it the settings in memory, so
// a write that fails leaves both as they were.
func (s *Store) saveLocked(updated Settings) error {
	stored := file{
		Version:   fileVersion,
		Providers: make([]storedProvider, 0, len(updated.Providers)),
		Default:   updated.Default,
		Effort:    updated.Effort,
		Writes:    updated.Writes,
		BodyBytes: updated.BodyBytes,
		Retention: &updated.Retention,
		Consented: updated.Consented,
	}
	for _, p := range updated.Providers {
		key, err := crypto.Encrypt(p.APIKey, keyField(p.ID))
		if err != nil {
			return fmt.Errorf("the API key of %q could not be encrypted: %w", p.Name, err)
		}
		stored.Providers = append(stored.Providers, storedProvider{
			ID: p.ID, Name: p.Name, Kind: p.Kind, BaseURL: p.BaseURL, APIKey: key,
			Model: p.Model, Proxy: p.Proxy, Fallback: p.Fallback,
		})
	}
	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return err
	}
	if err := atomicfile.Write(s.path, data); err != nil {
		return fmt.Errorf("write %s: %w", s.path, err)
	}
	s.settings = updated
	return nil
}
