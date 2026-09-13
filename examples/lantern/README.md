# examples/lantern

A hanging lantern modelled with `@fastart/core`'s solid helpers: `lathe`
for the dish, cap and glass, `box` for the finial, `extrude` for the
handle's profile, rods for the ribs and a ball for the flame. It has a
swinging handle (a child part turning about x) and a flicker clip that
scales the flame. `generate.mjs` writes the model and its `left` and
`front` projections; `npx fart gltf examples/lantern/lantern.fart`
writes a `.glb` for any other engine.
