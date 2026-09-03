# fastart studio

The Fast Art Format editor as a desktop app: a thin Go shell (Wails 3)
around a web frontend (Preact + a canvas). The same frontend also runs
from the shell's LAN server, which is how a tablet draws into the same
folder.

    main.go        the app: window, file associations, argv, the open queue
    project.go     ProjectService: folder dialog, rooted file IO, recents, serve
    serve.go       the LAN server: embedded frontend + /api/{info,list,file}
    frontend/      the editor (see frontend/src/docs/guide.md for how it feels)
      src/shell    the seam: Wails bindings inside the app, fetch() when served
      src/state    the stores: project (folder, files, screen) and editor (document)
      src/canvas   camera, drawing, interaction, the frame
      src/ui       panels; src/screens: welcome, browse, editor, docs

    wails3 dev                      # live reload
    wails3 task package             # bin/studio.app (macOS) / bin/studio (elsewhere)
    ./bin/studio --serve some/dir   # no window: the LAN server only

Needs Go, Node (the repo root's `npm install` covers the frontend), and
the Wails CLI: `go install github.com/wailsapp/wails/v3/cmd/wails3@latest`.
