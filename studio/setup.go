package main

// Setup: what the studio can tell about the machine and the repository
// around the art folder, so the Setup screen can say what is in place
// and put the rest there: the Claude Code skill in ~/.claude, a
// CLAUDE.md and a .gitignore line at the repo root, the Odin loader
// copied in. The texts come from the frontend, which bundles them.

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// Text is a file's content and whether there was one.
type Text struct {
	Text  string `json:"text"`
	Found bool   `json:"found"`
}

// gitRoot walks up from dir to the folder holding .git; "" if none.
func gitRoot(dir string) string {
	for d := filepath.Clean(dir); ; {
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			return ""
		}
		d = parent
	}
}

func isCheckout(d string) bool {
	_, err := os.Stat(filepath.Join(d, "spec", "FORMAT.md"))
	return err == nil
}

// checkout finds the fastart repository this studio came from: the
// binary lives under <checkout>/studio (dev builds, make app), or
// FASTART_HOME says. "" for a release build living elsewhere.
func checkout() string {
	if h := os.Getenv("FASTART_HOME"); h != "" && isCheckout(h) {
		return h
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	for d := filepath.Dir(exe); ; {
		if isCheckout(d) {
			return d
		}
		parent := filepath.Dir(d)
		if parent == d {
			return ""
		}
		d = parent
	}
}

// findNamed lists files below base with the given name, or with the
// suffix when name starts with "*" ("*.odin"). .git and node_modules
// stay out; at most limit results.
func findNamed(base, name string, limit int) []string {
	out := []string{}
	suffix := ""
	if strings.HasPrefix(name, "*") {
		suffix = name[1:]
	}
	_ = filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
		if err != nil || len(out) >= limit {
			return nil
		}
		if d.IsDir() {
			n := d.Name()
			if path != base && (n == ".git" || n == "node_modules" || strings.HasPrefix(n, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if (suffix != "" && strings.HasSuffix(d.Name(), suffix)) || (suffix == "" && d.Name() == name) {
			out = append(out, path)
		}
		return nil
	})
	return out
}

func (p *ProjectService) GitRoot(dir string) string {
	if dir == "" {
		return ""
	}
	return gitRoot(dir)
}

func (p *ProjectService) Checkout() string {
	return checkout()
}

// ReadAt reads rel under an absolute base folder (the home folder, a repo root).
func (p *ProjectService) ReadAt(base, rel string) Text {
	full, err := rooted(base, rel)
	if err != nil {
		return Text{}
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return Text{}
	}
	return Text{Text: string(data), Found: true}
}

// WriteAt writes rel under an absolute base folder, making folders on the way.
func (p *ProjectService) WriteAt(base, rel, text string) error {
	if !filepath.IsAbs(base) {
		return errors.New("base must be absolute")
	}
	full, err := rooted(base, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(text), 0o644)
}

func (p *ProjectService) FindNamed(base, name string) []string {
	if base == "" {
		return []string{}
	}
	return findNamed(base, name, 20)
}
