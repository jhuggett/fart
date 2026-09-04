package main

// ProjectService: what the studio's frontend asks the machine for. A
// project is a folder; every path the frontend holds is relative to it,
// and nothing here steps outside (no absolute paths, no "..").

import (
	"bufio"
	"log"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const recentMax = 12

type ProjectService struct {
	app    *application.App
	win    application.Window
	server *Server
	mu     sync.Mutex
	queue  []string // paths the OS asked us to open, drained by the frontend
}

// rooted joins rel under root, refusing anything that could escape.
func rooted(root, rel string) (string, error) {
	if root == "" {
		return "", errors.New("no project open")
	}
	if rel == "" || filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "\\") {
		return "", fmt.Errorf("bad path %q", rel)
	}
	for _, seg := range strings.Split(rel, "/") {
		if seg == ".." {
			return "", fmt.Errorf("bad path %q", rel)
		}
	}
	return filepath.Join(root, filepath.FromSlash(rel)), nil
}

// listFiles finds every .fart below root, as sorted slash-relative paths.
// Dotfiles, node_modules and the .fart~ checkpoints stay out of the shelf.
func listFiles(root string) ([]string, error) {
	out := []string{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		if path != root && strings.HasPrefix(name, ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() && name == "node_modules" {
			return filepath.SkipDir
		}
		if !d.IsDir() && strings.HasSuffix(name, ".fart") {
			rel, rerr := filepath.Rel(root, path)
			if rerr == nil {
				out = append(out, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	sort.Strings(out)
	return out, err
}

// ------------------------------------------------------------- folders

// Log prints a line from the page into the shell's log (a debugging aid).
func (p *ProjectService) Log(msg string) {
	log.Printf("page: %s", msg)
}

// PickFolder shows the platform's folder dialog. "" means cancelled.
func (p *ProjectService) PickFolder() (string, error) {
	dlg := p.app.Dialog.OpenFile().
		SetTitle("Open a project folder").
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if p.win != nil {
		dlg.AttachToWindow(p.win)
	}
	path, err := dlg.PromptForSingleSelection()
	log.Printf("pick folder: %q err=%v", path, err)
	return path, err
}

func (p *ProjectService) IsDir(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}

func (p *ProjectService) Home() string {
	h, _ := os.UserHomeDir()
	return h
}

// DefaultRoot is the terminal's directory when the studio was launched
// from one; launched from the Finder (cwd / or the home folder) it is "",
// and the welcome screen takes over.
func (p *ProjectService) DefaultRoot() string {
	cwd, err := os.Getwd()
	if err != nil || cwd == "/" || cwd == p.Home() {
		return ""
	}
	return cwd
}

// ------------------------------------------------------------- files

func (p *ProjectService) ListFiles(root string) ([]string, error) {
	if root == "" {
		return nil, errors.New("no project open")
	}
	return listFiles(root)
}

func (p *ProjectService) ReadFile(root, rel string) (string, error) {
	full, err := rooted(root, rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (p *ProjectService) Exists(root, rel string) bool {
	full, err := rooted(root, rel)
	if err != nil {
		return false
	}
	_, err = os.Stat(full)
	return err == nil
}

// WriteFile writes text under root, creating folders on the way ("enemies/bat.fart").
func (p *ProjectService) WriteFile(root, rel, text string) error {
	full, err := rooted(root, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	return os.WriteFile(full, []byte(text), 0o644)
}

// ------------------------------------------------------------- recents

// The same file the classic editor keeps, so the two agree on history.
func recentsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "fastart", "recent.txt"), nil
}

func (p *ProjectService) Recents() []string {
	path, err := recentsPath()
	if err != nil {
		return []string{}
	}
	f, err := os.Open(path)
	if err != nil {
		return []string{}
	}
	defer f.Close()
	out := []string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() && len(out) < recentMax {
		line := strings.TrimSpace(sc.Text())
		if line != "" {
			out = append(out, line)
		}
	}
	return out
}

func saveRecents(list []string) {
	path, err := recentsPath()
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, []byte(strings.Join(list, "\n")+"\n"), 0o644)
}

func without(list []string, item string) []string {
	out := list[:0:0]
	for _, x := range list {
		if x != item {
			out = append(out, x)
		}
	}
	return out
}

func (p *ProjectService) PushRecent(root string) []string {
	list := append([]string{root}, without(p.Recents(), root)...)
	if len(list) > recentMax {
		list = list[:recentMax]
	}
	saveRecents(list)
	return list
}

func (p *ProjectService) ForgetRecent(root string) []string {
	list := without(p.Recents(), root)
	saveRecents(list)
	return list
}

// ------------------------------------------------------------- opens

// queueOpen records a path the OS handed us (a Finder double-click, a
// second launch with arguments) and tells a running frontend to drain it.
func (p *ProjectService) queueOpen(path string) {
	log.Printf("open: %s", path)
	p.mu.Lock()
	p.queue = append(p.queue, path)
	p.mu.Unlock()
	if p.app != nil {
		p.app.Event.Emit("open-files", path)
	}
	if p.win != nil {
		p.win.Focus()
	}
}

// queueArgs takes command-line arguments (relative to wd) as opens.
func (p *ProjectService) queueArgs(args []string, wd string) {
	for _, a := range args {
		if a == "" || strings.HasPrefix(a, "-") {
			continue
		}
		if !filepath.IsAbs(a) {
			a = filepath.Join(wd, a)
		}
		p.queueOpen(a)
	}
}

func (p *ProjectService) DrainOpenQueue() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := p.queue
	p.queue = nil
	if out == nil {
		out = []string{}
	}
	return out
}

// ------------------------------------------------------------- serve

func (p *ProjectService) Serve(root string) (ServeInfo, error) {
	if root == "" {
		return ServeInfo{}, errors.New("no project open")
	}
	return p.server.Start(root)
}

func (p *ProjectService) ServeStatus() ServeInfo {
	return p.server.Info()
}

func (p *ProjectService) ServeStop() {
	p.server.Stop()
}
