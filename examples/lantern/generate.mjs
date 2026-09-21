// examples/lantern: a second prop, built with core's solid helpers the way
// an agent following skills/fastart/SKILL.md would: a lathed body, a
// boxed cage, rod ribs, a ball flame, a swinging handle on a chain.
import { box, extrude, lathe, bakeTris3, projectDoc, solveChain3, stringifyDoc, validate } from "@fastart/core";
import fs from "node:fs";
import path from "node:path";

const OUT = new URL(".", import.meta.url).pathname;
const rod = (color, a, b, w) => ({ kind: "rod", color, a, b, w });
const ball = (color, at, r) => ({ kind: "ball", color, at, r });

// hammered iron: dents as circles over a small cell (1.5), box mapped onto the dish and cap
const hammered = {
	version: 1,
	name: "hammered",
	palette: [{ name: "dent", rgb: [52, 50, 58, 255] }, { name: "gleam", rgb: [110, 108, 116, 255] }],
	parts: [
		{
			name: "dents", pivot: [0, 0],
			shapes: [
				...[[0.7, 0.8], [2.1, 0.5], [3.4, 1.2], [1.2, 2.2], [2.8, 2.6], [0.4, 3.3], [2.0, 3.6], [3.5, 3.0]].map(([x, y]) => ({ kind: "circle", color: "dent", at: [x, y], r: 0.42 })),
				...[[0.6, 0.65], [2.0, 0.35], [3.3, 1.05], [1.1, 2.05], [2.7, 2.45], [0.3, 3.15], [1.9, 3.45], [3.4, 2.85]].map(([x, y]) => ({ kind: "circle", color: "gleam", at: [x, y], r: 0.16 })),
			],
		},
	],
	states: [{ name: "all", parts: [{ part: "dents" }] }],
};

// y down: the base sits at +y, the loop hangs above at -y; the lantern faces -z
const lantern = {
	version: 1,
	space: "3d",
	name: "lantern",
	textures: [{ name: "hammered", cell: [4, 4], maps: { color: { ref: "textures/hammered.fart" } } }],
	palette: [
		{ name: "iron", rgb: [70, 68, 74, 255] },
		{ name: "brass", rgb: [200, 160, 70, 255] },
		{ name: "glass", rgb: [225, 235, 240, 140] },
		{ name: "flame", rgb: [255, 190, 90, 255], emissive: 2 },
		{ name: "wick", rgb: [40, 30, 30, 255] },
	],
	parts: [
		{
			name: "body", pivot: [0, 0, 0],
			shapes: [
				{ ...lathe("iron", [[0, 8], [4.5, 8], [4.8, 6.5], [4, 6], [0, 6]], "y", 10), texture: "hammered", mapping: { scale: 1 } }, // the base dish
				lathe("brass", [[0, -8], [2.5, -8], [3.4, -6.5], [3.6, -5.8], [0, -5.8]], "y", 10), // the cap
				lathe("glass", [[0, -5.8], [3.0, -5.8], [3.2, 0], [3.0, 6], [0, 6]], "y", 8), // the glass
				...[0, 1, 2, 3].map((k) => rod("iron", [3.1 * Math.cos((k / 4) * Math.PI * 2 + Math.PI / 4), -5.8, 3.1 * Math.sin((k / 4) * Math.PI * 2 + Math.PI / 4)], [3.1 * Math.cos((k / 4) * Math.PI * 2 + Math.PI / 4), 6, 3.1 * Math.sin((k / 4) * Math.PI * 2 + Math.PI / 4)], 0.5)),
				box("brass", [0, -8.4, 0], [1.6, 0.8, 1.6]), // the finial
			],
			anchors: [{ name: "hook", at: [0, -8.8, 0], dir: [0, -1, 0] }],
		},
		{
			name: "flame", parent: "body", pivot: [0, 4, 0],
			shapes: [rod("wick", [0, 4.5, 0], [0, 2.5, 0], 0.5), ball("flame", [0, 1.4, 0], 1.3), ball("flame", [0, 0, 0], 0.7)],
		},
		{
			name: "handle", parent: "body", pivot: [0, -8.8, 0],
			shapes: [extrude("iron", [[-3.2, -8.8], [3.2, -8.8], [2.4, -14], [0, -15.5], [-2.4, -14]], "x", -0.35, 0.35), rod("iron", [0, -15.5, 0], [0, -17, 0], 0.6)],
			anchors: [{ name: "grip", at: [0, -17, 0], dir: [0, -1, 0] }],
		},
	],
	states: [
		{ name: "rest", parts: [{ part: "body" }, { part: "flame" }, { part: "handle" }] },
		{ name: "swung", parts: [{ part: "body" }, { part: "flame" }, { part: "handle", rotate: [0.6, 0, 0] }] },
		{ name: "tilted", parts: [{ part: "body", rotate: [0, 0, 0.35] }, { part: "flame" }, { part: "handle", rotate: [0, 0, -0.35] }] },
	],
	clips: [
		{ name: "swing", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.5, state: "swung", ease: "in-out" }, { t: 1.0, state: "rest", ease: "in-out" }] },
		{ name: "flicker", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.12, parts: [{ part: "body" }, { part: "flame", scale: 1.25 }, { part: "handle" }] }, { t: 0.25, state: "rest" }] },
	],
	meta: { note: "built with @fastart/core's box, extrude and lathe; see generate.mjs" },
};

// the handle's ring is hollow only in spirit: remove the glass's inner face if you want to see the flame through it
bakeTris3(lantern);
const write = (rel, doc) => {
	const r = validate(doc);
	if (!r.ok) {
		console.error(rel, JSON.stringify(r.errors, null, 1));
		process.exit(1);
	}
	fs.writeFileSync(path.join(OUT, rel), stringifyDoc(doc));
	console.log("wrote", rel, r.warnings.length ? r.warnings : "");
};
fs.mkdirSync(path.join(OUT, "textures"), { recursive: true });
write("textures/hammered.fart", hammered);
write("lantern.fart", lantern);
for (const view of ["left", "front"]) write(`lantern-${view}.fart`, projectDoc(lantern, { view, from: "lantern.fart", outline: { color: "iron", w: 0.2 } }));
void solveChain3;
