package cluster

import "fmt"

func parseIntSafe(value string) int {
	var result int
	fmt.Sscanf(value, "%d", &result)
	return result
}

func parseInt64Safe(value string) int64 {
	var result int64
	fmt.Sscanf(value, "%d", &result)
	return result
}

func parseFloatSafe(value string) float64 {
	var result float64
	fmt.Sscanf(value, "%f", &result)
	return result
}

func extractFirstValue(value string) string {
	for index, character := range value {
		if character == ' ' || character == '\t' {
			return value[:index]
		}
	}
	return value
}
