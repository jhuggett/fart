# examples/curves

The format 1.7 demos: curves, smooth surfaces, sweeps, and morphs on all
of them. `node examples/curves/generate.mjs` rebuilds the files; open the
folder in Uranus to play them.

- **blob.fart** (2D): a creature drawn with `path` shapes, four cubics
  for the body, a stroked path for the smile. The `squash` and `stretch`
  states morph the body's vertices (the handles ride along) and flatten
  the smile; `blink` scales the eyes. Clips: `bounce` (loop) and `blink`.
- **slime.fart** (3D): a cage of twelve sides, two rings and two poles,
  drawn subdivided twice (`smooth: 2`) with a quarter crease round the
  base so it sits on a soft lip. The `squash`, `stretch` and `lean`
  states morph the cage and the smooth surface follows; the eyes ride
  the body. Clips: `bounce` and `wobble`. `npx fart gltf slime.fart`
  exports it with three morph targets and both animations.
- **vase.fart** (3D): a `sweep` lathe of a curved profile, smoothed
  once, with an extruded flat lid; the `turn` clip spins it.
- **shelf.shart**: the solids placed together in one 3D scene, two
  slimes on different clips and the vase turning.
