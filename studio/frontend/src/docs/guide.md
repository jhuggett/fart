# Uranus

The fastart studio. It emits farts.

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
selected), and **the timeline along the bottom** when a clip is chosen.
States and clips are listed in the left panel, under the layers.

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

## Colours

A shape never holds a colour. It names a **slot** (`skin`, `cloth`), and
the file's Colours list says what that slot means today: change a colour
there and every shape using it follows. Click the canvas with nothing
selected to see the list in the inspector: **+ colour** adds a slot, a
click on a swatch opens the picker, a double-click on a name renames it
(shapes follow), × removes it.

A **palette file** is a `.fart` with colours and no parts: a project's
shared vocabulary of slots. **new palette** on the shelf makes one (a
plain name lands in `palettes/`), and opening one shows only its
swatches. Link a palette file to an art file under **Shared palettes**
(+ link); its slots then appear under *From shared*, greyed, to paint
with. The file's own colours win over shared ones, so **override** copies
a shared slot into the file when one chest wants its own wood. A linked
palette that cannot be found is marked *missing* and its slots paint
magenta.

At runtime the same slots are the recolour surface: a game lays a
palette file over a document (`apply_palette` in the Odin loader,
`applyPalette` in core) and the red slime and the blue one are one
file.

## Ask Claude

**⌘J** opens a panel where you tell Claude what to change: "make the
left arm longer", "add a blink clip that shuts the eyes for a frame",
"give this a burnt palette variant". It runs your own Claude Code (the
one installed on this machine, with the fastart skill), and works
*through the editor*: it reads the open file and what you have selected,
changes the document as one undo step, so ⌘Z takes it back, looks at a
state or a clip frame to check its work, and validates before applying.
The transcript shows what it did (read, looked, changed, with a note)
and what it said. A conversation continues per project; the + starts a
fresh one. Each turn takes a few seconds and costs what a Claude Code
turn costs; the panel keeps a running total. On the shelf, with no file
open, it can open files and talk about the project. Setup says whether
Claude Code was found.

## Setup: agents and loaders

**Setup** (on the welcome screen, and in the shelf's top bar) checks
what this machine and the open project's repository have in place for
fastart, and installs what is missing with one click: the Claude Code
skill in `~/.claude/skills/fastart` (the format in one page, so Claude
in any project can write and check `.fart` files; `/fastart` invokes
it), a fastart section in the repository's `CLAUDE.md`, a `.gitignore`
line for the studio's `*.fart~` checkpoints, and, in an Odin project,
the reference loader copied in or brought up to date. The rows are
facts the studio just checked, so the screen doubles as a health check
after pulling a new studio. It writes only those four files.

## Rigs: parents

A part may have a **parent** (the select under the parts list). A child
is posed in its parent's frame, so moving or turning the torso carries
the head and the arms with it, and their own state entries stay at rest.
Nothing changes at rest: parents only matter once something moves. The
rig shows as dashed bones from each pivot to its parent's.
Paint order is still the state's list; parents are about motion, not
layering.

## States

Every view is a state. A file opens on its first state (a file that has
none gets one, `default`, with every part where it was drawn), and
everything you do happens in whichever state you are looking at: shapes
are drawn and reshaped in place, even inside a part that the state has
turned, and the part itself is placed by dragging its ⌖ and turned by
its lever. **+ state** makes a new state as a copy of the one on the
canvas; right-click any state to duplicate that one instead. A state
says which parts show (the checkboxes in Layers), where each sits, and
in what order (raise and lower in the inspector). The last state cannot
be deleted; there is always one. Drag a part to place it
(its offset is where the part's pivot lands), pull the lever off the
pivot to turn it, and the Pose card gives turn and size sliders and a
reset. Geometry is locked until you go back to **all parts**. State order
is paint order, so a lid may layer differently open and closed.

## Clips: states in time

A clip is a list of keys, each at a time in seconds, each naming a state.
**+ clip** (left panel, under the states) makes one with a single key
at 0. Select a clip and the timeline appears under the canvas: **▶** (or Space) plays, the ruler
scrubs, **+ key** drops a key at the playhead, and a key drags along the
ruler. The selected key's state, its ease (how time approaches it), and
its time sit to the right. Between keys the parts tween: offset and size
linearly, turns the short way round; which parts show, and their paint
order, switch at the key. **loop** wraps time at the last key. Keys name
states, so to change what a key looks like you pose that state; a clip
never carries its own pose.

## Mirror and reuse

A part can be **drawn like** another (the select under its parent): it
shows that part's shapes and anchors and has none of its own, with its
own pivot, parent and pose. The left claw is the right claw's geometry.
Then **mirror** in the part's pose block flips it left-to-right about
its pivot, before the turn, so it still turns the way its parent does.
Editing shapes on a part drawn like another edits the source. A child of
a mirrored part rides the flip, so the flame on a mirrored engine needs
no mirror of its own.

## Sockets: anchors with a direction

An anchor may point somewhere: the ↗ on its row gives it a direction
(degrees), drawn as a short line on the canvas. A game attaches things
by aligning anchors, the cutlass's `grip` onto the hand's `hand`, and
where both have a direction the item turns to match. Which item sits in
which hand is the game's business; the file only says where and which way.

## Pinned reach

Dragging a chain's ring now **pins** the point: the chain keeps reaching
it while the rest of the pose changes, so the hand stays on the latch
when the torso leans. The ring shows a filled centre when pinned, the
chain's card says where, and **release** lets go, leaving the rotations
as they are. Pins are saved with the state (`targets`), and a clip
tweens them between keys, re-solving as it plays.

## Events and curves

A key can carry **events**, names typed into the field beside its time:
`footstep`, `hit`. A game hears them when the playhead crosses the key;
the timeline marks such keys with a dot. A key can also carry a
**curve**, a bezier picked from presets (back out, quint in, …) or
tuned as four numbers; it wins over the named ease, which stays set to
the nearest name so older readers stay close.

## Glow

A colour slot can be **emissive**: the glow field in the colour picker,
from 0. The studio only marks it (☀ on the row); a game with lighting
reads it, one without ignores it.

## Chains: reaching with IK

Give a part an anchor (a hand, a foot), then **+ chain** in the Chains
panel: the chain runs from the part's parent to the part and reaches
with that anchor. **longer** adds the next parent; **bend** says which
way an elbow should fold when it could go either way. Every chain shows
a teal ring at its reach point: drag the ring and the chain's
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
