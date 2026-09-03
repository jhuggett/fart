# fastart -- the Fast Art Format

JSON-backed vector art for games: shapes, recolorable palette tokens,
re-posable parts, states. The `.fart` file is the contract; see
`spec/FORMAT.md`. This repo holds the spec, the standalone editor
(`editor/`), and a reference Odin loader (`loaders/odin/`).

Scope, forever: the editor edits Fast Art Format files. It knows nothing
about any game or engine.

    ./build.sh               # builds ./fastart and ./fastart.app
    ./fastart                # the current directory is the project
    ./fastart some/dir       # that one is
    ./fastart thing.fart     # edit (created if missing)

## Using it

A folder is a project, the way an IDE opens one. `./build.sh` leaves a
double-clickable `fastart.app` beside the `fastart` binary (drag it to
Applications if you like). Launched from the Finder it shows the welcome
screen: recent projects, and "Open Folder..." (Cmd+O) for a new one --
or drop a folder or a `.fart` file onto the window. Double-clicking a
`.fart` in the Finder opens it here too, with its folder as the project.
From a terminal, `fastart` opens the current directory, `fastart some/dir`
that one, and `fastart thing.fart` a file inside the current directory's
project.

An open project is the browser: every `.fart` below the folder, as live
thumbnails, nested folders and all. Click one to edit; "new file" creates
one (a name like `enemies/bat` makes the folder); "Browse" (or Cmd+O)
returns. "Open..." switches projects, "Projects" goes back to the welcome
screen, and Cmd+Shift+O opens a folder from anywhere. Recent projects
live in `~/Library/Application Support/fastart/recent.txt`.

The editor is mouse-first:

- **Toolbar**: select / circle / line / poly (keys 1-4), save, undo,
  browse.
- **Canvas**: left-click uses the tool; right-drag pans; wheel zooms.
  With select, hovering outlines what a click would pick; a selected
  shape shows drag handles -- circle radius, line endpoints, every
  polygon vertex -- and dragging its body moves it. X deletes.
  A rect keeps itself rectangular when you drag a corner (its neighbors
  follow); hold Alt while dragging to break it into a free quad.
  Shift-click adds to or removes from the selection; dragging on empty
  ground sweeps a rubber band over many shapes at once. A crowd moves,
  deletes, paints, re-parts, and raises/lowers together -- it drifts
  through the stack keeping its internal order (handles are single-shape).
- **Palette (left)**: click a token to make it current -- and to paint it
  onto the selected shape, if there is one. Sliders below edit the
  current token's RGBA live. Tokens arriving from shared palettes are
  listed read-only (edit them by opening the palette file itself).
- **Selected shape (left, below)**: kind, token, width slider for lines,
  raise/lower through the part's stacking order (also `]` and `[`),
  delete, and "to part" to move it into the current part.
- **Parts (right)**: click to choose the current part (new shapes land
  there). Parts are the layers: they draw top to bottom, so a lower row
  paints over the ones above -- the ^ / v buttons on the current row
  reorder them, and its x deletes it (shapes go with it; states drop the
  name). The current token and state rows carry the same x. "set pivot" /
  "add anchor" arm a crosshair -- the next canvas click places it. When a
  state is selected, each part row grows a checkbox: membership.
- **States (right, below) are pose mode**: click a state and the canvas
  shows it with its transforms applied -- and switches from editing
  geometry to posing parts. Drag a part to place it (its offset is where
  the part's pivot lands), pull the lever off the pivot to turn it, and
  the POSE card gives turn/size sliders and a reset. Geometry is locked
  until you go back to "all parts."
- **Scaling**: a selection grows a bounding box whose corner grips scale
  it about the opposite corner -- works on one shape or a whole crowd.
- **The collision lens** (toolbar button, or C): the art dims and you
  edit the doc's `collision` list with the same tools -- shapes a game
  may treat as solid. A line is a capsule (girth slider when selected);
  they never draw in-game. Esc deselects, X deletes, C flips back.
- Double-click a part, state, or token row to rename it -- references
  follow (states track a renamed part, shapes track a renamed token).
- Cmd+C / Cmd+V copy and paste the selection; Cmd+X cuts; Cmd+D
  duplicates in place. Pasted shapes land in the part they were copied
  from (matched by name -- so pasting works across files), or the current
  part when no name matches, nudged a little each paste. The paste
  becomes the selection, ready to drag.
- Esc deselects / cancels; Cmd+Z undoes; Cmd+Shift+Z (or Cmd+Y) redoes.
  A new change abandons the redo branch, as usual.

## Serve mode (the iPad workflow)

The native binary embeds a wasm build of this same editor. Hit **Serve**
in the browse screen (or launch `fastart --serve`) and it serves that
editor plus a small file API on the LAN (port 4747), showing the URL and
a QR code -- scan it and the editor opens in the tablet's browser, on
the open project. Draw with the pencil; one finger draws, two fingers
pan and pinch. Lists everywhere -- the browse shelf and both side
panels -- scroll with a drag (or the wheel on a desktop); a tap, not a
press, is what activates rows and buttons, so scrolling never
mis-clicks. Every change streams back and lands on disk, so a game
hot-reloading that directory shows each stroke in about half a second.
No cloud, no app store: your machine serves, your tablet draws.

Caveat: closing the tab mid-experiment can't run the leave-rollback (no
one is left to run it) -- same as a crash, the `<name>.fart~` checkpoint
beside the file is the recovery. Browsing between files on the tablet
reverts normally.

`./build.sh` builds web, then native (the native binary embeds the web
build), then wraps `fastart.app` around it (`build_app.sh`, macOS);
`build_web.sh` alone refreshes just the web editor.
- **Saving is a checkpoint, not a copy.** The file on disk always mirrors
  what you see (written a beat after every change, so a game hot-reloading
  the file shows your experiment live). Save (Cmd+S) marks the checkpoint;
  leaving the file any other way -- browse, opening another file, quitting
  -- rolls the disk back to the last checkpoint. The amber dot by the
  filename means "uncommitted: this rolls back unless you Save."
  The checkpoint also lives beside the file as `<name>.fart~` (rewritten
  at every open and save), so even a crash that skips the rollback can't
  lose the last saved state -- copy the `~` file back if it ever happens.
