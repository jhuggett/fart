# How the studio speaks

The conventions the studio follows, so that everything added later lands
where a user of any other art tool expects it. Distilled from Figma and
Penpot (vector editing), Rive and Spine (2D rigging and animation),
Aseprite and Godot (game art), and the keyboard habits they share.

## The layout

Four regions, like Rive and Spine and Figma:

    ┌──────────────────────────────────────────────────────────────┐
    │ tools · file                                       docs ◐    │
    ├──────────┬───────────────────────────────────┬───────────────┤
    │ explorer │                                   │ inspector     │
    │ layers   │            canvas                 │ (what is      │
    │ states   │                                   │  selected)    │
    │ clips    ├───────────────────────────────────┤               │
    │          │ timeline (when a clip is chosen)  │               │
    └──────────┴───────────────────────────────────┴───────────────┘

- **Left is structure**: the files of the project, then the parts of the
  open file as a tree (children under parents) with eye and lock, then
  the states and the clips, the way Rive and Spine list animations.
- **Right is properties**: the inspector shows the selection. A shape
  gets its numbers and its fill; a part gets its pivot, parent, anchors
  and IK chains; a pose gets offset, turn and size; nothing selected
  gets the document: name, palette, collision.
- **Bottom is time**: only the timeline, and only when a clip is chosen.
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
| token      | `palette[]`     | a named colour; shapes name tokens, never colours           |
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

## The keys

Figma's letters, because everyone's hands already know them.

| key                     | does                                          |
|-------------------------|-----------------------------------------------|
| `V`                     | select                                        |
| `R` `O` `L` `P`         | rect, circle (O for ellipse), line, poly       |
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
| `Cmd N` `Cmd O` `Cmd Shift O` | new file, the shelf, open folder        |
| `Cmd B`                 | the explorer                                  |
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
- **No settings screen.** Theme, explorer, snap are toggles where they
  act. If a preference needs a screen, it is probably a bad preference.
