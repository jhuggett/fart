package main

// What the shell does to files on the frontend's behalf beyond reading
// and writing: taking them out (to the Trash where there is one),
// renaming, copying, and showing them in the system's file browser.

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Caps says what this machine can do with files, so the menus can say
// "Move to Trash" or "Delete", "Reveal in Finder" or nothing.
type Caps struct {
	Trash  bool   `json:"trash"`  // Remove moves to the Trash rather than deleting
	Reveal string `json:"reveal"` // the file browser's name, "" if there is none to open
}

func caps() Caps {
	switch runtime.GOOS {
	case "darwin":
		return Caps{Trash: true, Reveal: "Finder"}
	case "windows":
		return Caps{Reveal: "Explorer"}
	default:
		return Caps{Reveal: "file manager"}
	}
}

// freshPath returns path if nothing is there, else "name 2.ext", "name 3.ext"...
func freshPath(path string) string {
	if _, err := os.Stat(path); err != nil {
		return path
	}
	ext := filepath.Ext(path)
	stem := strings.TrimSuffix(path, ext)
	for i := 2; ; i++ {
		p := fmt.Sprintf("%s %d%s", stem, i, ext)
		if _, err := os.Stat(p); err != nil {
			return p
		}
	}
}

// removeFile takes a file out of the project: into the Trash on macOS,
// gone elsewhere. Its checkpoint (name~) goes with it. Returns how.
func removeFile(full string) (string, error) {
	if _, err := os.Stat(full); err != nil {
		return "", err
	}
	_ = os.Remove(full + "~")
	if runtime.GOOS == "darwin" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		dst := freshPath(filepath.Join(home, ".Trash", filepath.Base(full)))
		if err := os.Rename(full, dst); err != nil {
			// another volume: a rename cannot cross it, and deleting
			// outright is not what was promised
			return "", fmt.Errorf("could not move %s to the Trash: %v", filepath.Base(full), err)
		}
		return "trash", nil
	}
	if err := os.Remove(full); err != nil {
		return "", err
	}
	return "deleted", nil
}

// renameFile moves a file within the project, making folders on the
// way and never landing on another file. The checkpoint follows.
func renameFile(from, to string) error {
	if from == to {
		return nil
	}
	if _, err := os.Stat(to); err == nil {
		return fmt.Errorf("%s already exists", filepath.Base(to))
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		return err
	}
	if err := os.Rename(from, to); err != nil {
		return err
	}
	if _, err := os.Stat(from + "~"); err == nil {
		_ = os.Rename(from+"~", to+"~")
	}
	return nil
}

// duplicateFile copies a file beside itself as "name copy.fart" and
// returns the copy's path.
func duplicateFile(full string) (string, error) {
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	ext := filepath.Ext(full)
	dst := freshPath(strings.TrimSuffix(full, ext) + " copy" + ext)
	if err := os.WriteFile(dst, data, 0o644); err != nil {
		return "", err
	}
	return dst, nil
}

// revealPath shows a file selected in its folder, or opens a folder,
// in the system's file browser.
func revealPath(full string) error {
	info, err := os.Stat(full)
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		if info.IsDir() {
			return exec.Command("open", full).Start()
		}
		return exec.Command("open", "-R", full).Start()
	case "windows":
		if info.IsDir() {
			return exec.Command("explorer", full).Start()
		}
		return exec.Command("explorer", "/select,"+full).Start()
	default:
		if info.IsDir() {
			return exec.Command("xdg-open", full).Start()
		}
		return exec.Command("xdg-open", filepath.Dir(full)).Start()
	}
}
