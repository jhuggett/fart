# Projection — 3D to 2D (format 1.3)

A 3D document is the source; the 2D documents a game draws are built
from it, the way a sprite sheet is built from a scene, except that the
result stays a `.fart`: vector, recolourable, and rigged wherever the
motion allows. This document fixes the rules so that every tool
(`fart project`, the studio) produces the same file from the same
source, view and light.

    fart project pistol.fart --view side -o pistol-side.fart

## Inputs

- **The source**: a valid 3D document (`"space": "3d"`).
- **The view**: a turn `[rx, ry, rz]` (radians, applied as in a pose:
  about x, then y, then z) laid on the whole model before z is dropped.
  Named views are turns:

  | view     | turn              | what you see                                             |
  |----------|-------------------|----------------------------------------------------------|
  | `front`  | `[0, 0, 0]`       | the file as authored; the model faces the viewer          |
  | `back`   | `[0, π, 0]`       | from behind                                              |
  | `right`  | `[0, π/2, 0]`     | the +x side faces the viewer; the front points to the viewer's left |
  | `left`   | `[0, -π/2, 0]`    | the −x side faces the viewer; the front points to the viewer's right |
  | `side`   | as `right`        |                                                          |
  | `top`    | `[π/2, 0, π]`     | from above, the front pointing **up** the picture, the way a top-down sprite faces |
  | `bottom` | `[-π/2, 0, 0]`    | from below, the front pointing up the picture             |

- **The light**: a direction *toward* the light, in view space (after
  the turn), default `[-1, -2, -3]` (up, left, and toward the viewer).
  **Ambient**: a number in 0..1, default `0.4`. A face with outward unit
  normal `n` (in view space) gets

      shade = ambient + (1 − ambient) · max(0, n · l̂)

  rounded to two decimals; a ball or a rod is shaded as a face turned to
  the viewer (`n = [0, 0, −1]`).
- **fps**: the sample rate for the parts that must be baked (below),
  default 12.
- **Outline** (optional): a token and a width. Silhouette edges (an edge
  with exactly one face turned to the viewer, or a single face) become
  `line` shapes in that token, painted after the part's faces.

## Geometry

Every point goes through the view turn, then `[x, y, z] → [x, y]`; z is
kept for ordering. Coordinates are rounded to three decimals.

- A `mesh` yields one `poly` per face that faces the viewer (`n · [0, 0, −1] > 0`,
  i.e. normal z below 0 after the turn), the face's points in order,
  `color` the mesh's token, `shade` as above, `tris` baked. Back faces
  are dropped.
- A `ball` yields a `circle` (`at` projected, `r` unchanged); a `rod`
  yields a `line` (`a`, `b` projected, `w` unchanged).
- Within a part, shapes are painted far to near: by the mean z of each
  face's points; a ball or a rod by its nearest point (its centre less
  its radius), so an eye half sunk in a face still paints over it. Parts themselves are ordered
  far to near by the mean z of their visible shapes' centres, per pose.
  This is the painter's algorithm; parts that pass through each other
  in depth cannot be drawn right by a 2D reader, so split such parts in
  the source.
- Pivots project; anchors project; an anchor's `dir` becomes an `angle`
  (`atan2` of its projected direction) where the projection is not
  degenerate, and is dropped otherwise.
- `collision` does not project (a top view's solids are not a side
  view's); the 2D file has none. Chains and targets do not project
  either: the 3D poses hold the solved turns, the projector solves
  tweened targets at every sample it takes, and the 2D file carries
  the result as plain poses.
- The 2D file keeps the source's `name`, `palette`, `palette_refs`
  (re-relativised to the output's location), and `meta`, plus
  `meta.projected`: `{"from", "view", "light", "ambient", "fps"}`, so a
  tool can rebuild the file from its source.

## Poses: tween or bake

A 2D part has one set of shapes and a pose of `offset`, `rotate` and
`scale` (and `mirror`). A 3D turn survives that exactly only when it is a
turn about the view axis. So for every part, in every state and at every
key, the projector looks at the part's world map after the view turn,
`M` (a 3×3 linear part `A` and a translation), and decides:

- **In-plane**: the image of the part does not depend on rest depth,
  `|A[0][2]| ≤ ε·s` and `|A[1][2]| ≤ ε·s` (`s` the uniform scale,
  `ε = 1e-3`). Then the 2×2 block of `A` is a similarity and the 2D pose
  is exact: `offset` is the projected pivot, `scale` is `s`, `mirror` is
  whether the block flips handedness, `rotate` is the block's angle
  (after undoing the mirror). The part tweens in 2D as it did in 3D.
- **Baked**: otherwise. The part's posed geometry is projected as it
  stands and stored as a **variant part** named `part@n` (`n` counting
  from 1 within the file), with no parent, its pivot at the projected
  world pivot, its anchors projected under the pose. The pose entry
  names the variant and carries no pose (it is drawn as authored).
  Variants are shared: two poses with the same world map (rounded to
  three decimals) use one variant.

Parents: a part keeps its `parent` in the 2D file when the parent is
in-plane in every state and key of the source; then an in-plane child's
2D pose is local to the parent (`W₂(parent)⁻¹ · W₂(child)`, a
similarity), and the 2D reader composes them the way the 3D one did.
Otherwise the part has no parent in 2D and its poses are world poses.
Variants never have parents. A `like` part keeps its `like` while
in-plane; its variants are their own geometry.

## States and clips

- Each state projects to a state of the same name: the parts it draws,
  in-plane parts posed, baked parts replaced by their variant, in the
  painter's order for that pose.
- Each clip projects to a clip of the same name and `loop`. A key that
  names a state names it still; a key with inline `parts` keeps them
  inline. A key's `ease`, `curve` and `events` are kept on it.
- A span between two keys is **subdivided** at `fps` when, at any
  sample in it, some drawn part is baked or the painter's order differs
  from the outgoing key's. The sub-keys are inline `parts` keys, linear,
  each the projection of the 3D frame at that time (the 3D ease
  applied), so an in-plane part still tweens between sub-keys and a
  baked part flips through its variants like a flipbook. A span that
  needs no subdivision keeps its two keys and its ease untouched.
- Events stay on the keys they came from; sub-keys carry none.

So a side view of a walking figure is mostly a real 2D rig (limbs turn
about the depth axis), a front view of the same clip is mostly variants,
and a prop with hinges is a rig from every side. The projector never has
to know which is which: the test is per part, per pose.

## What a reader needs

Nothing new. The output is a 1.3 2D document that uses `shade`; a 1.2
reader draws it flat and otherwise right.
