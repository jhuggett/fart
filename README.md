# fastart -- the Fast Art Format

JSON-backed vector art for games: shapes, recolorable palette tokens,
re-posable parts, states. The `.fart` file is the contract; the rest of
this repo exists to write it, read it, and check it.

It is called `.fart` on purpose. The format does not take itself
seriously so that you don't have to: it is plain JSON, small enough to
read, write and diff by hand (or by a language model), and it drops into
any engine that can parse JSON. Prototype with it. Ship with it if you
like.

    spec/            the format: FORMAT.md, fart.schema.json, the conformance corpus
    packages/core    @fastart/core: the format as a TypeScript library + `fart` CLI
    loaders/odin     the reference Odin loader (and its corpus test)
    studio/          Uranus, the fastart studio: the editor as a desktop app (Wails 3 + web). It emits farts.
    examples/space   a sample project: ships, a station, rocks, palettes to swap
    examples/pistol  a flintlock modelled once in 3D, projected to its side, top and front (1.3)
    examples/lantern a lantern built with core's box, extrude and lathe helpers, and its projections
    skills/fastart   how an agent writes and loads .fart files (make skill installs it)

## The format

Read `spec/FORMAT.md`. Structure is checked by `spec/fart.schema.json`;
everything a schema cannot see (tokens resolve, states name real parts,
tris index the points) is checked by the validator in `packages/core`:

    npm install
    npx fart validate path/to/art          # every .fart below, refs resolved
    npx fart bake enemies/bat.fart         # write tris into each poly (or mesh)
    npx fart project pistol.fart --view left --view top   # 2D views of a 3D file (1.3)
    npx fart gltf pistol.fart                             # the model as a .glb, animations included

`spec/examples/manifest.json` is the conformance corpus: files that must
load, files that must be refused, and the error code each refusal
carries. Every loader runs it (`npm test`, `odin test loaders/odin/test`).

The format is versioned separately from the tools: `format-vX.Y.Z` tags
release the spec, schema and corpus; `version` inside a file is the
major, and readers refuse majors they don't know.

Since 1.3 a file may be a 3D model (`"space": "3d"`: mesh, ball and rod
shapes, `[x, y, z]` turns), and `spec/PROJECT.md` fixes how such a model
becomes the 2D files a game draws: a view, a light, faces to shaded
polys, and every pose either an exact 2D pose (a turn about the view
axis) or a baked variant part, clips included. Model the pistol once,
export the side view as a rig and the top view as a flipbook. Uranus
opens a 3D file in its model screen: orbit it, draw boxes, balls, rods
and prisms in any view, pose it, and Project… the 2D files. A 3D game
loads the model itself: `loaders/odin/examples/raylib_spin` is the whole
loop in Odin and raylib (flatten each part to triangles once, draw them
through `Y_UP * world_xf_3d` every frame, chains solved live), and `fart
gltf` writes a `.glb` for any other engine.

## The studio

`make install` builds the app into `~/Applications/Uranus.app` and
replaces it there on every run, so pin that one to the Dock. ⌘J in the
app asks your own Claude Code to change the open file: it reads, edits
(one undo step), renders and validates through the editor itself.

`studio/` is the editor as a real application: a folder is a project,
recent projects on a welcome screen, drag-and-drop, double-click a
`.fart` in the Finder, docs inside the app, and a **Serve** button that
puts the same editor on your network for a tablet (one finger draws, two
pan and pinch). The interface is the web (Preact + a canvas) in a thin Go
shell (Wails 3); the same frontend runs from the shell's LAN server.

    make setup                    # once: npm deps + the Wails CLI
    make dev                      # live-reload development
    make run                      # build studio/bin/Uranus.app and open it
    make serve DIR=path/to/art    # headless: just the LAN server
    make                          # the rest

It needs Go, Node, and the Wails CLI (`go install
github.com/wailsapp/wails/v3/cmd/wails3@latest`). Releases are cut by
tagging `studio-vX.Y.Z`; see `.github/workflows/release.yml`.

How to use it is in the app (Docs) and in `studio/frontend/src/docs/guide.md`.

The original Odin + raylib editor lives on at the `classic-v0.1.0` tag,
for the curious.

## Using .fart in a game

The reference loaders show the shape of it: `loaders/odin/fastart.odin`
(types, palette resolution, ear clipping, ~200 lines) and
`packages/core` for anything that speaks JavaScript. Rendering is fifty
lines in whatever you draw with: for each part in `drawList`, for each
shape, `colorOf(tokens, shape.color)` and `posePoint(p, part, statePart)`.
