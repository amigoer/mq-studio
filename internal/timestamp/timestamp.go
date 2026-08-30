// Package timestamp formats timestamps returned by RocketMQ service models.
package timestamp

import "time"

// Now returns the current local time in the API's stable display format.
func Now() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// FromUnixMilli formats a broker-reported epoch in the same display format.
//
// Zero and negative values become an empty string rather than 1970: brokers
// use zero for "never", and a page that renders that as a date invents an
// event that did not happen.
func FromUnixMilli(milliseconds int64) string {
	if milliseconds <= 0 {
		return ""
	}
	return time.UnixMilli(milliseconds).Format("2006-01-02 15:04:05")
}
