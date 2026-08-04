// Package timestamp formats timestamps returned by RocketMQ service models.
package timestamp

import "time"

// Now returns the current local time in the API's stable display format.
func Now() string {
	return time.Now().Format("2006-01-02 15:04:05")
}
