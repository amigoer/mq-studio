package main

import (
	"embed"
	"encoding/json"
	"log"
	"strings"
)

/*
 * The capability model's text is i18n keys, not sentences.
 *
 * A driver that wants to say "browsing this queue alters it" stores
 * mq.rabbitmq.caveat.browseAltersQueue, and the renderer resolves it. That is
 * right for the window - the text has to be in the reader's language, and the
 * translations belong with the rest of the UI's - and it leaves a caller with
 * no renderer holding a key it cannot read.
 *
 * So the same files are resolved here. Embedded rather than copied because a
 * second copy of a translation is a second thing to keep in step; embedded in
 * package main because go:embed cannot escape its own package directory and
 * frontend/ is only reachable from the root.
 */

//go:embed frontend/src/i18n/locales/en.json frontend/src/i18n/locales/zh.json
var localeFiles embed.FS

// phrasebook resolves i18n keys into the language the application is set to.
//
// A key it cannot resolve comes back unchanged. That is the honest failure: a
// caller gets something it can search for, rather than an empty string that
// reads as "this operation has no consequence".
func phrasebook(language string) func(string) string {
	table := loadLocale(language)
	fallback := table
	if language != "en" {
		fallback = loadLocale("en")
	}

	return func(key string) string {
		if key == "" {
			return ""
		}
		if text, ok := lookup(table, key); ok {
			return text
		}
		// A key present in English and missing from the other file is a
		// translation that has not landed yet, which is still better read
		// than skipped.
		if text, ok := lookup(fallback, key); ok {
			return text
		}
		return key
	}
}

func loadLocale(language string) map[string]any {
	name := "frontend/src/i18n/locales/en.json"
	if language == "zh" {
		name = "frontend/src/i18n/locales/zh.json"
	}
	data, err := localeFiles.ReadFile(name)
	if err != nil {
		log.Printf("[mcp] no translations for %q: %v", language, err)
		return nil
	}
	var table map[string]any
	if err := json.Unmarshal(data, &table); err != nil {
		log.Printf("[mcp] translations for %q are unreadable: %v", language, err)
		return nil
	}
	return table
}

// lookup walks a dotted key through the nested objects the locale files use.
func lookup(table map[string]any, key string) (string, bool) {
	var current any = table
	for _, segment := range strings.Split(key, ".") {
		object, ok := current.(map[string]any)
		if !ok {
			return "", false
		}
		current, ok = object[segment]
		if !ok {
			return "", false
		}
	}
	text, ok := current.(string)
	return text, ok
}
