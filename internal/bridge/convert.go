package bridge

import "strconv"

// itoa keeps the form-to-spec conversions readable where a driver's attribute
// map only carries strings.
func itoa(value int) string { return strconv.Itoa(value) }
