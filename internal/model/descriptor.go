package model

// FieldType is how the renderer draws one connection-form field.
type FieldType string

const (
	FieldText         FieldType = "text"
	FieldPassword     FieldType = "password"
	FieldNumber       FieldType = "number"
	FieldSelect       FieldType = "select"
	FieldSwitch       FieldType = "switch"
	FieldEndpointList FieldType = "endpoint-list"
)

// FieldTarget says which part of a ConnectionProfile a field writes into.
// Secrets are encrypted at rest and never serialised back to the renderer.
type FieldTarget string

const (
	TargetEndpoints FieldTarget = "endpoints"
	TargetOption    FieldTarget = "option"
	TargetSecret    FieldTarget = "secret"
	TargetAuth      FieldTarget = "auth"
)

// FormOption is one choice in a select field.
type FormOption struct {
	Value    string `json:"value"`
	LabelKey string `json:"labelKey"`
}

// FieldCond hides a field unless another field holds one of Equals.
type FieldCond struct {
	Field  string   `json:"field"`
	Equals []string `json:"equals"`
}

// FormField is one row of a driver's connection form.
type FormField struct {
	Key         string       `json:"key"`
	Target      FieldTarget  `json:"target"`
	Type        FieldType    `json:"type"`
	LabelKey    string       `json:"labelKey"` // i18n key, never a literal
	Placeholder string       `json:"placeholder"`
	Default     string       `json:"default"`
	Required    bool         `json:"required"`
	VisibleWhen *FieldCond   `json:"visibleWhen"`
	Options     []FormOption `json:"options"`

	// Validate names a validator the renderer already implements, such as
	// "host-port" or "url". Shipping a regex across the bridge would move
	// validation logic out of review and into data.
	Validate string `json:"validate"`
}

// DriverDescriptor is what a family can do before any connection is open.
//
// Display strings are deliberately absent: the renderer resolves them from
// the i18n bundle under mq.<kind>.*, so translations stay where translations
// live.
type DriverDescriptor struct {
	Kind        MQKind      `json:"kind"`
	DefaultPort string      `json:"defaultPort"`
	Form        []FormField `json:"form"`

	// MaxCapabilities is the best case for the family. A live connection can
	// only narrow it, never widen it, and the driver conformance test asserts
	// every entry is backed by an implemented interface.
	MaxCapabilities []Capability `json:"maxCapabilities"`
}
