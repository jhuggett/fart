# Fast Art Format (.fart) — v1.5

JSON-backed vector art for games. The format is the contract: any editor
that writes it and any engine that reads it agree through this document
alone. Scope: describing drawable, recolorable, re-posable art, flat or
(since 1.3) low-poly solid. Nothing else — no scenes, no logic, no engine
data (that's what `meta` is for).

The format is expressed in JSON. It is intended to be authored by hand
or by program, to be read and compared without tooling, and to be
interpreted by any runtime capable of parsing JSON. It is suitable for
prototyping and for shipped work alike; the specification draws no
distinction between the two.

The machine-readable half of this document is `fart.schema.json` beside
it, and the conformance corpus in `examples/` (see **Validation**).

## Conventions

- Coordinates: **y-down, x-right**. Units are the project's world units;
  the format doesn't interpret them.
- Art is authored **assembled, in document space**: the file at rest looks
  like the thing. Runtimes re-pose *parts* by rotating about their pivot
  and translating the pivot wherever they like. Animation is the runtime's
  job; the format supplies anatomy.
- All documents carry `"version": 1`. Readers must reject newer majors
  (and a document with no version, or a non-integer one).
- Unknown fields must be preserved by editors and ignored by loaders.
- Names (`name`, `part`, `color`) are non-empty strings, unique among
  their siblings: two parts, two states, or two local tokens may not share
  a name.

## Documents

Two kinds, distinguished by content, same extension:

- **Art file**: `parts` (+ optional `states`, `palette`, `palette_refs`).
- **Palette file**: `palette` only. Referenced by art files, shareable
  across a whole project (or several).

## Top-level

```json
{
  "version": 1,
  "name": "chest",
  "palette_refs": ["../palettes/base.fart"],
  "palette": [ {"name": "clasp", "rgb": [170,150,90,255]} ],
  "parts": [ ... ],
  "states": [ ... ],
  "meta": { }
}
```

- `palette_refs`: relative paths from this file, resolved in order.
- Token lookup order: this file's `palette` first, then `palette_refs`
  from last to first. Unresolvable tokens render loud magenta.
- Token entries are objects so later fields (e.g. `emissive`) are additive.
- `space` (1.3): `"2d"` (the default when absent) or `"3d"`. Everything
  in this document up to **Space: 3D** describes the 2D document; a 3D
  document is the same words with a third coordinate, and that section
  says exactly where they differ. A reader refuses a space it does not
  know (error `space`).

## Shapes

Order within a part = paint order.

```json
{"kind": "circle", "color": "wood",  "at": [0,0], "r": 3.2}
{"kind": "line",   "color": "steel", "a": [0,0], "b": [8,0], "w": 1.4}
{"kind": "poly",   "color": "wood",  "points": [[...]], "tris": [0,1,2, 0,2,3]}
```

- `circle` needs `at` and `r`; `line` needs `a`, `b` and `w`; `poly`
  needs at least three `points`. A drawn shape (one inside a part) always
  names a `color`; a collision shape may leave it out.
- `line` has round caps, width `w`.
- `poly` may be concave. **Editors bake `tris`** (index triples into
  `points`) on save so loaders can be dumb; loaders MAY fan untriangulated
  polys at their own risk. When present, `tris` is a multiple of three
  indices, each one a valid index into `points`.
- Reserved kinds for future versions: `ring`, `path`. A version-1 reader
  rejects them; they are not "unknown", they are spoken for.

### Shade (1.3)

```json
{"kind": "poly", "color": "steel", "shade": 0.72, "points": [[...]]}
```

A shape may carry `shade`, a number from 0 (absent = 1): the resolved
colour's red, green and blue are multiplied by it and clamped, alpha is
left alone. The token is still the recolor surface (a swap recolours a
shaded shape along with the rest), shade is the lighting painted on top:
the lit face and the shadowed face of one steel barrel name the same
token. Projections (below) write it; hands may too. A reader that
predates 1.3 draws flat.

## Parts

```json
{
  "name": "lid",
  "pivot": [0,-6],
  "shapes": [ ... ],
  "anchors": [ {"name": "hinge", "at": [0,-6]} ],
  "meta": { }
}
```

- Parts contain shapes only; a part never contains parts. Since 1.1 a
  part may name a `parent` instead (below), which is the articulation.
- `pivot` is in document space: the point the runtime rotates about and
  places.
- `anchors`: named document-space points runtimes may query (grips,
  muzzles, flames, hinges).

### Parents (1.1)

```json
{"name": "fore_l", "parent": "upper_l", "pivot": [6, 2], "shapes": [ ... ]}
```

A part with a `parent` is posed **in its parent's frame**: its own pose
(offset, rotate, scale) places it as if the parent were at rest, and the
parent's pose then carries it along. Writing a part's pose as the affine
map

    L(part) = translate(offset) · rotate(rotate) · scale(scale) · translate(-pivot)

the world transform is `W(part) = W(parent) · L(part)`, and `W = L` for a
part without a parent. Consequences:

- At rest (every pose identity) the file draws exactly as authored, parents
  or not. Parents only matter once something moves.
- A child's `offset` is where its pivot lands **in the parent's rest
  space**; absent, it is the pivot itself, as ever. Move the torso and the
  arm comes along without the arm's state entry changing at all.
- Paint order is untouched: a state's list (or file order) still decides
  who paints over whom. Parents are about motion, not layering.
- A parent that a state leaves out contributes identity: the child draws as
  if its parent were at rest.
- The parent must exist; chains of parents must not loop.

A reader that predates 1.1 ignores `parent` and poses every part on its
own, so a file that leans on parents looks right at rest and wrong in
motion there. That is the one place a minor version changes a picture,
and it is the point of the version.

## States

Named part-lists. **State order is paint order** (a lid may layer
differently open vs closed). Entries are objects; `offset`/`rotate`/
`scale` optionally re-pose the part relative to its rest placement, so one
drawing serves many poses:

```json
{
  "name": "open",
  "parts": [
    {"part": "box"},
    {"part": "lid", "rotate": 2.6, "offset": [0,-3]},
    {"part": "clasp"}
  ]
}
```

- `offset` is **where the part's pivot lands**, in document space -- a
  position, not a delta. Absent, it means the pivot itself: the rest
  placement. (`{"part": "box"}` draws the box exactly where it was
  authored; `{"part": "box", "offset": [0, 0]}` drags its pivot to the
  origin.) Editors write it explicitly; hand-written files may leave it
  out.
- `rotate` in radians about the pivot; absent = 0. `scale` multiplies
  about the pivot; 0 or absent = 1.
- A state's `parts` list may be empty (nothing drawn), and every entry
  must name a part the document has.
- A runtime asked for an unknown state should draw all parts in file order.

## Clips (1.1)

Animation is states in time. A clip is a named list of keys, each at a
time in seconds, each naming a state (or carrying an inline part list
shaped exactly like a state's `parts`):

```json
"clips": [
  {"name": "open", "loop": false, "keys": [
    {"t": 0.0, "state": "closed"},
    {"t": 0.4, "state": "open", "ease": "out"}
  ]}
]
```

- `keys` are in non-decreasing `t`, at least one of them. Each key has
  exactly one of `state` (a name the document has) or `parts`.
- Between two keys, a runtime interpolates each part's pose: `offset` and
  `scale` linearly, `rotate` the short way round. The fraction is eased by
  the **incoming** key's `ease`: `linear` (the default), `in`, `out`,
  `in-out`, or `step` (hold the outgoing key until the incoming one).
- Which parts are drawn, and in what order, comes from the outgoing key
  until time reaches the incoming key: membership and paint order switch
  at keys, they do not tween. A part in the outgoing key but not the
  incoming one holds its pose.
- Before the first key the first key holds; after the last, the last.
  With `loop`, time wraps at the last key's `t` (a loop that should ease
  back to its start ends with a key equal to its first).
- Sampling a clip at a time yields a part list shaped like a state's:
  draw it the way you draw a state. Nothing else in the format changes;
  a clip is a state factory.

## Constraints (1.1)

Inverse kinematics, declared so a runtime may solve it live (feet on a
slope, a hand on a ledge). An editor also uses chains as a posing tool,
and the result of that is ordinary states; games only need this section
when they solve at runtime.

```json
"constraints": [
  {"name": "arm_l", "chain": ["upper_l", "fore_l"], "end": "fore_l/hand", "bend": 1}
]
```

- `chain` lists parts root-first; each part after the first has the
  previous as its `parent`. The joints are the parts' pivots; the last
  bone runs from the last pivot to `end`.
- `end` is `part/anchor`: an anchor on the chain's last part.
- `bend` (optional, `1` or `-1`) is the preferred elbow direction where a
  solution is ambiguous.
- Solving means: given a target point in document space and a state,
  adjust the chain parts' `rotate` so the end anchor reaches the target,
  leaving everything else in the state alone. The reference solver is
  cyclic coordinate descent; any solver that reaches the same point is
  conforming.

## Mirror and reuse (1.2)

```json
{"name": "claw_r", "pivot": [5, 0], "shapes": [ ... ], "anchors": [ {"name": "tip", "at": [9, 0]} ]},
{"name": "claw_l", "like": "claw_r", "parent": "body", "pivot": [5, 0]}
```
```json
{"part": "claw_l", "mirror": true, "offset": [-5, 0]}
```

- A part with `like` draws another part's `shapes` and `anchors`, and
  has none of its own (a validator refuses a `like` part carrying
  either). It keeps its own `name`, `pivot`, `parent` and pose, so one
  claw's geometry serves both sides. `like` does not chain: the source
  draws its own geometry. A reader that predates 1.2 draws the part
  empty.
- `mirror` on a state entry flips the part left-to-right about its
  pivot, before the turn, so a mirrored part still turns the way its
  parent does:

      L(part) = translate(offset) · rotate(rotate) · scale(scale) · mirror · translate(-pivot)

  with `mirror` reflecting x across the pivot. It does not tween: between
  keys the outgoing key's flip holds. A solver adjusting rotations under
  a mirrored ancestor turns the other way (the parent's frame is
  reflected), which is the solver's business, not the author's.

## Sockets: anchors with a direction (1.2)

```json
"anchors": [ {"name": "hand", "at": [12, 1], "angle": -0.4} ]
```

An anchor may carry an `angle` (radians, in the part's rest space): the
direction an attached thing points. Attaching one document to another is
a runtime operation the format only makes exact: to put an item's anchor
(a sword's `grip`) onto a host's (a hand), align the positions and, where
both have an `angle`, the directions:

    attach = W(host part) · translate(host.at) · rotate(host.angle − item.angle) · translate(−item.at)

and draw the item's rest space through it. Which item sits in which hand
is game state, so files never name each other for this.

## IK targets (1.2)

```json
{"name": "reach", "parts": [ ... ], "targets": [ {"chain": "arm_l", "at": [14, -2]} ]}
```

A state, or a clip key, may carry `targets`: chains and the document-space
points they reach. The chain parts' rotations in the pose are the solved
result as of saving, so a reader that does not solve draws the right
thing; an editor re-solves whenever the pose changes (the hand stays on
the latch while the torso moves), and a runtime that solves live does so
after sampling. Between keys, a target both keys name tweens linearly and
the solve follows; a chain only the outgoing key targets holds its point.

## Events (1.2)

```json
{"t": 0.3, "state": "plant", "events": ["footstep"]}
```

A key may carry `events`, names a runtime hears when the playhead crosses
the key's time going forward: the footstep, the hit frame of a swing.
Reading events from t0 to t1 yields the events of keys with a time in
(t0, t1]; on a loop the interval wraps, and the wrap key itself (the last
one) never fires, since the first key at 0 stands for it.

## Curves (1.2)

```json
{"t": 0.4, "state": "open", "ease": "out", "curve": [0.34, 1.56, 0.64, 1]}
```

A key may carry a `curve`: a cubic bezier's two control points, [x1, y1,
x2, y2] with x within 0..1 (the CSS `cubic-bezier` form), bending the
fraction of time toward this key. Where present it wins over `ease`;
authors set `ease` to the nearest name anyway, so a reader that predates
1.2 stays close.

## Emissive tokens (1.2)

```json
{"name": "flame", "rgb": [255, 140, 50, 255], "emissive": 1.5}
```

A palette token may carry `emissive`, a number from 0: how much light the
slot gives off. The format says nothing about what light is; a game with
lighting reads it, one without ignores it.

## Blending and layering (1.2)

Clips sample to pose lists, and two pose lists combine. The format
defines the two operations so every runtime agrees, and neither needs
anything new in a file:

- `blend(a, b, w)`: every part in both lists tweens by `w` (`offset` and
  `scale` linearly, `rotate` the short way round); which parts draw, and
  in what order, comes from `a` while `w` is below 0.5 and from `b`
  after. A crossfade between two clips is a blend with a ramping `w`.
- `layer(base, over, w)`: parts `over` names tween from their base pose
  toward the layer's by `w`; every other part keeps the base pose; the
  base's order stands, and a part only the layer has joins the end once
  `w` reaches 0.5. A head turn over a gait is a layer; a flinch is a
  layer whose weight rises and falls.

`mirror` and targets come from the leading side of a blend and from the
base of a layer. Additive layers (a delta on top of any pose) are not
defined yet; a layer with a weight envelope covers the common cases.

## Space: 3D (1.3)

```json
{"version": 1, "space": "3d", "name": "pistol", "parts": [ ... ], "states": [ ... ]}
```

A document with `"space": "3d"` describes a low-poly solid the same way
a 2D document describes a drawing: parts with pivots and parents,
shapes that each paint one token, states and clips that pose them. It is
authoring-side first (model once, project to any 2D view; see
`PROJECT.md`), and a game with a 3D renderer may load it directly.

- Coordinates: **x-right, y-down, z-away** (into the picture), a
  right-handed frame. Dropping z from a 3D document at rest gives its
  front view: the file at rest still looks like the thing, from the front.
- Every point that was `[x, y]` is `[x, y, z]`: shape geometry, `pivot`,
  anchor `at`, pose `offset`. A 2D reader that predates 1.3 refuses a 3D
  document at the schema stage, which is the right outcome.
- Shapes are `mesh`, `ball` and `rod`; `circle`, `line` and `poly` do not
  occur in a 3D document (a mesh face is what a poly becomes):

```json
{"kind": "mesh", "color": "wood",  "points": [[0,0,0], ...], "faces": [[0,1,2,3], [4,5,6,7], ...], "tris": [0,1,2, 0,2,3, ...]}
{"kind": "ball", "color": "brass", "at": [0,0,0], "r": 1.2}
{"kind": "rod",  "color": "steel", "a": [0,0,0], "b": [8,0,0], "w": 0.6}
```

  - `mesh`: `points` (three or more) and `faces`, each face a list of
    three or more indices into `points`, planar, wound so that
    `(p1 − p0) × (p2 − p0)` points **outward**. A face may be concave.
    **Editors bake `tris`** (index triples into `points`, every face
    fanned or ear-clipped) on save so renderers can be dumb; `tris` is
    optional in a hand-written file. Error `face` covers a face with
    fewer than three indices or an index past the last point; `tris`
    covers the triples as in 2D.
  - `ball`: a sphere at `at` with radius `r`. `rod`: a round-capped
    cylinder from `a` to `b`, width `w`. Both project to exactly the
    circle and the line a 2D reader draws.
  - `shade` applies as in 2D.
- Anchors carry `at` and, for a socket, `dir`: a direction vector in the
  part's rest space (unit length is the convention; readers normalise).
  `angle` has no meaning in 3D.
- A pose's `rotate` is `[x, y, z]`: radians about the pivot, applied as
  a turn about x, then y, then z, in the parent's rest frame. Each turn
  is right-handed about its axis, so a turn about z is the 2D `rotate`
  exactly (`x' = x cos θ − y sin θ`, `y' = x sin θ + y cos θ`). Absent
  is `[0, 0, 0]`. `scale` stays one number; `mirror` reflects x across the
  pivot before the turn, as in 2D. The local map is

      L(part) = translate(offset) · Rz · Ry · Rx · scale · mirror · translate(−pivot)

  and `W(part) = W(parent) · L(part)` as ever.
- Tweening (clips, blending, layering): `offset` and `scale` linearly;
  `rotate` **as a rotation**, the short way round: both keys' turns
  become quaternions (`q = qz · qy · qx`), the pair is brought to a
  positive dot product, and the frame is their spherical interpolation.
  A reader that lerps Euler angles instead is wrong past small turns.
- Attaching: positions matched and, where both anchors have a `dir`,
  the item turned by the shortest rotation taking its `dir` onto the
  host's. Roll is left alone.
- A state's list is membership; in 3D, depth decides what paints over
  what, so the order carries no meaning (readers keep it anyway, and the
  projection sorts by depth). `like` keeps a part's geometry shared.
- Chains and targets work as in 2D with a third axis: a constraint's
  `chain`, `end` and errors are the same; `bend` has no meaning in 3D
  and an optional `pole` (`[x, y, z]`, document space) is a point the
  first elbow leans toward, since a bent chain in space may swivel
  freely about its root-to-end line. A target's `at` is `[x, y, z]`.
  The reference solver is cyclic coordinate descent: each joint, end
  first, turns about the axis `(joint → end) × (joint → target)` by the
  angle between them, in its parent's frame; then, with a pole, the root
  swings the chain about the root-to-end line until the elbow lies
  toward the pole. Any solver that reaches the same point conforms.
  Everything else (`like`, `mirror`, clips, `events`, `curve`,
  `emissive`, `collision` with the 3D kinds, `palette_refs`) means what
  it means in 2D.
- Nothing here changes a 2D document: a 2D file is a 1.2 file, byte for
  byte, unless it uses `shade`.

## Textures (1.5)

A texture is a set of **maps**, and every map is a drawing: a 2D Fast
Art file tiled over a cell. There are no bitmaps in the format. The
colour map is what a reader paints; every other map (`height`, `glow`,
`rough`, whatever a game invents) is a scalar field the format carries
and the engine reads, the way it carries `layer` on collision.

```json
"textures": [
  {"name": "planks", "cell": [8, 8], "maps": {
    "color":  {"ref": "textures/planks.fart"},
    "height": {"ref": "textures/planks.fart", "palette": "palettes/height.fart", "mode": "mask"},
    "glow":   {"ref": "textures/planks.fart", "state": "knots"}
  }}
]
```

- `cell` is `[w, h]` in the map drawings' own units: the tile is the
  rectangle from `[0, 0]` to `[w, h]` of each map's document space, and
  the drawing repeats with that period. **Pattern coordinates** are that
  document space.
- A map names a `ref`: a relative path (as `palette_refs` are) to a 2D
  art file. Its tokens resolve through that file's own palette and refs;
  a `palette` (a relative path to a palette file) is then laid over
  them, as a swap. A `state` picks which of the drawing's states to
  draw; absent, its first state, or every part in file order. Since
  one drawing under two palettes is two maps, maps of one texture line
  up for free.
- `mode` is `paint` (the default) or `mask`. Read as **colour**, a
  `paint` map's resolved colour lies over the shape's token where it
  paints, and the token shows where it does not; a `mask` map
  multiplies the token by its **value**. Read as a **scalar**, a map's
  value at a point is the painted colour's luminance
  (`0.2126 r + 0.7152 g + 0.0722 b`, over 255) times its alpha times the
  shape's `shade`, and 0 where nothing is painted. `shade` on the
  textured shape multiplies the colour last, as ever.
- A texture's `name` is unique among textures (`dup.texture`); a shape
  that names a texture the document lacks is `ref.texture`; a map's ref
  must be relative (`path`); a texture has at least one map (`schema`).
  A ref that cannot be read is the `unresolved` warning, like a palette.

A shape takes a texture by name, with a **mapping** from pattern
coordinates to its own space:

```json
{"kind": "poly", "color": "wood", "texture": "planks", "mapping": {"at": [4, 0], "angle": 0.2, "scale": 1.5}, "points": [...]}
{"kind": "mesh", "color": "wood", "texture": "planks", "mapping": {"scale": 2}, "points": [...], "faces": [...]}
```

- **2D**: `mapping` is `{at, angle, scale}` (pattern space placed with
  its origin at `at`, turned by `angle`, scaled by `scale`; all
  optional, identity by default) or `{xf}`, the affine map from pattern
  coordinates to document space as six numbers `[a, b, c, d, e, f]`
  (`x' = a x + c y + e`, `y' = b x + d y + f`), which is what a projector
  writes. A circle or a line is filled by the pattern over its area like
  a poly.
- **3D**: `mapping` is `{scale, uvs}`, both optional. Without `uvs` a
  mesh is **box mapped**: each face takes pattern coordinates from the
  two axes across its dominant normal, in world units over `scale`
  (default 1): a face facing ±x reads `(z, y)`, ±y reads `(x, z)`,
  ±z reads `(x, y)`. So planks line up across a wall with nothing
  authored. `uvs` are explicit pattern coordinates per face and corner,
  `uvs[face][corner]`, one pair per point of that face. A ball or a rod
  is box mapped as the mesh it flattens to. A face's mapping reaches
  its projection as a 2D `xf` (see `PROJECT.md`).
- A part drawn `like` another has its source's textures.
- Loaders hand a renderer the pattern coordinates per corner and the
  texture's name; rasterising a map is a drawing job (the reference
  loaders do it in fifty lines, and `fart bake --textures` writes the
  pixels for a build). Readers that predate 1.5 draw the shape's token
  flat and keep the fields.

## Color at runtime

Tokens are the recolor surface: a file's palette is its set of colour
slots, and a palette file is a map from slot names to colours. Engines
may lay a palette over a document at load time (a *swap*: same names take
the new colour, new names join, so one slime file is the red one and the
blue one), or tint resolved colors (damage flashes, lighting) — both
outside the format. The reference loaders offer the swap as
`applyPalette` / `apply_palette`. The format promises only: shapes name
tokens, palettes resolve them, resolution order is specified above.

## Collision (optional)

A doc may carry a `collision` array of shapes -- the document's kinds,
no `color` required. They are never drawn; an engine that cares reads
them and treats them as solid however it likes.

```json
"collision": [
  {"kind": "line", "a": [-3, 0], "b": [3, 0], "w": 12},
  {"kind": "box", "at": [0, 4, 0], "size": [8, 2, 8], "layer": "surface"},
  {"kind": "mesh", "part": "flap", "points": [...], "faces": [...]}
]
```

- A **line with width is a capsule** (the natural furniture shape); a
  **circle** is a circle; a **poly** is a convex region. In a 3D document
  a `rod` is a capsule, a `ball` a sphere, a `mesh` a **convex** solid,
  and a `box` (collision only, 1.4) is `at` its centre with `size` the
  full extents and an optional `rotate` (`[x, y, z]`, applied as a
  pose's turn). A validator checks a collision `mesh` is convex: every
  point on or behind the plane of every face (error `convex`, naming
  the face). A concave solid is authored as several convex pieces, or
  as a `box` and a few balls; `fart hull` derives a convex hull from a
  part's visible shapes. A `box` inside a part's `shapes` is refused
  (`schema`): it is not a drawn kind.
- **Posed collision (1.4)**: a collision shape may name a `part`. It is
  then authored in that part's rest space, like the part's own shapes,
  and rides the part's world transform under any state or clip:
  `W(part) = W(parent) · L(part)`, mirror, scale and parents included;
  a ball's radius and a rod's width scale with the part. A shape
  without `part` is document space, at rest, whatever the pose. A part
  drawn `like` another carries the collision shapes that name its
  source, in its own place. A `part` that names no part is `ref.part`.
  This holds in 2D documents too. The reference loaders turn the whole
  list into document-space colliders for a pose list (`collisionWorld`,
  `collision_world_3d`), boxes expanded to eight-point, six-face meshes
  so a consumer sees only balls, rods and meshes (circles, lines and
  polys in 2D).
- **Layers (1.4)**: a collision shape may carry a `layer`, a non-empty
  string an engine reads and the format does not interpret; absent
  means `"solid"`. A game's own words: `solid`, `surface`, `player`,
  `trigger`.
- A generated hull carries `"meta": {"hull": true}` so a tool can
  replace it; `meta` on a collision shape is otherwise yours.
- Loaders that predate this field ignore it, and loaders that predate
  1.4 read every collision shape as document space and at rest; the
  version stays 1.

## Validation

`fart.schema.json` (JSON Schema, draft 2020-12) checks structure. It
cannot see across a document, so a validator adds the rest: every `color`
resolves to a token (locally or through `palette_refs`), every state
entry names a real part, `tris` index the points, names are unique, refs
are relative. `packages/core` implements both halves and a command line:

    fart validate path/to/art      # every .fart below, refs resolved

`examples/manifest.json` is the conformance corpus: files that must load,
files that must be refused, and the **error code** each refusal carries.
The codes are part of the contract so that a "why won't this load" reads
the same from any tool:

| code        | meaning                                                          |
|-------------|------------------------------------------------------------------|
| `json`      | not JSON                                                         |
| `version`   | version missing, not an integer, or newer than 1                 |
| `schema`    | structure the schema rejects (a missing field, a reserved kind)  |
| `ref.token` | a shape names a token nothing supplies                           |
| `ref.part`  | a state names a part the document does not have                  |
| `tris`      | tris are not triples, or an index is out of range                |
| `dup.part` `dup.state` `dup.token` `dup.clip` `dup.constraint` | siblings sharing a name |
| `path`      | an absolute `palette_ref`                                        |
| `ref.parent` | a part names a parent the document does not have               |
| `cycle`     | parents that loop                                                |
| `clip`      | keys empty, out of order, or a key with neither/both of `state` and `parts` |
| `ref.state` | a clip key names a state the document does not have              |
| `chain`     | a constraint's chain is empty, or its parts are not parented in order |
| `ref.anchor` | a constraint's `end` is not `part/anchor` on the chain's last part |
| `like`      | a part is like itself, like a part that is itself like another, or carries its own shapes or anchors |
| `ref.chain` | a target names a constraint the document does not have           |
| `space`     | a space the reader does not know (1.3)                          |
| `convex`    | a collision mesh is not convex: a point lies in front of the named face (1.4) |
| `ref.texture` | a shape names a texture the document does not have (1.5)       |
| `dup.texture` | two textures share a name (1.5)                                |
| `face`      | a mesh face with fewer than three indices, or an index past the last point (1.3) |

Warnings (`unknown`, `reserved`, `unresolved`) never fail a file. A loader
inside a game may be as lenient as it likes past `json` and `version`;
the corpus only requires it to load every valid file and refuse those two.

## Versioning

`version` is the format's **major**, and the only number a file carries.

- Within a major, changes are additive: new optional fields, new
  top-level sections. Older readers ignore what they don't know (and skip
  shapes whose `kind` they don't know), older editors preserve it. A file
  written by a newer tool still loads in an older one, minus the news.
- Meaning never changes within a major. A field that must mean something
  different, or a required field, is a new major -- and readers refuse
  majors they don't know, loudly, rather than drawing them wrong.
- The schema and the corpus are versioned with the format: this file,
  `fart.schema.json` and `examples/` describe version 1 and are tagged
  `format-v1.x.y` together. A patch bump clarifies wording; a minor bump
  adds a field.
- 1.1 added `parent` on parts, `clips`, and `constraints`. Files that use
  none of them are byte-for-byte 1.0 files.
- 1.2 added `like` on parts, `mirror` on state entries, `angle` on
  anchors, `targets` on states and keys, `events` and `curve` on keys,
  `emissive` on tokens, and defined blending, layering and attaching for
  runtimes. Every one is optional; a 1.1 reader draws a `like` part empty
  and eases by name, and is otherwise right.
- 1.3 added `shade` on shapes, and `space: "3d"`: 3D documents with
  `mesh`, `ball` and `rod` shapes, three-coordinate points, `[x, y, z]`
  turns, `dir` on anchors and `pole` on chains, plus `PROJECT.md`, the
  rules that turn a 3D document into 2D ones. A 2D file without `shade`
  is a 1.2 file; a 1.2 reader draws `shade` flat and refuses a 3D file
  at the schema stage.
- 1.4 added collision that poses (`part` on a collision shape), the
  collision-only `box` kind, `layer` on collision shapes, and the rule
  that a collision `mesh` is convex (error `convex`). A file that uses
  none of them is a 1.3 file; a 1.3 reader reads posed collision at
  rest and refuses a `box` at the schema stage.
- 1.5 added `textures` (maps that are drawings, tiled over a cell) and
  `texture` + `mapping` on shapes. A file without them is a 1.4 file; a
  1.4 reader draws textured shapes flat.

## Reserved for later

Names the format has plans for. Version-1 files may not use them for
anything else; validators warn when they appear.

- `children` on a part: nesting, should `parent` ever prove the wrong way
  round.
- (`space` stopped being reserved in 1.3.)
- Shape kinds `ring` and `path`.
