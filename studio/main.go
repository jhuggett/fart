package main

// Uranus, the fastart studio: the Fast Art Format editor as a desktop app. The shell
// is deliberately thin: a window, a folder dialog, file IO rooted at one
// project, recents, the OS handing us documents, and a LAN server so a
// tablet can draw into the same folder. Everything else is the frontend.
//
//   studio                  welcome screen (or the terminal's dir as project)
//   studio some/dir         that dir as the project
//   studio thing.fart       that file, in its project
//   studio --serve <dir>    no window: serve the editor on the LAN

import (
	"embed"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	// the frontend listens for these: a path that arrived, a menu item chosen
	application.RegisterEvent[string]("open-files")
	application.RegisterEvent[string]("menu")
	application.RegisterEvent[ChatEvent]("chat")
	application.RegisterEvent[ToolCall]("tool")
	application.RegisterEvent[UpdateProgress]("update")
	application.RegisterEvent[bool]("fullscreen")
	application.RegisterEvent[string]("popup")
	application.RegisterEvent[GitProgress]("git")
}

func main() {
	server := NewServer(assets)
	// Claude, inside: the tool relay and the chat live in both modes
	hub := newBus()
	mcp, err := startMCP(hub)
	if err != nil {
		log.Fatal(err)
	}
	chat := newChat(hub, mcp)
	server.chat = chat
	server.bus = hub

	if len(os.Args) >= 3 && os.Args[1] == "--serve" {
		root, err := filepath.Abs(os.Args[2])
		if err != nil {
			log.Fatal(err)
		}
		info, err := server.Start(root)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("Uranus serving %s\n  %s\n", root, info.URL)
		select {}
	}

	proj := &ProjectService{server: server, chat: chat}
	cwd, _ := os.Getwd()

	// a second launch (a double-click, `studio other.fart`) hands its
	// arguments to the running one; FASTART_MULTI=1 allows a second studio
	single := &application.SingleInstanceOptions{
		UniqueID: "com.fastart.studio",
		OnSecondInstanceLaunch: func(d application.SecondInstanceData) {
			args := d.Args
			if len(args) > 0 {
				args = args[1:]
			}
			proj.queueArgs(args, d.WorkingDir)
		},
	}
	if os.Getenv("FASTART_MULTI") != "" {
		single = nil
	}

	app := application.New(application.Options{
		Name:        "Uranus",
		Description: "the reference editor for the Fast Art Format",
		Services: []application.Service{
			application.NewService(proj),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		FileAssociations: []string{".fart"},
		SingleInstance:   single,
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
	proj.app = app
	hub.app = app

	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(ev *application.ApplicationEvent) {
		ctx := ev.Context()
		for _, f := range ctx.OpenedFiles() {
			proj.queueOpen(f)
		}
		if f, ok := ctx.Data()["filename"].(string); ok && f != "" {
			proj.queueOpen(f)
		}
	})

	proj.queueArgs(os.Args[1:], cwd)

	// with nothing to open the window is the launcher: small, fixed, centred.
	// With a project on the way it opens at its working size at once.
	opts := application.WebviewWindowOptions{
		Title:            "Uranus",
		Width:            launcherW,
		Height:           launcherH,
		MinWidth:         launcherW,
		MinHeight:        launcherH,
		DisableResize:    true,
		InitialPosition:  application.WindowCentered,
		BackgroundColour: application.NewRGB(38, 36, 34),
		EnableFileDrop:   true,
		URL:              "/",
		// no title bar: the traffic lights sit inline, in the navigator's
		// header (the page leaves room for them, and takes it back in
		// full screen, where they hide)
		Mac: application.MacWindow{
			TitleBar:                application.MacTitleBarHiddenInsetUnified,
			InvisibleTitleBarHeight: 0,
		},
	}
	if proj.pendingOpen() || proj.DefaultRoot() != "" {
		opts.Width, opts.Height = workW, workH
		opts.MinWidth, opts.MinHeight = workMinW, workMinH
		opts.DisableResize = false
		proj.working = true
	}
	win := app.Window.NewWithOptions(opts)
	proj.win = win
	app.Menu.Set(buildMenu(app))
	// the lights hide in full screen: the page closes the gap it left for them
	full := func(on bool) func(*application.WindowEvent) {
		return func(*application.WindowEvent) { app.Event.Emit("fullscreen", on) }
	}
	win.OnWindowEvent(events.Common.WindowFullscreen, full(true))
	win.OnWindowEvent(events.Common.WindowUnFullscreen, full(false))
	win.OnWindowEvent(events.Mac.WindowWillEnterFullScreen, full(true))
	win.OnWindowEvent(events.Mac.WindowWillExitFullScreen, full(false))
	// a folder or a .fart dropped on the window opens, like the Finder's
	win.OnWindowEvent(events.Common.WindowFilesDropped, func(ev *application.WindowEvent) {
		for _, f := range ev.Context().DroppedFiles() {
			proj.queueOpen(f)
		}
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
