---
name: fastart
description: Write, edit, validate and load .fart files (the Fast Art Format, JSON vector art for games with parts, states, clips, IK chains and swappable palettes). Use when a game needs sprites, props, animations or palettes made by hand or by script, when .fart files need checking, or when loading them in Odin or TypeScript.
---

# fastart: the Fast Art Format

A `.fart` file is JSON: shapes grouped into **parts**, arranged by
**states**, animated by **clips** (states in time), reached by IK
**chains**, coloured by named **slots** a palette fills in. The format
is the contract; the checkout at `{{FASTART}}` holds the spec, the
validator, the loaders, the studio and a sample set.

- The truth: `{{FASTART}}/spec/FORMAT.md` (read it when in doubt) and
  `{{FASTART}}/spec/fart.schema.json`.
- A complete sample project: `{{FASTART}}/examples/space` (ships, a
  station, rocks, projectiles, an explosion, palettes to swap) with the
  script that wrote it, `generate.mjs`. Copy its shape for new sets.

## Coordinates and conventions

- x right, y **down** (screen-like). Units are the file's own; the
  studio shows one unit as 10 px at its default zoom. A small ship is
  ~24 units long, a capital ship ~64, a pickup ~6.
- Top-down things point up: the nose is at negative y. A game adds its
  own heading when it draws.
- Names are lowercase snake_case. Mirrored parts end `_l` / `_r`.
- Anchors are where a game hooks in: `nose`, `gun_l`, `muzzle`, `tip`,
  `exhaust`, `hand`, `foot`, `dock_n`. Name them for the game, not the art.
- Colours are never literal. A shape names a **slot** (`hull`, `skin`,
  `trim`); the palette says what it means today.

## The file, annotated

```json
{
  "version": 1,
  "name": "fighter",
  "palette_refs": ["../palettes/hull.fart"],
  "palette": [ {"name": "clasp", "rgb": [220, 190, 90, 255]} ],
  "parts": [
    {"name": "hull", "pivot": [0, 0],
     "shapes": [
       {"kind": "poly",   "color": "hull",  "points": [[0,-12],[3,-4],[3,6],[0,8],[-3,6],[-3,-4]]},
       {"kind": "line",   "color": "trim",  "a": [0,-6], "b": [0,4], "w": 0.8},
       {"kind": "circle", "color": "glass", "at": [0,-4], "r": 1.5}
     ],
     "anchors": [ {"name": "nose", "at": [0, -12]} ]},
    {"name": "wing_l", "parent": "hull", "pivot": [-3, 1], "shapes": [ ... ]}
  ],
  "states": [
    {"name": "idle",   "parts": [ {"part": "hull"}, {"part": "wing_l"} ]},
    {"name": "bank_l", "parts": [ {"part": "hull", "rotate": -0.1}, {"part": "wing_l", "scale": 0.75} ]}
  ],
  "clips": [
    {"name": "bank_left", "loop": false, "keys": [
      {"t": 0,    "state": "idle"},
      {"t": 0.25, "state": "bank_l", "ease": "out"}
    ]}
  ],
  "constraints": [ {"name": "arm", "chain": ["upper", "fore"], "end": "fore/hand", "bend": 1} ],
  "collision": [ {"kind": "poly", "points": [[0,-12],[10,7],[-10,7]]} ]
}
```

- **Shapes**: `circle` (`at`, `r`), `line` (`a`, `b`, `w`, round caps),
  `poly` (`points`, three or more, concave is fine). Order within a part
  is paint order. `tris` (index triples into `points`) is optional in a
  hand-written file: `fart bake` or the studio writes it; loaders fan
  without it.
- **Parts**: `pivot` is the point the part turns about and is placed by,
  in document space. A `parent` makes the part ride another (an arm on a
  torso, a turret on a hull): it is posed in the parent's frame, and
  paint order stays the state's list. Parents must exist and not loop.
- **States**: a named list of `{part, offset?, rotate?, scale?}`. The
  list is membership and paint order. `offset` is **where the pivot
  lands** (a position, not a delta; absent means the pivot itself, i.e.
  drawn as authored). `rotate` is radians; `scale` multiplies about the
  pivot. A file's first state is the one editors show. A file with no
  states draws all parts in file order.
