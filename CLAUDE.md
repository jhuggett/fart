# fastart

JSON vector art for games (`.fart`, and yes, on purpose). The format is
the contract: `spec/FORMAT.md` + `spec/fart.schema.json` + the corpus in
`spec/examples` change together and are tagged `format-vX.Y.Z`. Tools
follow the spec, never the other way round.

- `packages/core`: `@fastart/core`, TypeScript, zero deps, Node type
  stripping (no parameter properties). Tests: `npm test -w @fastart/core`.
- `loaders/odin`: the reference loader; `odin test loaders/odin/test`.
  A copy lives in the user's game (qftebl2/fastart): copy it over after
  changing the loader and build the game.
- `studio/`: Uranus, the app ("the fastart studio. It emits farts."): Wails 3 (Go shell, thin: dialogs, rooted file IO, recents,
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
- `make` lists the shortcuts; `make test` runs everything.
- Writing `.fart` files: follow `skills/fastart/SKILL.md`.
