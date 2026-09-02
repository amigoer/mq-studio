// Package timestamp formats the timestamps drivers report, in one display
// format so two boards never spell the same instant differently.
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

// FromTime formats a time a driver was handed as a time.Time.
//
// Same rule as above: the zero value becomes an empty string rather than
// 1970. A JetStream stream with no messages reports a zero first and last
// time, and rendering those as dates would invent two events.
func FromTime(moment time.Time) string {
	if moment.IsZero() {
		return ""
	}
	return moment.Format("2006-01-02 15:04:05")
}
