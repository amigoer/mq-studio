package redisstream

import (
	"strconv"
	"strings"
)

/*
 * INFO is a document, not a reply shape.
 *
 * Redis answers with a text blob of "# Section" headers and key:value lines,
 * so every figure the node and overview pages show is read out of here. Parsing
 * it is kept apart from the commands so it can be tested against captured
 * output rather than against a server, which is also the only way to cover the
 * fields the in-process server does not produce - which is almost all of them.
 */
type serverInfo map[string]map[string]string

// parseInfo reads the INFO reply into sections.
//
// Unknown sections and unknown keys are kept rather than filtered: what Redis
// reports grows with every release, and a parser that only kept a known list
// would silently drop the field a future page wants.
func parseInfo(raw string) serverInfo {
	info := serverInfo{}
	section := ""
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case line == "":
			continue
		case strings.HasPrefix(line, "#"):
			section = strings.ToLower(strings.TrimSpace(strings.TrimPrefix(line, "#")))
			if _, present := info[section]; !present {
				info[section] = map[string]string{}
			}
		default:
			key, value, found := strings.Cut(line, ":")
			if !found {
				continue
			}
			if _, present := info[section]; !present {
				info[section] = map[string]string{}
			}
			info[section][strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return info
}

// get reads a field from anywhere in the document.
//
// The section a field lives in has moved between Redis releases, and a reader
// that pinned one would report a figure as missing on the version that moved
// it. What matters is the key, which has not changed.
func (info serverInfo) get(key string) string {
	for _, section := range info {
		if value, present := section[key]; present {
			return value
		}
	}
	return ""
}

// number reads a field as an integer. A missing or unreadable field is absent
// rather than zero, because a zero here would be rendered as a real figure.
func (info serverInfo) number(key string) (int64, bool) {
	raw := info.get(key)
	if raw == "" {
		return 0, false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	return value, true
}

func (info serverInfo) float(key string) (float64, bool) {
	raw := info.get(key)
	if raw == "" {
		return 0, false
	}
	value, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, false
	}
	return value, true
}

/*
 * replicaOf reads one "slaveN:" line from the replication section.
 *
 * The line is a comma-separated list of key=value pairs, and the fields that
 * matter are the address, whether the link is online, and how far behind the
 * replica's acknowledged offset is. Redis calls the last one nothing: it
 * reports both offsets and the difference is the lag.
 */
func replicaOf(line string, masterOffset int64, masterOffsetKnown bool) (address string, behind int64, inSync bool, ok bool) {
	fields := map[string]string{}
	for _, pair := range strings.Split(line, ",") {
		key, value, found := strings.Cut(pair, "=")
		if found {
			fields[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	ip, port := fields["ip"], fields["port"]
	if ip == "" {
		return "", 0, false, false
	}
	address = ip
	if port != "" {
		address = ip + ":" + port
	}

	// Online is Redis's own verdict on the link, and is not the same as being
	// caught up: a replica streaming normally is online while a few bytes
	// behind, and one still loading an RDB is not online however small the
	// gap looks.
	inSync = fields["state"] == "online"

	behind = unknownBehind
	if replicaOffset, err := strconv.ParseInt(fields["offset"], 10, 64); err == nil && masterOffsetKnown {
		if gap := masterOffset - replicaOffset; gap >= 0 {
			behind = gap
		} else {
			// A replica reporting an offset ahead of the master happens
			// mid-failover. Zero is the honest reading: it is not behind.
			behind = 0
		}
	}
	return address, behind, inSync, true
}

// unknownBehind is model.UnknownMetric as an int64. A replica whose offset
// could not be read is not a replica that is caught up.
const unknownBehind = int64(-1)
