# How the studio speaks

The conventions the studio follows, so that everything added later lands
where a user of any other art tool expects it. Distilled from Figma and
Penpot (vector editing), Rive and Spine (2D rigging and animation),
Aseprite and Godot (game art), and the keyboard habits they share.

## The layout

The app opens on a **launcher**, a small window the way Xcode opens:
the mark and two ways in on the left (Create New Project, which makes a
folder with `assets/` inside; Open Existing Project), the recent
projects on the right. A project is a folder; opening one grows the
window into the **workspace**, an IDE split view with no top bar:

    ┌──────────┬───────────────────────────────────┬───────────────┐
    │ Assets + │ ▤ ? [project ⑂branch › asset ▾ › state ▾]  Save ◐ ▥ │
    │  effects ├───────────────────────────────────┤ inspector     │
    │  ships   │                                   │ (what is      │
    │  ...     │            canvas                 │  selected, or │
    │          │                                   │  the asset,   │
    │ ‹ fighter│         hint line                 │  or the       │
    │  layers  │       [ V R O L P | C # ]         │  project)     │
    │  states  ├───────────────────────────────────┤               │
    │  clips   │ timeline (when a clip is chosen)  │               │
    └──────────┴───────────────────────────────────┴───────────────┘

- **Left is the sidebar, a stack two deep.** At its root the project's
  assets as a tree of folders, with an Add menu (asset, 3D asset,
  palette, scene, 3D scene) and a refresh. Choosing an asset pushes its
  insides: the parts as a tree (children under parents) with eye and
  lock, then the states and the clips, the way Rive and Spine list
  animations; a scene pushes its nodes. The Add menu there adds a layer,
  a state, a clip. `‹` pops back to the assets; the asset stays on the
  canvas, lit in the tree.
- **The top of the canvas is the project bar**, Xcode's toolbar: the
  sidebar toggle, the docs, then the scheme bar. Its segments are the
  project (the folder's name; click for the shelf), the branch (shown
  only in a repository; click to switch), the asset (click for a quick
  switcher over every asset), the state (or the clip previewing; click
  to switch). At the far end: issues, Save, Ask, the theme, a more menu
  (serve, setup, close the project), the inspector toggle.
- **The tools float at the bottom centre of the canvas**, with the hint
  line above them and the zoom in the corner. Nothing else sits on the
  canvas.
- **With no asset open the canvas is the shelf**: every asset as a live
  thumbnail; click one to open it.
- **Right is properties**: the inspector shows the selection. A shape
  gets its numbers and its fill; a part gets its pivot, parent, anchors
  and IK chains; a pose gets offset, turn and size; nothing selected
  gets the document: name, colours, shared palettes, collision; nothing
  open gets the project. A part counts as selected when it was chosen
  on purpose (a row in the sidebar, a shape hit, a grip grabbed); a
  click on empty canvas lets go of everything and the inspector returns
  to the document.
- **Bottom is time**: only the timeline, and only when a clip is chosen.
- **Ask is a drawer, not a mode.** ⌘J slides Claude in on the right; it
  works through the same commands a hand does (one undo step per change,
  the canvas as its eyes) and never through the file system while a
  file is open.
- **The file on disk is the document.** Edits land in it at once, whole
  and atomic; ⌘S keeps a checkpoint (`name.fart~`) to revert to by
  choice, never by surprise. What a watcher sees is what the canvas shows.
- **Every view is a state.** There is no separate drawing mode: shapes
  are edited inside whichever state is on the canvas, through its pose,
  and the part is placed and turned by its own grips. A new state copies
  the current one. A clip is a *preview*: nothing edits there.
- **The canvas is the tool**: hover tells you what a click would do, the
  hint line at the bottom-left says what mode you are in.

## The words

The file's words and the studio's words are the same words. One
definition each, and the tooltips repeat them.

| word       | in the file     | what it is                                                  |
|------------|-----------------|-------------------------------------------------------------|
| shape      | `shapes[]`      | a circle, a line, a poly; paints one token                  |
| colour     | `palette[]`     | a named slot; shapes name slots, never colours. A palette file is a map of slots other files draw from |
| drawn like | `like`          | a part showing another's shapes and anchors, with its own pivot and pose (1.2) |
| mirror     | `mirror`        | a pose flag: flipped about the pivot before the turn (1.2)   |
| direction  | `angle` on an anchor | which way an attached thing points; anchors with one are sockets (1.2) |
| pin        | `targets`       | a point a chain keeps reaching while the pose changes (1.2)  |
| event      | `events` on a key | a name a game hears crossing the key (1.2)                  |
| curve      | `curve` on a key | a bezier toward the key, over the named ease (1.2)          |
| glow       | `emissive`      | light a slot gives off, for games that have light (1.2)      |
| path       | `path`          | a curve: vertices with tangent handles (1.7); the pen draws one, a poly is a path with none |
| part       | `parts[]`       | a layer with a pivot; the unit that poses; may ride a parent |
| pivot      | `pivot`         | the point a part turns about and is placed by               |
| anchor     | `anchors[]`     | a named point on a part a game or a chain reaches for       |
| parent     | `parent`        | the part this one rides                                     |
| state      | `states[]`      | a view of the parts: who shows, where each sits, in what order; the first one is the drawing |
| clip       | `clips[]`       | states in time: keys, eased                                 |
| chain      | `constraints[]` | parts in a row that IK turns to reach an anchor             |
| collision  | `collision[]`   | shapes a game may treat as solid; never drawn               |

"Layers" is the panel; "parts" are what it lists. A part is a layer
that can move, which is why it is not just called a layer.

A 3D file (`space: "3d"`, 1.3) opens in the **model screen**: the same
four regions, the canvas showing the model turned under a **view**. The
words gain a coordinate, not a vocabulary:

| word       | in the file     | what it is                                                  |
|------------|-----------------|-------------------------------------------------------------|
| box, ball, rod, prism | `mesh`, `ball`, `rod` | what the four drawing tools make: R drags a box, O a ball, L a rod, P clicks a prism's profile; each as deep as the **depth** field, along the view axis |
| corner     | `points[i]`     | a mesh's vertex; drags along the view plane                  |
| view       | (not saved)     | a turn laid on the model: front, back, left, right, top, bottom, or free after an orbit |
| orbit      |                 | drag on nothing, or Alt-drag anywhere                        |
| turn       | `rotate` `[x,y,z]` | a pose's turn about x, then y, then z; the lever turns about the view axis |
| morph      | `morph` on a state entry | a mesh's corners as this state has them (1.6); **Deform** (D) sends corner drags there instead of the base |
| smooth     | `smooth`, `normals`, `creases` | the cage drawn subdivided (1.7), lit by averaged normals; an edge's crease keeps it sharp |
| sweep      | `sweep`         | a solid from a profile (lathe, extrude), kept as the profile (1.7) |
| Project…   |                 | write the 2D views (`name-left.fart`, …) beside the model    |

Everything else is the editor's: states, clips, the pivot and lever,
the timeline, the inspector, undo, the file on disk as the document.

A scene (`.shart`, a Scene Hierarchy of Art) opens the **scene
screen**: the same regions, the canvas showing the placed files.

| word       | in the file     | what it is                                                  |
|------------|-----------------|-------------------------------------------------------------|
| node       | `nodes[]`       | a placed thing: an instance of a file, a scene placed whole, or a group |
| instance   | `ref` to a .fart | one file, placed; the same file placed twice is two instances |
| group      | a node with no `ref` | a frame for children, nothing drawn                    |
| shows      | `state` / `clip` + `t` | what an instance shows: a state, or a moment of a clip |
| hangs from | `attach`        | a child on a socket of its parent's art (`to`), by its own anchor (`by`) |
| palettes   | `palette_refs`, `palette` | laid over every instance, then over one          |

Nodes are chosen by clicking their art; they drag along the canvas (or
the view plane), nudge with arrows, raise and lower among siblings.

## The keys

Figma's letters, because everyone's hands already know them.

| key                     | does                                          |
|-------------------------|-----------------------------------------------|
| `V`                     | select                                        |
| `R` `O` `L` `P`         | rect, circle (O for ellipse), line, pen (click: corner, drag: curve) |
| `D`                     | deform: drags reshape the part in this state   |
| `C`                     | the collision lens                            |
| `Space` drag, `H`       | pan (hand)                                    |
| wheel, `Cmd` wheel      | pan, zoom about the cursor                    |
| `Cmd =` `Cmd -` `Cmd 0` | zoom in, out, 100%                            |
| `Shift 1` `Shift 2`     | zoom to fit, zoom to selection                |
| `Cmd '`                 | snap to grid on and off                       |
| arrows, `Shift` arrows  | nudge 1 unit, 10 units                        |
| `Cmd A` `Esc`           | select all, deselect / cancel                 |
| `Delete` `Backspace` `X`| delete                                        |
| `[` `]`                 | lower, raise                                  |
| `Cmd C` `V` `X` `D`     | copy, paste, cut, duplicate                   |
| `Alt` drag              | duplicate as you drag                         |
| `Shift` drag            | constrain: 45° lines, square rects, add to selection |
| `Alt` on a rect corner  | break it into a free quad                     |
| `Cmd Z` `Cmd Shift Z`   | undo, redo                                    |
| `Cmd S`                 | save (the checkpoint)                         |
| `Cmd N` `Cmd W`         | new asset, close the asset (the shelf)        |
| `Cmd Shift N` `Cmd Shift O` | new project, open project                 |
| `Cmd B` `Cmd Alt 0`     | the sidebar, the inspector                    |
| `Cmd Shift P` `Cmd Shift S` | switch asset, switch state               |
| `Cmd K`                 | every command, by name                        |
| `Enter` on a row        | rename inline                                 |
| `Space` with a clip     | play / pause                                  |
| `?`                     | the docs                                      |

Digits `1`–`5` still pick tools, for the hands that learned the classic.

## The rules

- **Everything is reachable three ways**: the menu bar, the command
  palette (`Cmd K`), and a key. The registry in `state/commands.ts` is the
  one list; the others read it.
- **Rename inline**, never in a dialog. Double-click or `Enter` on a row.
  New things get a name and are already being renamed.
- **Numbers are fields.** Anything with a value shows the value and takes
  a typed one. Sliders only where the range is the point (colour channels).
- **Live, always.** A change shows as it happens and reaches disk a beat
  later; Save is a checkpoint, not a commit dialog. No apply buttons.
- **Hover foretells.** What a click would pick is outlined before the click.
- **Snap, with a way out.** Grid snap is a toggle; geometry snap (to other
  shapes' points) is on, with `Cmd` held to defeat it for one gesture.
- **Right-click is the short list**: the four things you do most to that
  thing. The long list is `Cmd K`.
- **Modes are visible.** A state, a clip preview, the collision lens:
  the hint line names which, the toolbar dims what does not apply.
- **No settings screen.** Theme, sidebar, inspector, snap are toggles where they
  act. If a preference needs a screen, it is probably a bad preference.
