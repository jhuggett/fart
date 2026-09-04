package main

// fastart studio: the Fast Art Format editor as a desktop app. The shell
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
	// the frontend listens for this; the payload is the path that arrived
	application.RegisterEvent[string]("open-files")
}

func main() {
	server := NewServer(assets)

	if len(os.Args) >= 3 && os.Args[1] == "--serve" {
		root, err := filepath.Abs(os.Args[2])
		if err != nil {
			log.Fatal(err)
		}
		info, err := server.Start(root)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Printf("fastart studio serving %s\n  %s\n", root, info.URL)
		select {}
	}

	proj := &ProjectService{server: server}
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
		Name:        "fastart studio",
		Description: "the Fast Art Format editor",
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
		Title:            "fastart studio",
		Width:            1360,
		Height:           860,
		MinWidth:         900,
		MinHeight:        600,
		BackgroundColour: application.NewRGB(18, 18, 19),
		EnableFileDrop:   true,
		URL:              "/",
	})
	proj.win = win
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
