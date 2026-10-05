package main

// Compiled sidecars (format 1.8): `name.fart.glb` beside `name.fart`,
// the model's triangles already generated so that a screen showing a
// model it is not editing draws at once. They are derived build
// artifacts: the page builds them (the builder is the core library's)
// and the shell only reads and writes the bytes, by the name of the
// document they belong to. Nothing else of the studio sees them: not the
// file tree, not a checkpoint, not the saved state.

import (
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const sidecarMax = 256 << 20

// the line that keeps sidecars out of a repository
const sidecarPattern = "*.fart.glb"

// sidecarOf is where the sidecar of a document lives: only a .fart of
// the project has one.
func sidecarOf(root, rel string) (string, error) {
	if !strings.HasSuffix(rel, ".fart") {
		return "", errors.New("only a .fart has a sidecar: " + rel)
	}
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	return full + ".glb", nil
}

func readSidecar(root, rel string) ([]byte, error) {
	full, err := sidecarOf(root, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		return nil, nil // none yet
	}
	if info.Size() > sidecarMax {
		return nil, errors.New("the sidecar is too large to read")
	}
	return os.ReadFile(full)
}

// writeSidecar puts a sidecar beside its document, which must be there:
// a sidecar is never written for a file that is gone.
func writeSidecar(root, rel string, data []byte) error {
	full, err := sidecarOf(root, rel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(strings.TrimSuffix(full, ".glb")); err != nil {
		return errors.New(rel + " is not there to build a sidecar for")
	}
	// glTF's magic, so nothing but a binary glTF is ever written here
	if len(data) < 12 || string(data[:4]) != "glTF" {
		return errors.New("not a binary glTF")
	}
	return writeAtomic(full, data)
}

// sidecarIgnore says whether the project should be offered a line in its
// .gitignore: "none" outside a repository, "ignored" when sidecars are
// kept out already, "offer" when they would be committed.
func sidecarIgnore(root string) string {
	if root == "" || gitRoot(root) == "" {
		return "none"
	}
	// check-ignore answers for a path that need not exist
	if _, err := git(root, "check-ignore", "-q", "probe.fart.glb"); err == nil {
		return "ignored"
	}
	return "offer"
}

// ignoreSidecars adds the line to the project's own .gitignore.
func ignoreSidecars(root string) error {
	if root == "" {
		return errors.New("no project open")
	}
	path := filepath.Join(root, ".gitignore")
	have, _ := os.ReadFile(path)
	for _, line := range strings.Split(string(have), "\n") {
		if strings.TrimSpace(line) == sidecarPattern {
			return nil
		}
	}
	text := string(have)
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	text += "# compiled sidecars are build artifacts (Uranus and fart build make them again)\n" + sidecarPattern + "\n"
	return writeAtomic(path, []byte(text))
}

// ReadSidecar is a document's sidecar as base64, "" when it has none.
func (p *ProjectService) ReadSidecar(root, rel string) (string, error) {
	data, err := readSidecar(root, rel)
	if err != nil || data == nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// WriteSidecar writes a document's sidecar (base64 of a binary glTF).
func (p *ProjectService) WriteSidecar(root, rel, data string) error {
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	return writeSidecar(root, rel, raw)
}

// SidecarIgnore: "none", "ignored" or "offer" (see sidecarIgnore).
func (p *ProjectService) SidecarIgnore(root string) string {
	return sidecarIgnore(root)
}

// IgnoreSidecars adds *.fart.glb to the project's .gitignore.
func (p *ProjectService) IgnoreSidecars(root string) error {
	return ignoreSidecars(root)
}

// sidecarRoutes is the same for a served studio.
func sidecarRoutes(mux *http.ServeMux, root string) {
	mux.HandleFunc("/api/sidecar", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		rel := r.URL.Query().Get("path")
		switch r.Method {
		case http.MethodGet:
			data, err := readSidecar(root, rel)
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			if data == nil {
				// none yet: an answer with nothing in it (not an error for the page's console to log)
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.Header().Set("Content-Type", "model/gltf-binary")
			_, _ = w.Write(data)
		case http.MethodPut:
			body, err := io.ReadAll(io.LimitReader(r.Body, sidecarMax))
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			if err := writeSidecar(root, rel, body); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method", 405)
		}
	})
	mux.HandleFunc("/api/sidecar/ignore", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, sidecarIgnore(root))
		case http.MethodPost:
			if err := ignoreSidecars(root); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "method", 405)
		}
	})
}
