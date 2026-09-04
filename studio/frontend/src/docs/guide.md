# fastart studio

The editor for Fast Art Format files. It edits `.fart` files; that is all
it does. It knows nothing about any game or engine, and it is called
what it is called on purpose.

## Projects

A folder is a project. Open one with **Open Folder…** (Cmd+O), by
dropping a folder on the window, by double-clicking a `.fart` in the
Finder, or from a terminal: `studio some/dir`, `studio thing.fart`.
Recent projects wait on the welcome screen.

An open project is the **shelf**: every `.fart` below the folder as a live
thumbnail, nested folders and all. Click one to edit. **new file** makes
one; a name like `enemies/bat` makes the folder too. **Browse** (or
Cmd+O) brings the shelf back; **Open…** switches projects; **Projects**
returns to the welcome screen.

The **explorer** on the left (☰, or Cmd+B) is the same project as a
tree, beside the shelf and beside the canvas: click a file to open it
from anywhere, hover a folder for **+** to start a file inside it. The
open file is lit, with an amber dot while it has unsaved changes.

## The editor

Four regions, the way Rive, Spine and Figma lay it out: **structure on
the left** (the project's files, then the open file's parts as a tree),
**the canvas in the middle**, **the inspector on the right** (whatever is
selected), and **time along the bottom** (states and clips; the timeline
rises when a clip is chosen).

- **Tools**: Select `V`, Rect `R`, Circle `O`, Line `L`, Poly `P`. The
  digits `1`–`5` still work. `C` is the collision lens.
- **Canvas**: the tool is what a click does. Hold `Space` and drag (or
  middle-drag) to pan; scroll pans; `Cmd`+scroll or a pinch zooms about
  the cursor. `Cmd =` / `Cmd -` zoom, `Cmd 0` is actual size, `Shift 1`
  fits everything, `Shift 2` fits the selection. Right-click for the
  short list. `Cmd K` for the long one.
- **Select**: hovering outlines what a click would pick; a selected shape
  shows handles (circle radius, line ends, every vertex) and its body
  drags. `Shift`-click adds to the selection; drag on empty ground for a
  rubber band; `Cmd A` takes everything. Arrows nudge a unit, `Shift`
  arrows ten. `Alt`-drag drags away a copy. `X` or `Delete` deletes.
- **Snapping**: points pull to other shapes' corners, ends, centres and
  pivots as you draw or drag; `Cmd '` adds the half-unit grid. Hold `Cmd`
  during a gesture to snap to nothing. A small × marks where a point
  landed.
- **Constrain**: `Shift` while drawing keeps a line to 45° steps and a
  rect square. `Alt` on a rect's corner breaks it into a free quad;
  without it the rect stays a rect.
- **Poly**: click to add points; click the first point again, or press
  `Enter`, to close. `Esc` drops it.
- **Rename** anything inline: double-click a part, a state, a clip, a
  token, an anchor, or press `Enter` with a part current. New things
  arrive already being renamed.

## Layers (left)

The parts of the file as a tree: children sit under their parents. Click
to make a part current (new shapes land there); the **eye** hides a part
while you work and the **lock** keeps it out of reach, and neither is
saved. Right-click a row for rename, pivot, anchor, order and delete.
File order is paint order; raise and lower a part from the inspector or
the menu.

## Inspector (right)

The properties of whatever is selected, as numbers you can type:

- **Shape**: its fill (a palette token, picked from a grid), its numbers
  (centre and radius, ends and width), raise, lower, to part, delete.
- **Part**: name, pivot, parent, the buttons that arm the pivot and
  anchor crosshairs, its anchors with their coordinates, and its IK
  chains.
- **Pose** (with a state chosen): where the pivot lands, turn, size,
  reset, and whether the part is drawn in this state.
- **Document** (nothing selected): the file's name, the palette with a
  colour picker behind every swatch, the shared tokens, the collision
  count.

## Palette

A shape's fill is a token, picked in the inspector. The palette itself
lives in the Document section of the inspector (nothing selected): click
a swatch for the colour picker, double-click a name to rename it, and
shapes follow the rename. Tokens arriving through `palette_refs` are
listed under **Shared**, read-only: paint with them here, edit them in
their own file. Colours are never literal: a shape names a token, the
palette says what that means today.

