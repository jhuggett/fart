# Fast Art Format (.fart) — v1

JSON-backed vector art for games. The format is the contract: any editor
that writes it and any engine that reads it agree through this document
alone. Scope: describing drawable, recolorable, re-posable 2D art. Nothing
else — no scenes, no logic, no engine data (that's what `meta` is for).

## Conventions

- Coordinates: **y-down, x-right**. Units are the project's world units;
  the format doesn't interpret them.
- Art is authored **assembled, in document space**: the file at rest looks
  like the thing. Runtimes re-pose *parts* by rotating about their pivot
  and translating the pivot wherever they like. Animation is the runtime's
  job; the format supplies anatomy.
- All documents carry `"version": 1`. Readers must reject newer majors.
- Unknown fields must be preserved by editors and ignored by loaders.

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

- `line` has round caps, width `w`.
- `poly` may be concave. **Editors bake `tris`** (index triples into
  `points`) on save so loaders can be dumb; loaders MAY fan untriangulated
  polys at their own risk.
- Reserved kinds for future versions: `ring`, `path`.

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

- `rotate` in radians about the part pivot; `offset` in document units;
  `scale` multiplies (0 or absent = 1).
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
