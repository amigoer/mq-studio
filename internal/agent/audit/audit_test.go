package audit

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

// lines reads the log back, failing on any line that is not a whole record.
func lines(t *testing.T, path string) []Record {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	var records []Record
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		var record Record
		if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
			t.Fatalf("a line of the log is not a record: %v: %s", err, scanner.Text())
		}
		records = append(records, record)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return records
}

// Calls run at once, and each record has to arrive as a whole line.
func TestRecordsWrittenAtOnceStayWholeLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent-audit.jsonl")
	journal := Open(path)

	var writers sync.WaitGroup
	for call := range 64 {
		writers.Go(func() {
			if err := journal.Append(Record{Call: int64(call), Phase: PhaseStarted,
				Arguments: json.RawMessage(`{"body":"` + strings.Repeat("x", 2048) + `"}`)}); err != nil {
				t.Error(err)
			}
		})
	}
	writers.Wait()

	if records := lines(t, path); len(records) != 64 {
		t.Fatalf("64 records came back as %d", len(records))
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if mode := info.Mode().Perm(); mode != 0o600 {
			t.Errorf("the audit log is %v, readable by more than its owner", mode)
		}
	}
}