## Rigs: parents

A part may have a **parent** (the select under the parts list). A child
is posed in its parent's frame, so moving or turning the torso carries
the head and the arms with it, and their own state entries stay at rest.
Nothing changes at rest: parents only matter once something moves. In
pose mode the rig shows as dashed bones from each pivot to its parent's.
Paint order is still the state's list; parents are about motion, not
layering.

## States: pose mode

States are chips along the bottom; **setup** is every part at rest,
where geometry is edited. Click a state and the canvas shows it with its
transforms applied — and switches from editing geometry to posing parts. Drag a part to place it
(its offset is where the part's pivot lands), pull the lever off the
pivot to turn it, and the Pose card gives turn and size sliders and a
reset. Geometry is locked until you go back to **all parts**. State order
is paint order, so a lid may layer differently open and closed.

## Clips: states in time

A clip is a list of keys, each at a time in seconds, each naming a state.
**+ clip** makes one with a single key at 0. Select a clip and the
timeline appears under the canvas: **▶** (or Space) plays, the ruler
scrubs, **+ key** drops a key at the playhead, and a key drags along the
ruler. The selected key's state, its ease (how time approaches it), and
its time sit to the right. Between keys the parts tween: offset and size
linearly, turns the short way round; which parts show, and their paint
order, switch at the key. **loop** wraps time at the last key. Keys name
states, so to change what a key looks like you pose that state; a clip
never carries its own pose.

## Chains: reaching with IK

Give a part an anchor (a hand, a foot), then **+ chain** in the Chains
panel: the chain runs from the part's parent to the part and reaches
with that anchor. **longer** adds the next parent; **bend** says which
way an elbow should fold when it could go either way. In pose mode every
chain shows a teal ring at its reach point: drag the ring and the chain's
parts turn to follow. Only rotations change, and the result is an
ordinary state, so games need nothing new to draw it. The chain itself is
saved too, for games that want to solve live.

## The collision lens

The Collision button (or C) dims the art and edits the document's
`collision` list with the same tools: shapes a game may treat as solid.
A line is a capsule (a girth slider when selected); they never draw
in-game. Esc deselects, X deletes, C flips back.

## Themes

The ◐ button in any top bar picks a theme: Graphite (the default),
Midnight, Moss, Plum, Paper (light), and High contrast, or **System** to
follow the OS between Graphite and Paper. The canvas grid, selection and
handles follow the panels. The choice is remembered per device, so a
tablet can wear a different one than the desk.

## Clipboard and keys

Everything the studio does is in the menu bar, in `Cmd K`, and on a
key; the same list drives all three. Cmd+C / Cmd+V copy and paste the
selection; Cmd+X cuts; Cmd+D duplicates in place. Pasted shapes land in the part they were copied from (matched
by name, so pasting works across files), or the current part when no
name matches, nudged a little each paste. Esc deselects or cancels;
Cmd+Z undoes; Cmd+Shift+Z (or Cmd+Y) redoes. `?` opens these docs.

## Saving is a checkpoint, not a copy

The file on disk always mirrors what you see, written a beat after every
change, so a game hot-reloading the file shows your experiment live.
**Save** (Cmd+S) marks the checkpoint; leaving the file any other way —
Browse, opening another file, quitting — rolls the disk back to the last
checkpoint. The amber dot by the filename means "uncommitted: this rolls
back unless you Save." The checkpoint also lives beside the file as
`<name>.fart~`, rewritten at every open and save, so even a crash can't
lose the last saved state.

## Serve: the tablet workflow

**Serve** on the shelf puts this same editor on your network (port 4747)
and shows the URL and a QR code. Scan it and the editor opens in the
tablet's browser, on the same project. Draw with the pencil; one finger
draws, two fingers pan and pinch. Every change streams back to disk. No
cloud, no app store: your machine serves, your tablet draws. From a
terminal, `studio --serve some/dir` does the same without a window.

## Files a tool refused

A file that is not JSON, carries a version the studio does not know, or
breaks the schema will not open; the shelf says why. A file with softer
trouble — a token nothing supplies, a state naming a part that is gone —
opens anyway, renders the trouble in loud magenta, and lists it in the
toolbar so you can fix it. The format spec (next page) has the full list
of what is checked, and `fart validate` checks a whole folder from the
command line.
