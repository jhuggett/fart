# Curves and smooth surfaces: a proposal for 1.7 and 1.8

How fastart should describe smooth things while staying fast art: a
file that is always a low-poly drawing or model, carrying the smooth
source beside it, with every interpretation a reader may make spelled
out. Research notes first, then the design, then what is deliberately
left out. Nothing here is in the format yet.

## What the field does

**2D vector animation (Lottie, Rive, Figma).** All three keep cubic
béziers as the one curve primitive, and all three store a curve as
*vertices with tangents* rather than as SVG-style command strings.
Lottie's path is `{v, i, o, c}`: vertices, in-tangents and
out-tangents (each **relative to its vertex**), and a closed flag; a
shape keyframe is a whole path, and two keyed paths must have the same
vertex count to interpolate. Rive adds editor-side vertex *types*
(straight, mirrored, asymmetric, detached) that constrain the two
tangents, and keys vertex properties independently (position, handle
angle, handle length) to keep files small. Figma generalised the path
into a *vector network*: edges between any two vertices and fills as
regions you toggle, instead of winding rules. Rive's renderer
tessellates curves on the GPU; Lottie players and Skia flatten on the
CPU. The common thread: the file keeps curves, the renderer decides the
resolution, and animating a curve means moving its vertices with the
tangents riding along.

**Flattening.** The accepted way to turn a cubic into a polyline is
recursive de Casteljau subdivision against a *flatness tolerance*: a
maximum distance between the chord and the true curve. Anti-Grain
Geometry's reference uses a tolerance of a quarter pixel squared, a
recursion limit of about 17, and an optional angle test (0.2 rad) so
strokes stay round. Wang's formula gives a conservative closed-form
segment count from the control points and the tolerance and is what
Skia uses. The point for a format: specify the *error bound*, not the
segment count, and any flattening inside the bound conforms.

**2D rigged meshes (Spine).** Spine has no curves at all. A mesh
attachment is `vertices`, `triangles`, `uvs`, a `hull` count, and a
*deform* timeline whose keys are per-vertex offsets added to the setup
pose, zero-filled past the entries given, with the rule that the vertex
count never changes. That is our 1.6 morph almost exactly, which is
reassuring.

**3D smooth surfaces (OpenSubdiv, USD, Blender, glTF).** The industry
standard for smooth low-poly is Catmull-Clark subdivision of a quad
cage, with *semi-sharp creases*. OpenSubdiv's rules, adopted by USD:
an edge or vertex carries a sharpness 0–10; 0 is smooth, 10 or more is
infinitely sharp (a tangent discontinuity), and in between the
sharpness **decrements by one per subdivision level**, so a sharpness
of 3 is sharp for three levels and then rounds off, which reads as a
fillet. Boundaries interpolate either as a smooth curve
(`EDGE_ONLY`) or pinned at the corners (`EDGE_AND_CORNER`). UVs are
interpolated with their own, usually more linear, rule. Blender shows
the artist a crease of 0–1 and maps it onto that scale. Loop
subdivision is the triangle-mesh equivalent (we have polygon faces, so
Catmull-Clark is the fit). glTF has **no** subdivision: a long-running
issue proposes converting to bézier patches first, and in practice
every game pipeline bakes the subdivided mesh (or bakes its normals
into a texture over a low-poly) before export. Hard-surface game art
usually does not subdivide at all: it bevels the cage and uses
*smooth shading* (averaged vertex normals, with an auto-smooth angle or
hand-marked sharp edges), which costs no geometry. The lesson: a
smooth surface is a refinement of a cage that always exists, and the
cheapest smoothness is in the normals, not the points.

## What our spec already gives us

- **Editors bake, readers may be dumb.** `tris` is exactly this: the
  source is `points`/`faces`, the bake is optional, a reader that
  cannot triangulate reads the bake and one that can ignores it. Curves
  and subdivision are two more sources with two more bakes.
