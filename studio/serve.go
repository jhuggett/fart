package main

// The LAN server behind the Serve button (and `studio --serve <dir>`):
// the same frontend over plain HTTP, plus a small file API rooted at one
// project. A tablet on the network gets the whole editor; a game
// hot-reloading the folder sees every stroke land.

import (
	"embed"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	qrcode "github.com/skip2/go-qrcode"
)

const servePort = 4747

type ServeInfo struct {
	On   bool   `json:"on"`
	URL  string `json:"url"`
	Root string `json:"root"`
	QR   string `json:"qr"` // a PNG data URL of the URL, for the screen
}

type Server struct {
	assets embed.FS
	mu     sync.Mutex
	srv    *http.Server
	info   ServeInfo
}

func NewServer(assets embed.FS) *Server {
	return &Server{assets: assets}
}

func (s *Server) Info() ServeInfo {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.info
}

func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

func (s *Server) stopLocked() {
	if s.srv != nil {
		_ = s.srv.Close()
		s.srv = nil
	}
	s.info = ServeInfo{}
}

// Start serves root on every interface. Starting again with the same root
// is a no-op; with another root, the server moves.
func (s *Server) Start(root string) (ServeInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.srv != nil && s.info.Root == root {
		return s.info, nil
	}
	s.stopLocked()

	dist, err := fs.Sub(s.assets, "frontend/dist")
	if err != nil {
		return ServeInfo{}, err
	}
	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(dist)))
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		writeJSON(w, map[string]any{"name": filepath.Base(root), "serve": true, "trash": caps().Trash})
	})
	mux.HandleFunc("/api/list", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		files, err := listFiles(root)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, files)
	})
	mux.HandleFunc("/api/file", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		full, err := rooted(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		switch r.Method {
		case http.MethodGet:
			data, err := os.ReadFile(full)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			_, _ = w.Write(data)
		case http.MethodPut:
			body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
			if err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			if err := os.WriteFile(full, body, 0o644); err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		case http.MethodDelete:
			how, err := removeFile(full)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			writeJSON(w, how)
		default:
			http.Error(w, "method", 405)
		}
	})
	mux.HandleFunc("/api/rename", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if r.Method != http.MethodPost {
			http.Error(w, "method", 405)
			return
		}
		q := r.URL.Query()
		from, err := rooted(root, q.Get("from"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		to, err := rooted(root, q.Get("to"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		if err := renameFile(from, to); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/duplicate", func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		if r.Method != http.MethodPost {
			http.Error(w, "method", 405)
			return
		}
		full, err := rooted(root, r.URL.Query().Get("path"))
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		dst, err := duplicateFile(full)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		rel, err := filepath.Rel(root, dst)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		writeJSON(w, filepath.ToSlash(rel))
	})

	ln, err := net.Listen("tcp", fmt.Sprintf(":%d", servePort))
	if err != nil {
		return ServeInfo{}, err
	}
	s.srv = &http.Server{Handler: mux}
	go func(srv *http.Server) { _ = srv.Serve(ln) }(s.srv)

	url := fmt.Sprintf("http://%s:%d", lanIP(), servePort)
	qr := ""
	if png, err := qrcode.Encode(url, qrcode.Medium, 256); err == nil {
		qr = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
	}
	s.info = ServeInfo{On: true, URL: url, Root: root, QR: qr}
	return s.info, nil
}

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// lanIP: the first address a tablet on the same network could reach.
func lanIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "127.0.0.1"
	}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			return ip4.String()
		}
	}
	return "127.0.0.1"
}
