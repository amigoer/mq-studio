package atomicfile

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestWriteReplacesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "out.json")
	if err := Write(path, []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	if err := Write(path, []byte(`{"ok":false}`)); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"ok":false}` {
		t.Fatalf("content = %s", data)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("permissions = %o, want 600", info.Mode().Perm())
	}
}