- **Open interpretation is a feature.** The format states results
  (a bound, a limit surface) and never an algorithm. Any flattening
  within the tolerance conforms; any subdivision reaching the same
  limit surface conforms, as the IK text already says of solvers.
- **The pose model composes.** A morph replaces a shape's points
  whole. If a path's tangents are *relative* to their vertices and a
  mesh's smoothness lives on the cage, then morphs, clips, blending,
  layering and IK all work on curved and smooth things with no new
  rule: the curve or surface is recomputed from the posed control data.
- **JSON reads back by hand.** Vertices and relative tangents are
  numbers a person can type; a cage with a few creases is a cage a
  person can type. SVG command strings and patch control nets are not.
- **Additive minors.** A 1.6 reader draws a `path`'s bake as a `poly`
  (if we make the bake a poly), and draws a smooth mesh's cage flat.
  Both are the right fallback, not a broken one.

## The design

### 2D: `path` (1.7)

A `path` is a closed or open cubic polybézier, one token, Lottie's
shape in the format's words:

```json
{"kind": "path", "color": "skin", "closed": true,
 "points": [[-6,-4], [6,-4], [8,0], [6,4], [-6,4], [-8,0]],
 "in":     [[-2,0],  [-2,0], [0,-2], [2,0],  [2,0],  [0,2]],
 "out":    [[2,0],   [2,0],  [0,2],  [-2,0], [-2,0], [0,-2]],
 "bake": {"points": [[-6,-4], [-5.1,-4.2], ...], "tris": [0,1,2, ...]}}
```

- `points` are the vertices; `in[i]` and `out[i]` are the tangent
  handles **relative to `points[i]`** (absent, or `[0,0]`: a corner).
  The segment from vertex i to i+1 is the cubic with control points
  `points[i] + out[i]` and `points[i+1] + in[i+1]`. `closed` adds the
  last-to-first segment and fills; open paths stroke with `w`, round
  joins and caps, like `line`.
- A `poly` is a `path` with no tangents; the kind stays for files and
  tools that want it, and for hand-writing.
- **The bake** is the flattened polygon and its triangles, so a 1.6
  reader can draw `bake.points` as a `poly`. Editors write it on save.
  The tolerance: the polyline lies within **0.05 document units** of
  the curve, and a reader that flattens for itself must do at least as
  well (any algorithm; recursive de Casteljau or Wang's bound are both
  fine). At the studio's usual zoom one unit is ten pixels, so this is
  half a pixel. A hand-written file may omit the bake; the validator
  does not require it.
- **Morphs** replace `points` only; `in`/`out` ride along because they
  are relative. A morph may also carry `in` and `out` (same counts) to
  reshape handles; absent, the base handles stand. The bake of a
  morphed path is recomputed by readers that curve and ignored by
  readers that draw bakes (they draw the base bake, which is the
  documented 1.6 fallback: shape, not motion).
- **Collision** and `fart hull` use the bake. Textures map over the
  path as over a poly. `shade` as ever.
- Errors: `path` when `in`/`out` are present with a count that differs
  from `points`, or an open path has no `w`; `tris` as for polys.

### 3D: `normals` (1.7) and `smooth` + `creases` (1.8)

Two levels, cheapest first.

