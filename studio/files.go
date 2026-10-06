package main

// What the shell does to files on the frontend's behalf beyond reading
// and writing: taking them out (to the Trash where there is one),
// renaming, copying, and showing them in the system's file browser.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
)

// Caps says what this machine can do with files, so the menus can say
// "Move to Trash" or "Delete", "Reveal in Finder" or nothing.
type Caps struct {
	Trash  bool   `json:"trash"`  // Remove moves to the Trash rather than deleting
	Reveal string `json:"reveal"` // the file browser's name, "" if there is none to open
	OS     string `json:"os"`     // runtime.GOOS: the page leaves room for macOS's inline traffic lights
}

func caps() Caps {
	switch runtime.GOOS {
	case "darwin":
		return Caps{Trash: true, Reveal: "Finder", OS: "darwin"}
	case "windows":
		return Caps{Reveal: "Explorer", OS: "windows"}
	default:
		return Caps{Reveal: "file manager", OS: runtime.GOOS}
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
// gone elsewhere. Its checkpoint (name~) goes with it, and so does its
// compiled sidecar (name.fart.glb), which is nothing without it. Returns how.
func removeFile(full string) (string, error) {
	if _, err := os.Stat(full); err != nil {
		return "", err
	}
	_ = os.Remove(full + "~")
	if strings.HasSuffix(full, ".fart") {
		_ = os.Remove(full + ".glb")
	}
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
	// the sidecar is of the same bytes under the new name: it follows
	if strings.HasSuffix(from, ".fart") && strings.HasSuffix(to, ".fart") {
		if _, err := os.Stat(from + ".glb"); err == nil {
			_ = os.Rename(from+".glb", to+".glb")
		}
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

var space3d = regexp.MustCompile(`"space"\s*:\s*"3d"`)

var paletteRefs = regexp.MustCompile(`"palette_refs"\s*:\s*(\[[^\]]*\])`)

// FileInfo is what the browser knows of a file before anyone opens it.
type FileInfo struct {
	Kind string   `json:"kind"` // "2D", "3D", "palette", "scene" or "3D scene"
	Refs []string `json:"refs"` // the palette files it draws from, as it names them
}

// infoOfFile says what a file is without parsing it. The space and the
// palettes are named near the top of a file; parts are looked for
// anywhere in it (a palette file is colours and no parts).
func infoOfFile(full string) FileInfo {
	data, err := os.ReadFile(full)
	if err != nil {
		return FileInfo{}
	}
	info := FileInfo{Kind: kindOfData(full, data), Refs: []string{}}
	head := data
	if len(head) > 65536 {
		head = head[:65536]
	}
	if m := paletteRefs.FindSubmatch(head); m != nil {
		_ = json.Unmarshal(m[1], &info.Refs)
	}
	return info
}

func kindOfData(full string, data []byte) string {
	head := data
	if len(head) > 4096 {
		head = head[:4096]
	}
	is3d := space3d.Match(head)
	if strings.HasSuffix(full, ".shart") {
		if is3d {
			return "3D scene"
		}
		return "scene"
	}
	if is3d {
		return "3D"
	}
	if !bytes.Contains(data, []byte(`"parts"`)) && bytes.Contains(data, []byte(`"palette"`)) {
		return "palette"
	}
	return "2D"
}

// kindsOf is every file of a project and its kind, read a few at a time:
// the browser tags and filters its tiles by kind long before it has
// opened any of them.
func kindsOf(root string, files []string) map[string]FileInfo {
	out := make(map[string]FileInfo, len(files))
	var mu sync.Mutex
	var wg sync.WaitGroup
	gate := make(chan struct{}, 8)
	for _, rel := range files {
		full, err := rooted(root, rel)
		if err != nil {
			continue
		}
		wg.Add(1)
		gate <- struct{}{}
		go func(rel, full string) {
			defer wg.Done()
			k := infoOfFile(full)
			<-gate
			if k.Kind == "" {
				return
			}
			mu.Lock()
			out[rel] = k
			mu.Unlock()
		}(rel, full)
	}
	wg.Wait()
	return out
}
