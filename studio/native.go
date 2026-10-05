package main

// What the page asks the platform to draw for it instead of drawing it
// itself: the menu under a right-click, the file dialog, and whether the
// window is full screen (where macOS hides the traffic lights the page
// otherwise leaves room for).

import (
	"errors"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// PopupItem is one row of a native menu the page describes. The page keeps
// what each row does; a click comes back as the row's id on "popup".
type PopupItem struct {
	ID        string      `json:"id"`
	Label     string      `json:"label"`
	Separator bool        `json:"separator"`
	Disabled  bool        `json:"disabled"`
	Checked   bool        `json:"checked"`
	Keys      string      `json:"keys"`
	Items     []PopupItem `json:"items"`
}

const popupName = "uranus"

func (p *ProjectService) fillMenu(menu *application.Menu, items []PopupItem) {
	for _, it := range items {
		switch {
		case it.Separator:
			menu.AddSeparator()
		case len(it.Items) > 0:
			p.fillMenu(menu.AddSubmenu(it.Label), it.Items)
		default:
			var mi *application.MenuItem
			if it.Checked {
				mi = menu.AddCheckbox(it.Label, true)
			} else {
				mi = menu.Add(it.Label)
			}
			if it.Disabled || it.ID == "" {
				mi.SetEnabled(false)
				continue
			}
			id := it.ID
			mi.OnClick(func(*application.Context) { p.app.Event.Emit("popup", id) })
		}
	}
}

// PopupMenu shows the platform's context menu at a point of the page.
func (p *ProjectService) PopupMenu(items []PopupItem, x, y int) {
	if p.win == nil || len(items) == 0 {
		return
	}
	menu := p.app.ContextMenu.New()
	p.fillMenu(menu.Menu, items)
	p.app.ContextMenu.Add(popupName, menu)
	p.win.OpenContextMenu(&application.ContextMenuData{Id: popupName, X: x, Y: y})
}

// PickFile shows the platform's open dialog inside the project and answers
// with the file's path from the project's root. "" means cancelled; a file
// outside the project is refused, since a project only names its own files.
func (p *ProjectService) PickFile(root, dir, title, button string, exts []string) (string, error) {
	start, err := rooted(root, dir)
	if err != nil {
		start = root
	}
	dlg := p.app.Dialog.OpenFile().
		SetTitle(title).
		SetMessage(title).
		CanChooseDirectories(false).
		CanChooseFiles(true).
		SetDirectory(start)
	if button != "" {
		dlg.SetButtonText(button)
	}
	if len(exts) > 0 {
		pats := make([]string, len(exts))
		for i, e := range exts {
			pats[i] = "*." + strings.TrimPrefix(e, ".")
		}
		// what the filter is called: the art's own files, or pictures (a reference image)
		name := "Fast Art"
		if _, img := imageTypes["."+strings.TrimPrefix(strings.ToLower(exts[0]), ".")]; img {
			name = "Images"
		}
		dlg.AddFilter(name, strings.Join(pats, ";"))
	}
	if p.win != nil {
		dlg.AttachToWindow(p.win)
	}
	path, err := dlg.PromptForSingleSelection()
	if err != nil || path == "" {
		return "", err
	}
	base, err := filepath.EvalSymlinks(root)
	if err != nil {
		base = root
	}
	full, err := filepath.EvalSymlinks(path)
	if err != nil {
		full = path
	}
	rel, err := filepath.Rel(base, full)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return "", errors.New(filepath.Base(path) + " is outside the project")
	}
	return filepath.ToSlash(rel), nil
}

// PickFolderAt is the folder dialog with its own words, for a new project's
// home and a clone's destination. "" means cancelled.
func (p *ProjectService) PickFolderAt(title, button string) (string, error) {
	dlg := p.app.Dialog.OpenFile().
		SetTitle(title).
		SetMessage(title).
		SetButtonText(button).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true)
	if p.win != nil {
		dlg.AttachToWindow(p.win)
	}
	return dlg.PromptForSingleSelection()
}

// Fullscreen says whether the window is full screen right now.
func (p *ProjectService) Fullscreen() bool {
	return p.win != nil && p.win.IsFullscreen()
}

// CloseWindow is the launcher's close light.
func (p *ProjectService) CloseWindow() {
	if p.win != nil {
		p.win.Close()
	}
}
