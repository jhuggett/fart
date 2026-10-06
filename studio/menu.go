package main

// The menu bar. Every item just names a command; the page runs it (the
// same registry the keyboard and the command palette read), so the
// menu cannot do anything the page cannot.

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func buildMenu(app *application.App) *application.Menu {
	send := func(id string) func(*application.Context) {
		return func(*application.Context) { app.Event.Emit("menu", id) }
	}
	menu := app.NewMenu()
	if runtime.GOOS == "darwin" {
		// the app menu, spelled out so Settings sits where a Mac keeps it
		am := menu.AddSubmenu("Uranus")
		am.AddRole(application.About)
		am.Add("Check for Updates…").OnClick(send("app.update"))
		am.AddSeparator()
		am.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(send("app.settings"))
		am.AddSeparator()
		am.AddRole(application.ServicesMenu)
		am.AddSeparator()
		am.AddRole(application.Hide)
		am.AddRole(application.HideOthers)
		am.AddRole(application.UnHide)
		am.AddSeparator()
		am.AddRole(application.Quit)
	}

	file := menu.AddSubmenu("File")
	file.Add("New Asset…").SetAccelerator("CmdOrCtrl+N").OnClick(send("file.new"))
	file.Add("New 3D Asset…").OnClick(send("file.newModel"))
	file.Add("New Palette…").OnClick(send("file.newPalette"))
	file.Add("New Scene…").OnClick(send("file.newScene"))
	file.Add("New 3D Scene…").OnClick(send("file.newScene3d"))
	file.AddSeparator()
	file.Add("New Project…").SetAccelerator("CmdOrCtrl+Shift+N").OnClick(send("file.newProject"))
	file.Add("Open Project…").SetAccelerator("CmdOrCtrl+O").OnClick(send("file.openFolder"))
	file.Add("Clone Git Repository…").SetAccelerator("CmdOrCtrl+Alt+C").OnClick(send("file.clone"))
	file.Add("Close Project").OnClick(send("file.projects"))
	file.AddSeparator()
	file.Add("Save").SetAccelerator("CmdOrCtrl+S").OnClick(send("file.save"))
	file.Add("Revert to Checkpoint").OnClick(send("file.revert"))
	file.Add("Close Asset").SetAccelerator("CmdOrCtrl+W").OnClick(send("file.browse"))
	file.AddSeparator()
	file.Add("Project to 2D Views…").OnClick(send("model.project"))
	file.Add("Reveal Project").OnClick(send("file.reveal"))
	file.Add("Serve on the Network").OnClick(send("file.serve"))
	if runtime.GOOS != "darwin" {
		file.AddSeparator()
		file.Add("Settings…").SetAccelerator("CmdOrCtrl+,").OnClick(send("app.settings"))
	}

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
	view.Add("Navigator").SetAccelerator("CmdOrCtrl+0").OnClick(send("view.sidebar"))
	view.Add("Inspector").SetAccelerator("CmdOrCtrl+Alt+0").OnClick(send("view.inspector"))
	view.AddSeparator()
	view.Add("Assets").SetAccelerator("CmdOrCtrl+1").OnClick(send("nav.assets"))
	view.Add("Outline").SetAccelerator("CmdOrCtrl+2").OnClick(send("nav.outline"))
	view.Add("Search").SetAccelerator("CmdOrCtrl+3").OnClick(send("nav.search"))
	view.Add("Source Control").SetAccelerator("CmdOrCtrl+4").OnClick(send("nav.git"))
	view.AddSeparator()
	view.Add("Zoom In").SetAccelerator("CmdOrCtrl+=").OnClick(send("view.zoomIn"))
	view.Add("Zoom Out").SetAccelerator("CmdOrCtrl+-").OnClick(send("view.zoomOut"))
	view.Add("Actual Size").SetAccelerator("Shift+0").OnClick(send("view.zoom100"))
	view.Add("Zoom to Fit").SetAccelerator("Shift+1").OnClick(send("view.fit"))
	view.Add("Zoom to Selection").SetAccelerator("Shift+2").OnClick(send("view.fitSelection"))
	view.AddSeparator()
	view.Add("Snap to Grid").SetAccelerator("CmdOrCtrl+'").OnClick(send("view.snapGrid"))
	view.Add("Collision Lens").OnClick(send("view.collision"))
	view.AddSeparator()
	view.Add("Back").SetAccelerator("CmdOrCtrl+[").OnClick(send("nav.back"))
	view.Add("Forward").SetAccelerator("CmdOrCtrl+]").OnClick(send("nav.forward"))
	view.Add("Switch Asset…").SetAccelerator("CmdOrCtrl+Shift+P").OnClick(send("asset.switch"))
	view.Add("Switch State…").SetAccelerator("CmdOrCtrl+Shift+S").OnClick(send("state.switch"))
	view.Add("Switch Branch…").OnClick(send("git.switch"))
	view.Add("New Branch…").OnClick(send("git.newBranch"))
	view.AddSeparator()
	view.Add("Appearance: Light / Dark").OnClick(send("app.appearance"))
	view.Add("Command Palette…").SetAccelerator("CmdOrCtrl+K").OnClick(send("app.palette"))

	win := menu.AddSubmenu("Window")
	win.AddRole(application.Minimise)
	win.AddRole(application.Zoom)
	win.AddRole(application.ToggleFullscreen)
	win.AddSeparator()
	win.Add("Welcome to Uranus").SetAccelerator("CmdOrCtrl+Shift+1").OnClick(send("file.projects"))

	// Help: find it by word, see this screen's keys, or start from a common question.
	// (On a Mac the system adds its own field that searches the menus.)
	help := menu.AddSubmenu("Help")
	help.Add("Search Help…").SetAccelerator("CmdOrCtrl+Shift+/").OnClick(send("help.search"))
	help.Add("Help for This Screen").OnClick(send("help.context"))
	help.Add("Keyboard Shortcuts").SetAccelerator("CmdOrCtrl+/").OnClick(send("help.keys"))
	help.AddSeparator()
	for _, c := range [][2]string{
		{"start", "Getting Started"},
		{"draw", "Drawing and Shapes"},
		{"colour", "Colours and Textures"},
		{"rig", "Rigging and Animation"},
		{"3d", "3D Models"},
		{"scenes", "Scenes"},
		{"game", "Collision and Games"},
		{"project", "Projects, Files and Setup"},
	} {
		help.Add(c[1]).OnClick(send("help.cat." + c[0]))
	}
	help.AddSeparator()
	help.Add("Uranus Docs").OnClick(send("app.docs"))
	help.Add("The Format").OnClick(send("app.docsFormat"))
	help.AddSeparator()
	help.Add("Ask Claude").SetAccelerator("CmdOrCtrl+J").OnClick(send("chat.toggle"))
	help.Add("Setup…").OnClick(send("app.settings"))
	if runtime.GOOS != "darwin" {
		help.Add("Check for Updates…").OnClick(send("app.update"))
	}

	return menu
}
