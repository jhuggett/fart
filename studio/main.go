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
		Description: "the fastart studio. It emits farts.",
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

	win := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "Uranus",
		Width:            1360,
		Height:           860,
		MinWidth:         900,
		MinHeight:        600,
		BackgroundColour: application.NewRGB(18, 18, 19),
		EnableFileDrop:   true,
		URL:              "/",
	})
	proj.win = win
	app.Menu.Set(buildMenu(app))
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
