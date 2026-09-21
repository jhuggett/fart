# Scene Hierarchy of Art (.shart) — v1.0

A `.shart` file is a Scene Hierarchy of Art, pronounced **dot-s-h-art**.
It composes `.fart` files (and other `.shart` files) into a scene: a
tree of placed instances, each showing a state or a moment of a clip,
each recolourable, children riding their parents or hanging from a
socket. A shart holds no shapes of its own; everything drawn comes from
the files it names, by reference, so one cabin file is every cabin in
the scene. This document is the contract; `shart.schema.json` beside it
checks structure and `examples/` holds the conformance cases.

## Conventions

- A shart is `"space": "2d"` (the default) or `"3d"`, and every file it
  places is of the same space (error `space`). Coordinates are the
  format's: y-down, x-right, and z-away in 3D.
- `version` is the shart format's major, 1. Readers refuse newer
  majors; unknown fields are preserved by editors and ignored by
  loaders, as in `.fart`.
- Names are non-empty strings, unique among siblings (`dup.node`).
- Paths (`ref`, `palette`, `palette_refs`) are relative to the shart,
  never absolute (`path`).

## The file

```json
{
  "version": 1,
  "space": "3d",
  "name": "camp",
  "palette_refs": ["palettes/night.fart"],
  "nodes": [
    {"name": "hut", "ref": "cabin.fart", "at": [0, 0, 0], "state": "closed",
     "children": [
       {"name": "lamp", "ref": "lantern.fart", "attach": {"to": "hook", "by": "grip"}}
     ]},
    {"name": "guard", "ref": "hero.fart", "at": [14, 0, 6], "rotate": [0, 1.2, 0], "clip": "idle", "t": 0.4, "palette": "palettes/red.fart"},
    {"name": "yard", "ref": "yard.shart", "at": [30, 0, 0]},
    {"name": "rocks", "at": [-20, 0, 0], "children": [ {"name": "a", "ref": "rock.fart"}, {"name": "b", "ref": "rock.fart", "at": [4, 0, 2], "scale": 0.6, "mirror": true} ]}
  ],
  "meta": { }
}
```

## Nodes

A node is a placed thing, or a group. It carries:

- `ref`: a `.fart` (an instance of that art) or a `.shart` (that scene,
  placed whole). Absent, the node is a **group**: a frame for its
  children and nothing drawn.
- `at`, `rotate`, `scale`, `mirror`: the node's **pose** in its parent's
  frame, with the format's meanings: `at` is where the referenced file's
  origin lands (default the parent's origin), `rotate` is radians (a
  number in 2D, `[x, y, z]` in 3D, applied as a pose's turn), `scale` a
  multiplier (0 or absent = 1), `mirror` flips x. The local map is

      L(node) = translate(at) · rotate · scale · mirror

  and the world map is `W(node) = W(parent) · A(node) · L(node)`, where
  `A` is the attach map below, or identity.
- `state` or `clip` (+ `t`, seconds, default 0): what the instance shows.
  A state names one of the file's states; a clip names one of its clips
  and `t` a time in it (readers that animate treat `t` as where the clip
  starts). Neither: the file's first state, else every part at rest.
  Errors `ref.state`, `ref.clip` when the referenced file lacks them.
- `palette`: a relative path to a palette file laid over the instance's
  tokens, after the scene's `palette_refs` (below): the red guard.
- `attach`: for a child of a node that places a `.fart`: `{"to":
  "hook", "by": "grip"}` names an anchor on the parent's art (`to`) and
  one on this node's art (`by`, default the child's origin with no
  direction). The attach map `A` is the format's: positions matched and,
  where both anchors have a direction (`angle` in 2D, `dir` in 3D), the
  child turned so its direction lies along the host's; the parent's
  posed anchor is used, so a lantern hangs from a swinging hook. The
  node's own pose then applies inside that frame. `attach` on a root
  node is `schema`; under a group or a scene, or naming an anchor the
  art lacks, it is `ref.anchor` (the parent has no such anchor).
- `children`: nodes posed in this node's frame. A group's children ride
  the group; an instance's children ride the instance (its origin, or a
  socket via `attach`), but never a part of it unless attached to one
  of its anchors.
- `meta`: yours, per node: the game's own data (a spawn, a trigger id).

**Paint order (2D)**: nodes draw in list order, each followed by its
children, depth first. A 3D scene is drawn by depth like any 3D art.

**Scene palettes**: the shart's `palette_refs` (relative to the shart,
in order) are laid over every instance's resolved tokens, later refs
beating earlier, before a node's own `palette`: one night palette
darkens the whole camp.

**Nesting**: a node whose `ref` is a shart places that scene's tree
under itself; the inner scene's `palette_refs` apply to its instances,
then the outer's. A shart that reaches itself through refs is `cycle`.

**Collision** and **chains** come from the instances: a reader that
asks a scene for its solids gets every instance's colliders through the
node's world map, and a runtime that solves chains does so per
instance. The shart adds none of its own.

## Validation

`shart.schema.json` checks structure. A validator with the referenced
files in hand adds: `space` (a ref of the other space), `ref.state`,
`ref.clip`, `ref.anchor`, `cycle`; without them it warns `unresolved`
and checks the rest. Codes:

| code        | meaning                                                          |
|-------------|------------------------------------------------------------------|
| `json`      | not JSON                                                         |
| `version`   | version missing, not an integer, or newer than 1                 |
| `schema`    | structure the schema rejects, `attach` on a root node among them |
| `path`      | an absolute ref, palette or palette_ref                          |
| `dup.node`  | two siblings share a name                                        |
| `space`     | a space the reader does not know, or a ref of the other space   |
| `ref.state` `ref.clip` `ref.anchor` | the referenced file lacks the named state, clip or anchor; `ref.anchor` also for an attach under a group or a scene |
| `cycle`     | a scene that reaches itself                                      |

Warnings: `unknown` (a field this version does not know), `unresolved`
(a ref that could not be read; its checks are skipped).

## What a reader does

Flatten: walk the tree, resolve each instance's file (once per path),
its tokens (the file's own, its `palette_refs`, the scene's, the
node's), its pose list (the state, or the clip sampled at `t`), and its
world map; hand each instance to the art's own draw loop with the world
map in front. The reference loaders do this (`flattenScene`,
`flatten_scene`). Editors keep the file the way `.fart` editors do: the
file on disk is the scene.

## Versioning

Additive within a major, as the art format. 1.0 is this document.