**`normals` on a mesh (1.7)**: `"flat"` (the default, what every file
means today) or `"smooth"`. Smooth means readers light each vertex by
the average of its faces' normals, except across edges marked sharp,
which stay as two normals. Zero geometry, and most low-poly props
that want to look rounded want only this. Sharp edges come from the
same `creases` list below with crease 1, or from an `angle` (degrees;
faces meeting at more than this stay flat, Blender's auto-smooth).
glTF export writes per-vertex normals; the Odin loader's `Tri_Mesh`
gets averaged normals in `flatten_shape`; the studio's WebGL path and
the projector shade per vertex (the projector interpolates shade
across a face as a gradient, or keeps one shade per face when
`--flat`).

**`smooth` on a mesh (1.8)**: an integer, the number of Catmull-Clark
levels (0 is none; 1–3 are sensible; the validator warns above 3).
`creases` is a list of `[a, b, c]`: an edge from point a to point b
with crease c in 0–1, and `[a, c]` a corner. The semantics follow
OpenSubdiv so that any renderer with it conforms: sharpness is
`c × 10`, infinitely sharp at 1, decremented by one per level in
between. Boundaries interpolate as edges with corners pinned
(`EDGE_AND_CORNER`), the rule that keeps a lid's rim where the cage
put it. The limit surface is the conformance target; a reader that
subdivides `smooth` levels with these rules conforms, and so does one
that evaluates the limit directly.

- **The cage is the file.** `points` and `faces` stay the low-poly
  model; `smooth` is a refinement. Morphs move cage points; IK poses
  parts; collision and `fart hull` use the cage. A 1.7 reader draws
  the cage, which is a correct low-poly rendering of the same thing.
- **The bake** of a smooth mesh is the subdivided mesh, `bake:
  {points, faces, tris, normals?}`, and it is **not** written on save:
  two levels on a 200-face cage is 3,200 faces, and this is JSON.
  `fart bake --smooth` writes bakes for a game that will not subdivide;
  editors drop a stale bake when the cage changes (compare a hash kept
  in `bake.of`). Readers prefer, in order: their own subdivision, the
  bake, the cage.
- **Textures** (1.5) under subdivision: box mapping is evaluated on the
  subdivided surface's own normals, explicit `uvs` interpolate linearly
  within their face (OpenSubdiv's `FVAR_LINEAR_ALL`), the simplest rule
  and the one a hand-mapped low-poly expects.
- **Projection** (`PROJECT.md`): a smooth mesh projects its subdivided
  surface at the file's `smooth` level, so the 2D views get the curved
  silhouette; `--flat` projects the cage. Shade is per face of the
  subdivided mesh unless `normals` is smooth, then per vertex as a
  gradient.
- **glTF**: the subdivided mesh with its normals; morph targets are
  built on the subdivided layout by subdividing each morphed cage the
  same way (the subdivision is linear in the cage points, so lerping
  cages and lerping surfaces agree, which is the reason the targets
  stay exact).
- Errors: `crease` for an index past the last point, an edge that is
  not an edge of a face, or a value outside 0–1; `schema` for a
  non-integer `smooth`.

### 3D: generated solids (later, 1.9)

`lathe` and `extrude` exist as generator helpers in core and the
studio's prism tool is an extrude. A `sweep` shape kind would carry
the profile as a 2D `path` plus the operation (`lathe` about an axis
with `segments`, `extrude` along an axis between two depths, or along
a 3D path) and bake to a `mesh` in `bake`. It would let the studio
edit the profile after the fact. Worth doing after `path` exists,
because it reuses it whole; not before.

## Left out, on purpose

- **Vector networks** (Figma): a better editor model, a worse file
  model. Fills by region need an editor to toggle; a path list with
  one token each is what a game draws. The studio may *edit* with a
  network and write paths.
- **Quadratics, arcs, SVG commands**: one curve kind keeps every
  reader to one flattener. Fonts and SVG convert to cubics losslessly
  enough.
- **Fill rules and holes**: a path is one loop. A ring is two shapes,
  as it is for polys today; `ring` stays reserved.
- **Bézier patches and NURBS**: hand-unwritable, and the glTF thread
  shows how little anything downstream wants them.
- **Skinning**: still no. Smooth surfaces come from cages; motion comes
  from parts, chains and morphs.
- **Per-vertex colour**: tokens per shape, as ever. A gradient is a
  texture.

## Loaders

The Odin loader, first cut: read `path` bakes and draw them as polys;
read `normals` and average in `flatten_shape`; read `smooth` and
`creases` and draw the **cage** unless a `bake` is present, in which
case flatten the bake. Subdividing in the loader is a later, optional
`subdivide_3d` (Catmull-Clark with the crease rules above is about two
hundred lines) behind no flag: a game that wants it calls it once at
load and keeps the result. Flattening paths in the loader is likewise
optional; the bake is always there from the studio.

## The studio

- **Pen tool.** P becomes the pen: click places a corner, drag places
  a vertex with mirrored handles, Alt breaks a handle, Enter or the
  first point closes. The poly tool is the pen with click only, so one
  tool. Vertex types stay editor state (mirrored is inferred when `in`
  equals `-out`). The inspector shows the vertex's tangents as fields.
  Deform in 2D arrives with this: the same Deform toggle, corner drags
  into the state's morph, and the hit-testing gap from 1.6 closes
  because picking goes through the posed shape.
- **Model screen.** A `normals` toggle and a `smooth` level on the
  mesh in the inspector; the viewport draws the cage as a wire over
  the smooth surface when `smooth` is on, and corner drags move cage
  points. Creases need edge selection, which is the first piece of
  the face-and-edge work the 1.6 notes already list, so `creases` come
  with that tool and not before.

## Sequence

1. **1.7**: `path` with bakes, `normals` on meshes. Core, Odin, the
   projector, glTF, the pen tool, 2D deform. Corpus: a curved blob
   with a morph, a smooth-shaded prop.
2. **1.8**: `smooth` and `creases`, `fart bake --smooth`, cage-over-
   surface in the model screen, edge selection with a crease field.
3. **1.9**: `sweep`.

## Open questions

- Tolerance: 0.05 units is half a pixel at the studio's default zoom;
  a game drawing at 4 pixels per unit would be happy with 0.2. The
  bake could carry its tolerance so a reader knows whether to re-flatten.
- Crease scale: 0–1 like Blender (chosen above) or 0–10 like
  OpenSubdiv. The artist-facing scale wins unless we expect files to be
  generated from USD.
- Whether `normals: "smooth"` should be the default for meshes with
  `smooth` > 0. Probably yes: a subdivided surface lit flat is rarely
  what anyone wants.

## Sources

- Lottie bézier paths: https://lottiefiles.github.io/lottie-docs/breakdown/bezier/ and the spec https://lottie.github.io/lottie-spec/1.0/single-page/
- Rive vertex types and keyed vertex properties: https://rive.app/docs/editor/fundamentals/edit-vertices ; GPU tessellation: https://rive.app/blog/rive-renderer-now-open-source-and-available-on-all-platforms
- Figma vector networks: https://www.figma.com/blog/introducing-vector-networks/
- Flattening tolerances: https://agg.sourceforge.net/antigrain.com/research/adaptive_bezier/index.html ; Wang's formula in stroking: https://arxiv.org/html/2405.00127v1
- Spine meshes and deform timelines: http://esotericsoftware.com/spine-json-format
- OpenSubdiv rules, semi-sharp creases, boundaries, face-varying: https://github.com/PixarAnimationStudios/OpenSubdiv/blob/release/documentation/subdivision_surfaces.rst
- USD mesh schema (subdivisionScheme, creaseSharpnesses, cornerSharpnesses, interpolateBoundary, faceVaryingLinearInterpolation): https://openusd.org/dev/api/class_usd_geom_mesh.html
- Blender edge crease 0–1: https://docs.blender.org/manual/en/2.93/modeling/meshes/editing/edge/edge_data.html
- glTF and subdivision: https://github.com/KhronosGroup/glTF/issues/2306 , https://github.com/KhronosGroup/glTF/issues/1362
- Subdivision schemes: https://en.wikipedia.org/wiki/Subdivision_surface
- Game pipelines (cage, bake, bevels, smooth shading): https://3dskillup.art/high-poly-to-low-poly-workflow/ , https://blenderartists.org/t/low-poly-looking-smooth-and-flat-edges/1384905
