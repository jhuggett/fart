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

## The editor

- **Toolbar**: Select (1) and the Add menu — circle (2), line (3), poly
  (4), rect (5) — then Save, Undo, Redo, Browse, Collision, Docs.
- **Canvas**: the tool is what a click does. Right-drag (or middle-drag)
  pans; scrolling pans; Cmd/Ctrl+scroll or a trackpad pinch zooms about
  the cursor. With Select, hovering outlines what a click would pick; a
  selected shape shows drag handles (circle radius, line ends, every
  polygon vertex) and dragging its body moves it. X deletes.
- A **rect** keeps itself rectangular when you drag a corner — its
  neighbours follow; hold Alt to break it into a free quad.
- **Shift-click** adds to or removes from the selection; dragging on
  empty ground sweeps a rubber band over many shapes at once. A crowd
  moves, deletes, paints, re-parts, and raises/lowers together — it
  drifts through the stack keeping its internal order.
- **Scaling**: a selection grows a box whose corner grips scale it about
  the opposite corner.
- **Poly**: click to add points; click the first point again, or press
  Enter, to close it. Esc drops it.

## Palette (left)

Click a token to make it current — and to paint it onto the selection,
if there is one. The sliders below edit the current token's RGBA live.
Tokens arriving from shared palettes (`palette_refs`) are listed under
**Shared**, read-only: paint with them here, edit them in their own file.
Double-click a token to rename it; shapes follow. Colors are never
literal: a shape names a token, the palette says what that means today.

## Selected (left, below)

Kind, token, part; a width slider for lines; raise and lower through the
part's stacking order (also `]` and `[`); delete; and **to part**, which
moves the selection into the current part.

## Parts (right)

Parts are the layers. They paint top to bottom, so a lower row paints
over the ones above; the ˄ ˅ buttons on the current row reorder them and
× deletes one (its shapes go with it; states drop the name). New shapes
land in the current part. **Set pivot** and **Add anchor** arm a
crosshair: the next canvas click places it. The pivot is the point a
runtime rotates about and places; anchors are named points it may ask
for (a grip, a muzzle, a hinge). When a state is selected, each part row
grows a checkbox: membership.

## Rigs: parents

A part may have a **parent** (the select under the parts list). A child
is posed in its parent's frame, so moving or turning the torso carries
the head and the arms with it, and their own state entries stay at rest.
Nothing changes at rest: parents only matter once something moves. In
pose mode the rig shows as dashed bones from each pivot to its parent's.
Paint order is still the state's list; parents are about motion, not
layering.

## States (right, below): pose mode

Click a state and the canvas shows it with its transforms applied — and
switches from editing geometry to posing parts. Drag a part to place it
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

Cmd+C / Cmd+V copy and paste the selection; Cmd+X cuts; Cmd+D duplicates
in place. Pasted shapes land in the part they were copied from (matched
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
