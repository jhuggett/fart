# examples/pistol

A flintlock pistol modelled once in 3D (`flintlock.fart`, `"space":
"3d"`) and projected to the 2D files a game draws: `flintlock-left.fart`
(the profile, muzzle to the right), `flintlock-top.fart` (top-down,
muzzle up), `flintlock-front.fart` (down the barrel). `generate.mjs`
builds the model from extruded profiles and writes all four; the same
projections come from the command line:

    npx fart project examples/pistol/flintlock.fart --view left --view top --outline ink:0.25

In the side view the hammer, frizzen and trigger turn about the view
axis, so the 2D file is a real rig: parents kept, poses exact, the
`cock` and `fire` clips tweened. In the top and front views those turns
leave the plane, so the projector bakes them into variant parts
(`hammer@1`, …) and subdivides the clips at 12 fps: a vector flipbook,
in the same file format. See `spec/PROJECT.md`.