- **Clips**: keys at `t` seconds, each naming a `state` (or carrying an
  inline `parts` list). Between keys, `offset` and `scale` tween
  linearly, `rotate` the short way round, bent by the *incoming* key's
  `ease`: `linear` (default), `in`, `out`, `in-out`, `step`. Which parts
  draw switches at keys, it never tweens. `loop` wraps at the last key's
  `t`; a loop that should ease back ends with a key equal to its first.
  A full turn needs three or more keys (thirds), since rotation tweens
  the short way.
- **Constraints**: `chain` lists parts root-first, each after the first
  parented to the previous; `end` is `part/anchor` on the last part;
  `bend` is `1` or `-1`. Games may solve live (`solveChain` /
  a CCD solver); the studio uses chains to pose, and saves ordinary states.
- **Collision**: ordinary shapes in document space, never drawn, `color`
  optional. Rest space only: a game poses them itself if it must.
- **Palettes**: `palette` is the file's slots with default colours.
  `palette_refs` are paths relative to *this file* to palette files
  (colours and no parts). Lookup is the file's own palette first, then
  refs last to first. An unresolved slot paints loud magenta. Keep art
  files free of colours of their own when a project shares a palette;
  override a slot locally only when one file must differ.
- Unknown fields are kept by every tool, so `meta` and your own keys are safe.

## Workflow

1. Write the JSON (by hand for one file; by a small script for a set,
   starting from `{{FASTART}}/examples/space/generate.mjs`, which has the
   helpers: mirrored parts, baked tris, validation, writing).
2. Validate, always:
   `cd {{FASTART}} && make validate DIR=/path/to/art` (every `.fart`
   below, refs resolved). Fix every error; warnings about unknown fields
   are yours to judge.
3. Look at it: `cd {{FASTART}} && make serve DIR=/path/to/art` and open
   `http://localhost:4747` (headless Playwright works against it too), or
   open the folder in fastart studio. Pick a clip and scrub. A tour
   script can read `globalThis.fastart` (the store, `frameW()` world
   transforms) to assert poses.
4. Use it in the game (below). Ignore `*.fart~` files: they are the
   studio's checkpoints (gitignore them).

## Loading in a game

**Odin** (the reference loader, `{{FASTART}}/loaders/odin`, copied into a
game as package `fastart`):

```odin
doc, ok := fastart.load_bytes(data)            // or load_file(path)
fastart.resolve_palettes(&doc, resolver, nil)   // resolver: proc(path: string, user: rawptr) -> ([]byte, bool), path is the ref as written
rgb := fastart.color_of(&doc, "hull")           // [4]u8
st  := fastart.state_of(&doc, "idle")           // ^State, its .parts is the pose list
for sp in st.parts {                            // paint order
    part := fastart.part_of(&doc, sp.part)
    W := fastart.world_xf(&doc, st.parts[:], part.name)   // parents applied
    // draw part.shapes through W (poly: tris are index triples into points), then the entity's own placement
}
frame := make([dynamic]fastart.State_Part, context.temp_allocator)
fastart.sample_clip(&doc, fastart.clip_of(&doc, "thrust"), t, &frame)   // a pose list at time t
d := fastart.clip_duration(c)
red, _ := fastart.load_bytes(red_palette_bytes)
fastart.apply_palette(&doc, red.palette[:])     // a swap: same slot names, new colours
```

Anchors: `xf_apply(world_xf(...), anchor.at)` gives the point in the
posed drawing. `destroy(&doc)` frees the containers; games that load
into an arena drop the lot.

**TypeScript** (`@fastart/core`, zero deps; not on npm yet, import from
`{{FASTART}}/packages/core/dist/index.js`): `parseDoc`, `validate`,
`resolvePalettes`, `colorOf`, `applyPalette`, `worldTransforms`,
`drawList`, `sampleClip`, `clipDuration`, `solveChain`, `bakeTris`,
`stringifyDoc`.

## Mistakes that bite

- `offset` is where the pivot *lands*, not a nudge. To draw as authored,
  leave it out (or set it to the pivot).
- A child's pivot should sit at the joint, on the parent, so turning it
  reads as articulation.
- A state that leaves a part out hides it; a clip key with `parts`
  must list every part that should show at that moment.
- `palette_refs` paths are relative to the file that names them
  (`../palettes/hull.fart` from `ships/`).
- A dark shape on a dark panel disappears: check the thumbnail.
- The version is the major: `"version": 1` (a number). Minor features
  (`parent`, `clips`, `constraints`) need no version bump.
