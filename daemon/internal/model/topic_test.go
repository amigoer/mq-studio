package model

import "testing"

func TestPermToIntAndBack(t *testing.T) {
	cases := []struct {
		perm TopicPerm
		code int
	}{
		{PermRW, 6},
		{PermR, 4},
		{PermW, 2},
		{PermDeny, 0},
	}
	for _, tc := range cases {
		if got := PermToInt(tc.perm); got != tc.code {
			t.Fatalf("PermToInt(%q) = %d, want %d", tc.perm, got, tc.code)
		}
		if got := IntToPerm(tc.code); got != tc.perm {
			t.Fatalf("IntToPerm(%d) = %q, want %q", tc.code, got, tc.perm)
		}
	}
}

func TestPermDefaults(t *testing.T) {
	if PermToInt(TopicPerm("unknown")) != 6 {
		t.Fatal("unknown permission should fall back to read-write 6")
	}
	if IntToPerm(99) != PermRW {
		t.Fatal("unknown integer permission should fall back to read-write")
	}
}
