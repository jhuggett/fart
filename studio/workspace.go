package main

// The workspace's shell needs: a project scaffolded on disk, the branch a
// project sits on (and the others it could), and the window sized for the
// launcher or for work. Git is only ever the `git` on the PATH; when a
// folder is not a repository every answer is empty and the bar hides it.

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

var projectName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._-]*$`)

// NewProject makes <parent>/<name> with an assets folder and a .gitignore
// for the checkpoints, and returns the new root. It refuses to touch a
// folder that already exists.
func (p *ProjectService) NewProject(parent, name string) (string, error) {
	name = strings.TrimSpace(name)
	if parent == "" || !filepath.IsAbs(parent) {
		return "", errors.New("choose a folder to put the project in")
	}
	if !projectName.MatchString(name) {
		return "", fmt.Errorf("%q is not a name a folder can have", name)
	}
	root := filepath.Join(parent, name)
	if _, err := os.Stat(root); err == nil {
		return "", fmt.Errorf("%s already exists", root)
	}
	if err := os.MkdirAll(filepath.Join(root, "assets"), 0o755); err != nil {
		return "", err
	}
	ignore := "# Uranus keeps a checkpoint beside every file it saves\n*.fart~\n*.shart~\n"
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte(ignore), 0o644); err != nil {
		return "", err
	}
	return root, nil
}

// PickParentFolder shows the folder dialog for a new project's home. "" means cancelled.
func (p *ProjectService) PickParentFolder() (string, error) {
	dlg := p.app.Dialog.OpenFile().
		SetTitle("Where should the project live?").
		SetButtonText("Create Here").
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if p.win != nil {
		dlg.AttachToWindow(p.win)
	}
	return dlg.PromptForSingleSelection()
}

// ------------------------------------------------------------- git

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return "", errors.New(msg)
	}
	return strings.TrimSpace(string(out)), nil
}

// Branch is the branch the project's repository has checked out, "" when
// the folder is not in a repository (or git is not installed). A detached
// HEAD reads as its short hash.
func (p *ProjectService) Branch(dir string) string {
	if dir == "" || gitRoot(dir) == "" {
		return ""
	}
	if b, err := git(dir, "symbolic-ref", "--short", "-q", "HEAD"); err == nil && b != "" {
		return b
	}
	h, _ := git(dir, "rev-parse", "--short", "HEAD")
	return h
}

// Branches lists the repository's local branches, the current one included.
func (p *ProjectService) Branches(dir string) []string {
	if dir == "" || gitRoot(dir) == "" {
		return []string{}
	}
	out, err := git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
	if err != nil || out == "" {
		return []string{}
	}
	return strings.Split(out, "\n")
}

// SwitchBranch checks a branch out. Git's own words come back when it
// refuses (uncommitted changes in the way, most often).
func (p *ProjectService) SwitchBranch(dir, name string) error {
	if dir == "" || gitRoot(dir) == "" {
		return errors.New("not a repository")
	}
	_, err := git(dir, "switch", name)
	return err
}

// ------------------------------------------------------------- window

const (
	launcherW, launcherH = 780, 460
	workW, workH         = 1360, 860
)

// WindowLauncher shrinks the window to the launcher and centres it; the
// size it had is kept for WindowWork.
func (p *ProjectService) WindowLauncher() {
	if p.win == nil {
		return
	}
	w, h := p.win.Size()
	if w > launcherW || h > launcherH {
		p.workW, p.workH = w, h
	}
	p.win.SetSize(launcherW, launcherH)
	p.win.Center()
}

// WindowWork grows the window back for a project.
func (p *ProjectService) WindowWork() {
	if p.win == nil {
		return
	}
	w, h := p.win.Size()
	if w >= workW-200 && h >= workH-200 {
		return // already a working size (a maximised window stays put)
	}
	tw, th := p.workW, p.workH
	if tw < 900 || th < 600 {
		tw, th = workW, workH
	}
	p.win.SetSize(tw, th)
	p.win.Center()
}
