# Fast Art Format (.fart) — v1

JSON-backed vector art for games. The format is the contract: any editor
that writes it and any engine that reads it agree through this document
alone. Scope: describing drawable, recolorable, re-posable 2D art. Nothing
else — no scenes, no logic, no engine data (that's what `meta` is for).

It is called `.fart` on purpose. The format does not take itself
seriously so that you don't have to: it is plain JSON, small enough to
read, write, and diff by hand (or by a language model), and it drops into
any engine that can parse JSON. Prototype with it. Ship with it if you
like. Nobody is going to stop you either way.

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

- Flat: parts contain shapes only (`children` is reserved, deliberately
  unused — sub-articulation belongs to runtimes).
- `pivot` is in document space: the point the runtime rotates about and
  places.
- `anchors`: named document-space points runtimes may query (grips,
  muzzles, flames, hinges).

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

## Color at runtime

Tokens are the recolor surface. Engines may override token colors wholesale
(themes), or tint resolved colors (damage flashes, lighting) — both outside
the format. The format promises only: shapes name tokens, palettes resolve
them, resolution order is specified above.

## Collision (optional)

A doc may carry a `collision` array of ordinary shapes -- same kinds,
same document space, no `color` required. They are never drawn; an
engine that cares reads them and treats them as solid however it likes.

```json
"collision": [
  {"kind": "line", "a": [-3, 0], "b": [3, 0], "w": 12}
]
```

- A **line with width is a capsule** (the natural furniture shape); a
  **circle** is a circle; a **poly** is a convex-ish region.
- Collision does not pose: it is rest-space, state-independent. Doors
  and other state-dependent solids stay engine-owned for now.
- Loaders that predate this field ignore it; the version stays 1.

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
| `dup.part` `dup.state` `dup.token` | siblings sharing a name                   |
| `path`      | an absolute `palette_ref`                                        |

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

## Reserved for later

Names the format has plans for. Version-1 files may not use them for
anything else; validators warn when they appear.

- `children` on a part: sub-articulation, if it ever moves into the file.
- `clips` at the top level: animation -- keyframes over states and poses.
- `constraints` at the top level: inverse kinematics chains referencing
  parts and anchors.
- `space` at the top level: `"2d"` is the only value and the default; a
  three-dimensional Fast Art would be a new major, but the key is spoken
  for.
- Shape kinds `ring` and `path`.
