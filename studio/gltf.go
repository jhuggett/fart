package main

// Import glTF: what the page needs from the machine to bring a .glb or
// .gltf in from anywhere on disk. The page does the importing (the
// importer is the core library's); the shell shows the dialog, reads the
// bytes, and names the tool Claude calls. A model is the one thing read
// from outside the project, so the reads are narrow: a file that ends in
// .glb or .gltf, and what a .gltf keeps beside it.

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const importMax = 256 << 20

func isGltf(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".glb" || ext == ".gltf"
}

// importPath resolves what an import may read: the model itself (uri
// ""), or a file a .gltf names relative to itself, never above it.
func importPath(path, uri string) (string, error) {
	if !filepath.IsAbs(path) || !isGltf(path) {
		return "", fmt.Errorf("%s is not a .glb or .gltf", filepath.Base(path))
	}
	if uri == "" {
		return path, nil
	}
	if strings.ToLower(filepath.Ext(path)) != ".gltf" {
		return "", errors.New("only a .gltf keeps files beside it")
	}
	rel := uri
	if dec, err := url.PathUnescape(uri); err == nil {
		rel = dec
	}
	rel = filepath.FromSlash(rel)
	if filepath.IsAbs(rel) || strings.HasPrefix(uri, "/") {
		return "", fmt.Errorf("bad path %q", uri)
	}
	for _, seg := range strings.Split(filepath.ToSlash(rel), "/") {
		if seg == ".." {
			return "", fmt.Errorf("bad path %q", uri)
		}
	}
	return filepath.Join(filepath.Dir(path), rel), nil
}

func readImport(path, uri string) ([]byte, error) {
	full, err := importPath(path, uri)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(full)
	if err != nil {
		return nil, fmt.Errorf("%s could not be read", filepath.Base(full))
	}
	if info.IsDir() || info.Size() > importMax {
		return nil, fmt.Errorf("%s is not a file an import can read", filepath.Base(full))
	}
	return os.ReadFile(full)
}

// PickImport shows the platform's open dialog for a model, anywhere on
// disk, and answers with its path. "" means cancelled.
func (p *ProjectService) PickImport() (string, error) {
	dlg := p.app.Dialog.OpenFile().
		SetTitle("Import glTF").
		SetMessage("Choose a .glb or .gltf to import").
		SetButtonText("Choose").
		CanChooseDirectories(false).
		CanChooseFiles(true)
	dlg.AddFilter("glTF", "*.glb;*.gltf")
	if p.win != nil {
		dlg.AttachToWindow(p.win)
	}
	path, err := dlg.PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	if !isGltf(path) {
		return "", fmt.Errorf("%s is not a .glb or .gltf", filepath.Base(path))
	}
	return path, nil
}

// ReadImport is a model's bytes (uri ""), or those of a file a .gltf
// names beside itself, as base64.
func (p *ProjectService) ReadImport(path, uri string) (string, error) {
	data, err := readImport(path, uri)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// importRoutes is the same read for a served studio, on the machine
// itself only: the page posts the path and the uri as a form.
func importRoutes(mux *http.ServeMux, local func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/api/import/read", local(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method", 405)
			return
		}
		data, err := readImport(r.PostFormValue("path"), r.PostFormValue("uri"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(data)
	}))
}

// The tool Claude imports with. The page answers it like the others.
func init() {
	mcpTools = append(mcpTools, map[string]any{
		"name":        "import_gltf",
		"description": "Import a glTF model (.glb, or .gltf with its buffers beside it) from a path on this machine into the project as a 3D .fart, and open it in the model screen. One part per mesh node (pivots and parents from the node tree), a colour per material, triangles paired back into quads, split vertices welded, animations as clips. Returns the path written, a summary (parts, shapes, points, faces, clips, size) and what was left out. An existing file is replaced only with overwrite.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"path"},
			"properties": map[string]any{
				"path":            map[string]any{"type": "string", "description": "absolute path of the .glb or .gltf"},
				"name":            map[string]any{"type": "string", "description": "the asset's name or project-relative path, without .fart; default: the file's name"},
				"scale":           map[string]any{"type": "number", "description": "document units per glTF unit, default 1"},
				"height":          map[string]any{"type": "number", "description": "scale the model to stand this many units tall; wins over scale"},
				"merge":           map[string]any{"type": "boolean", "description": "everything in one part named main (animations are left out)"},
				"split_materials": map[string]any{"type": "boolean", "description": "one shape per material instead of colors + paint"},
				"quads":           map[string]any{"type": "boolean", "description": "pair coplanar triangles into quads, default true"},
				"shades":          map[string]any{"type": "boolean", "description": "vertex colours' luminance into shades, default true"},
				"overwrite":       map[string]any{"type": "boolean", "description": "replace the file if it exists, default false"},
			},
		},
	})
}
