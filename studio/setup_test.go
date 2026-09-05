package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGitRootAndFind(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	deep := filepath.Join(root, "assets", "art")
	if err := os.MkdirAll(filepath.Join(root, "node_modules", "x"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}
	if got := gitRoot(deep); got != root {
		t.Fatalf("gitRoot(%q) = %q, want %q", deep, got, root)
	}
	if got := gitRoot(t.TempDir()); got != "" {
		t.Fatalf("a folder with no .git above should give \"\", got %q", got)
	}
	_ = os.WriteFile(filepath.Join(root, "fastart", "fastart.odin"), nil, 0o644)
	_ = os.MkdirAll(filepath.Join(root, "fastart"), 0o755)
	_ = os.WriteFile(filepath.Join(root, "fastart", "fastart.odin"), []byte("package fastart"), 0o644)
	_ = os.WriteFile(filepath.Join(root, "main.odin"), []byte("package main"), 0o644)
	_ = os.WriteFile(filepath.Join(root, "node_modules", "x", "noise.odin"), []byte(""), 0o644)
	if got := findNamed(root, "fastart.odin", 20); len(got) != 1 || filepath.Base(got[0]) != "fastart.odin" {
		t.Fatalf("findNamed exact: %v", got)
	}
	if got := findNamed(root, "*.odin", 20); len(got) != 2 {
		t.Fatalf("findNamed suffix should skip node_modules: %v", got)
	}
	if isCheckout(root) {
		t.Fatal("a bare repo is not the fastart checkout")
	}
}
