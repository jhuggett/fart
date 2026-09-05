package main

// The menu bar. Every item just names a command; the page runs it (the
// same registry the keyboard and the command palette read), so the
// menu cannot do anything the page cannot.

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

func buildMenu(app *application.App) *application.Menu {
	send := func(id string) func(*application.Context) {
		return func(*application.Context) { app.Event.Emit("menu", id) }
	}
	menu := app.NewMenu()
	menu.AddRole(application.AppMenu)

	file := menu.AddSubmenu("File")
	file.Add("New File…").SetAccelerator("CmdOrCtrl+N").OnClick(send("file.new"))
	file.Add("Open Folder…").SetAccelerator("CmdOrCtrl+Shift+O").OnClick(send("file.openFolder"))
	file.Add("Projects").OnClick(send("file.projects"))
	file.AddSeparator()
	file.Add("Save (Checkpoint)").SetAccelerator("CmdOrCtrl+S").OnClick(send("file.save"))
	file.Add("Revert to Checkpoint").OnClick(send("file.revert"))
	file.Add("Browse Files").SetAccelerator("CmdOrCtrl+O").OnClick(send("file.browse"))
	file.AddSeparator()
	file.Add("Serve on the Network").OnClick(send("file.serve"))

	edit := menu.AddSubmenu("Edit")
	edit.Add("Undo").SetAccelerator("CmdOrCtrl+Z").OnClick(send("edit.undo"))
	edit.Add("Redo").SetAccelerator("CmdOrCtrl+Shift+Z").OnClick(send("edit.redo"))
	edit.AddSeparator()
	edit.Add("Cut").SetAccelerator("CmdOrCtrl+X").OnClick(send("edit.cut"))
	edit.Add("Copy").SetAccelerator("CmdOrCtrl+C").OnClick(send("edit.copy"))
	edit.Add("Paste").SetAccelerator("CmdOrCtrl+V").OnClick(send("edit.paste"))
	edit.Add("Duplicate").SetAccelerator("CmdOrCtrl+D").OnClick(send("edit.duplicate"))
	edit.Add("Delete").OnClick(send("edit.delete"))
	edit.AddSeparator()
	edit.Add("Select All").SetAccelerator("CmdOrCtrl+A").OnClick(send("edit.selectAll"))
	edit.Add("Deselect").OnClick(send("edit.escape"))
	edit.AddSeparator()
	edit.Add("Raise").OnClick(send("edit.raise"))
	edit.Add("Lower").OnClick(send("edit.lower"))

	view := menu.AddSubmenu("View")
	view.Add("Zoom In").SetAccelerator("CmdOrCtrl+=").OnClick(send("view.zoomIn"))
	view.Add("Zoom Out").SetAccelerator("CmdOrCtrl+-").OnClick(send("view.zoomOut"))
	view.Add("Actual Size").SetAccelerator("CmdOrCtrl+0").OnClick(send("view.zoom100"))
	view.Add("Zoom to Fit").SetAccelerator("Shift+1").OnClick(send("view.fit"))
	view.Add("Zoom to Selection").SetAccelerator("Shift+2").OnClick(send("view.fitSelection"))
	view.AddSeparator()
	view.Add("Snap to Grid").SetAccelerator("CmdOrCtrl+'").OnClick(send("view.snapGrid"))
	view.Add("Collision Lens").OnClick(send("view.collision"))
	view.AddSeparator()
	view.Add("Explorer").SetAccelerator("CmdOrCtrl+B").OnClick(send("view.explorer"))
	view.Add("Command Palette…").SetAccelerator("CmdOrCtrl+K").OnClick(send("app.palette"))

	menu.AddRole(application.WindowMenu)

	help := menu.AddSubmenu("Help")
	help.Add("Ask Claude").SetAccelerator("CmdOrCtrl+J").OnClick(send("chat.toggle"))
	help.Add("Uranus Docs").OnClick(send("app.docs"))
	help.Add("The Format").OnClick(send("app.docsFormat"))

	return menu
}
