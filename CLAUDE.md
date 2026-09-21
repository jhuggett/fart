# fastart

JSON vector art for games (`.fart`). The format is
the contract: `spec/FORMAT.md` + `spec/fart.schema.json` + the corpus in
`spec/examples` change together and are tagged `format-vX.Y.Z`. Tools
follow the spec, never the other way round.

- `packages/core`: `@fastart/core`, TypeScript, zero deps, Node type
  stripping (no parameter properties). Tests: `npm test -w @fastart/core`.
- `loaders/odin`: the reference loader; `odin test loaders/odin/test`.
  Build the raylib example with `odin build loaders/odin/examples/raylib_spin
  -out:/tmp/spin "-extra-linker-flags:-isysroot $(xcrun --show-sdk-path)"`.
  A copy lives in the user's game (qftebl2/fastart): copy it over after
  changing the loader and build the game.
- `studio/`: Uranus, the app ("the reference editor for the Fast Art Format"): Wails 3 (Go shell, thin: dialogs, rooted file IO, recents,
  serve) + Preact frontend. `studio/DESIGN.md` governs the UI language;
  `frontend/src/state/actions.ts` is the one command registry. Every
  canvas view is a state (there is no separate draw mode); a clip is a
  preview; a palette file opens as swatches.
- Verify studio changes headlessly: build (`npx tsc && npx vite build`
  in `studio/frontend`, `go build -o bin/studio .` in `studio`), run
  `./studio/bin/studio --serve <dir>`, drive it with Playwright, read
  `globalThis.fastart` (store, view, `frameW()`) to assert. The Chrome
  extension is unreliable here. Regenerate bindings after changing the
  Go service: `cd studio && wails3 generate bindings -ts -i -clean=true`.
- The file on disk is the document: edits land in it at once (atomic
  write), ⌘S makes the checkpoint (`name.fart~`), nothing reverts on its
  own. `make check-save` proves it end to end in a headless browser; run
  it after touching editor.ts's disk code.
- `make` lists the shortcuts; `make test` runs everything.
- Self-update: `studio/update.go` (version from the embedded
  `build/config.yml`, GitHub `studio-v*` releases, platform asset by
  suffix, swap in place, relaunch); `state/update.ts` + `ui/UpdateBadge.tsx`
  in the frontend. `FASTART_VERSION=0.1.0` makes a build believe it is
  old; `FASTART_LIVE=1 go test -run TestUpdateLive ./studio` talks to
  GitHub for real.
- Writing `.fart` files: follow `skills/fastart/SKILL.md`.
- Scenes: `.shart` (Scene Hierarchy of Art), `spec/SHART.md` +
  `spec/shart.schema.json`, shart cases in the corpus manifest carry
  `"shart": true`. Core: `scene.ts` (validateScene, loadScene,
  flattenScene, sceneCollision); Odin: `shart.odin` (load_scene,
  flatten_scene with a Scene_Cache). `fart validate` takes scenes, `fart
  flatten` lists their instances.
- 3D (format 1.3): `spec/PROJECT.md` is the projection contract; core's
  `space3.ts` + `project.ts` implement it, `fart project` drives it,
  `examples/pistol/generate.mjs` is the proof. In the studio a 3D file
  opens the model screen (`state/model.ts` store, `canvas/model3.ts`
  render+interact, `screens/Model.tsx`): the solids are drawn by WebGL
  with a depth buffer (`canvas/gl3.ts`, under a 2D overlay; the painter's
  `projectFrame` is the fallback and does picking), the four tools
  extrude solids in the view plane, Project… writes the 2D views.
  Solid helpers live in core's `solids.ts` (use them in generators), 3D
  chains in `ik3.ts`, glTF export in `gltf.ts` (`fart gltf`), collision
  (1.4: posed by `part`, `box`, `layer`, convexity, hulls) in
  `collision.ts` (`fart hull`), textures (1.5: maps that are drawings,
  box mapping, a software rasteriser, `fart bake --textures`) in
  `textures.ts` + `png.ts`; the studio renders maps in
  `state/textures.ts` for the 2D painter's patterns and WebGL; the Odin
  loader's `flatten_part` + `Y_UP` and `loaders/odin/examples/raylib_spin`
  are the 3D game path.
