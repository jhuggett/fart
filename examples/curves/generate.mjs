// examples/curves: the 1.7 demos. A 2D creature drawn with paths whose
// states morph it (the handles ride along), a 3D slime that is a
// twelve-corner cage subdivided smooth with squash-and-stretch morphs, a
// lathed vase from a curved profile, and a scene that places the solids.
// Run: node examples/curves/generate.mjs
import { bakePaths, bakeTris3, box, stringifyDoc, validate } from "@fastart/core";
import fs from "node:fs";
import path from "node:path";

const OUT = new URL(".", import.meta.url).pathname;
const K = 0.5523; // a quarter circle as one cubic: handles of 0.5523·r

// ------------------------------------------------------------------ blob (2D)
// an ellipse of four cubics, with a flat bottom made by pulling the lower handles out
const ellipse = (rx, ry) => ({
	points: [[0, -ry], [rx, 0], [0, ry], [-rx, 0]],
	out: [[rx * K, 0], [0, ry * K], [-rx * K, 0], [0, -ry * K]],
	in: [[-rx * K, 0], [0, -ry * K], [rx * K, 0], [0, ry * K]],
});
const body = ellipse(9, 8);
const squashed = ellipse(11, 6);
const stretched = ellipse(7, 10);
const smile = { points: [[-3, 2.5], [0, 4], [3, 2.5]], out: [[1, 1.2], [0, 0], [0, 0]], in: [[0, 0], [-1.2, 0], [-1, 1.2]] };
const flat = { points: [[-3, 3], [0, 3], [3, 3]], out: [[1, 0], [0, 0], [0, 0]], in: [[0, 0], [-1, 0], [-1, 0]] };
const blob = {
	version: 1,
	name: "blob",
	palette: [
		{ name: "skin", rgb: [120, 200, 150, 255] },
		{ name: "belly", rgb: [170, 230, 190, 255] },
		{ name: "ink", rgb: [30, 40, 36, 255] },
		{ name: "white", rgb: [245, 248, 246, 255] },
	],
	parts: [
		{
			name: "body", pivot: [0, 8],
			shapes: [
				{ kind: "path", color: "skin", closed: true, ...body },
				{ kind: "path", color: "belly", closed: true, ...ellipse(5, 4), points: ellipse(5, 4).points.map(([x, y]) => [x, y + 3]) },
				{ kind: "path", color: "ink", w: 0.8, ...smile },
			],
		},
		{
			name: "eye_l", parent: "body", pivot: [-3.2, -2],
			shapes: [{ kind: "circle", color: "white", at: [-3.2, -2], r: 1.6 }, { kind: "circle", color: "ink", at: [-2.8, -2], r: 0.8 }],
		},
		{ name: "eye_r", like: "eye_l", parent: "body", pivot: [3.2, -2] },
	],
	states: [
		{ name: "idle", parts: [{ part: "body", offset: [0, 8] }, { part: "eye_l", offset: [-3.2, -2] }, { part: "eye_r", offset: [3.2, -2], mirror: true }] },
		{ name: "squash", parts: [{ part: "body", offset: [0, 8], morph: [{ shape: 0, points: squashed.points, in: squashed.in, out: squashed.out }, { shape: 2, points: flat.points, in: flat.in, out: flat.out }] }, { part: "eye_l", offset: [-4, -0.5] }, { part: "eye_r", offset: [4, -0.5], mirror: true }] },
		{ name: "stretch", parts: [{ part: "body", offset: [0, 8], morph: [{ shape: 0, points: stretched.points, in: stretched.in, out: stretched.out }] }, { part: "eye_l", offset: [-2.6, -4] }, { part: "eye_r", offset: [2.6, -4], mirror: true }] },
		{ name: "blink", parts: [{ part: "body", offset: [0, 8] }, { part: "eye_l", offset: [-3.2, -2], scale: 0.1 }, { part: "eye_r", offset: [3.2, -2], scale: 0.1, mirror: true }] },
	],
	clips: [
		{ name: "bounce", loop: true, keys: [{ t: 0, state: "idle" }, { t: 0.25, state: "squash", ease: "in" }, { t: 0.55, state: "stretch", ease: "out" }, { t: 0.9, state: "idle", ease: "in-out" }] },
		{ name: "blink", keys: [{ t: 0, state: "idle" }, { t: 0.12, state: "blink", ease: "in" }, { t: 0.24, state: "idle", ease: "out" }] },
	],
};

// ------------------------------------------------------------------ slime (3D)
// a cage of two stacked rings of six plus a crown and a base: twelve
// sides, subdivided twice it is a soft blob; the morphs squash and
// stretch the cage and the surface follows
function cage(w, h, d, belly = 1) {
	const pts = [];
	const ring = (y, r) => {
		const out = [];
		for (let k = 0; k < 6; k++) {
			const th = (k / 6) * Math.PI * 2 + Math.PI / 6;
			pts.push([+(Math.cos(th) * r * w).toFixed(3), y, +(Math.sin(th) * r * d).toFixed(3)]);
			out.push(pts.length - 1);
		}
		return out;
	};
	const top = ring(-h * 0.75, 0.55);
	const mid = ring(-h * 0.3, belly);
	const low = ring(h * 0.15, 0.85);
	pts.push([0, -h, 0]);
	const apex = pts.length - 1;
	pts.push([0, h * 0.3, 0]);
	const base = pts.length - 1;
	const faces = [];
	const belt = (a, b) => {
		for (let k = 0; k < 6; k++) faces.push([a[k], a[(k + 1) % 6], b[(k + 1) % 6], b[k]]);
	};
	belt(top, mid);
	belt(mid, low);
	for (let k = 0; k < 6; k++) faces.push([apex, top[(k + 1) % 6], top[k]]);
	for (let k = 0; k < 6; k++) faces.push([base, low[k], low[(k + 1) % 6]]);
	return { points: pts, faces, base: low };
}
const rest = cage(5, 7, 5);
const squashC = cage(6.5, 4.5, 6.5, 1.15);
const stretchC = cage(3.8, 10, 3.8, 0.85);
const leanC = cage(5, 7, 5);
leanC.points = leanC.points.map(([x, y, z]) => [+(x + (y + 2) * -0.35).toFixed(3), y, z]);
const slime = {
	version: 1,
	space: "3d",
	name: "slime",
	palette: [
		{ name: "goo", rgb: [90, 200, 120, 230] },
		{ name: "deep", rgb: [40, 120, 70, 255] },
		{ name: "ink", rgb: [20, 30, 25, 255] },
		{ name: "white", rgb: [240, 250, 245, 255] },
	],
	parts: [
		{
			name: "body", pivot: [0, 2, 0],
			shapes: [
				// the base ring's edges creased a little so the slime sits with a soft lip instead of a point
				{ kind: "mesh", color: "goo", points: rest.points, faces: rest.faces, smooth: 2, creases: rest.base.map((a, k) => [a, rest.base[(k + 1) % 6], 0.25]) },
			],
		},
		{
			name: "eyes", parent: "body", pivot: [0, -3, -3],
			shapes: [
				{ kind: "ball", color: "white", at: [-1.5, -3.6, -4], r: 1.0 },
				{ kind: "ball", color: "ink", at: [-1.5, -3.6, -4.8], r: 0.45 },
				{ kind: "ball", color: "white", at: [1.5, -3.6, -4], r: 1.0 },
				{ kind: "ball", color: "ink", at: [1.5, -3.6, -4.8], r: 0.45 },
			],
		},
	],
	states: [
		{ name: "rest", parts: [{ part: "body", offset: [0, 2, 0] }, { part: "eyes", offset: [0, -3, -3] }] },
		{ name: "squash", parts: [{ part: "body", offset: [0, 2, 0], morph: [{ shape: 0, points: squashC.points }] }, { part: "eyes", offset: [0, -1.6, -4.2], scale: 1.15 }] },
		{ name: "stretch", parts: [{ part: "body", offset: [0, 2, 0], morph: [{ shape: 0, points: stretchC.points }] }, { part: "eyes", offset: [0, -5.5, -2.2], scale: 0.9 }] },
		{ name: "lean", parts: [{ part: "body", offset: [0, 2, 0], morph: [{ shape: 0, points: leanC.points }] }, { part: "eyes", offset: [-1.2, -3, -3], rotate: [0, 0, -0.2] }] },
	],
	clips: [
		{ name: "bounce", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.3, state: "squash", ease: "in" }, { t: 0.6, state: "stretch", ease: "out" }, { t: 1.0, state: "rest", ease: "in-out" }] },
		{ name: "wobble", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.5, state: "lean", ease: "in-out" }, { t: 1.0, state: "rest", ease: "in-out" }] },
	],
	collision: [{ kind: "ball", at: [0, -2, 0], r: 5.5, part: "body" }],
};

// ------------------------------------------------------------------ vase (3D): a lathe of a curved profile, smoothed once
const vase = {
	version: 1,
	space: "3d",
	name: "vase",
	palette: [
		{ name: "glaze", rgb: [70, 110, 160, 255] },
		{ name: "clay", rgb: [190, 150, 110, 255] },
	],
	parts: [
		{
			name: "pot", pivot: [0, 4, 0],
			shapes: [
				{
					kind: "sweep", color: "glaze", op: "lathe", axis: "y", segments: 14, smooth: 1,
					profile: {
						points: [[0, 4], [3, 3.6], [4.2, 0], [2.4, -4], [1.6, -6.5], [2.6, -8], [0, -8]],
						out: [[0, 0], [0.9, -0.3], [0, -1.6], [-0.3, -1.1], [0.2, -0.6], [0, 0], [0, 0]],
						in: [[0, 0], [-0.9, 0.3], [0, 1.6], [0.3, 1.1], [-0.2, 0.6], [0, 0], [0, 0]],
					},
				},
				{ kind: "sweep", color: "clay", op: "extrude", axis: "y", from: 4, to: 4.8, normals: "flat", profile: { points: [[-3.4, -3.4], [3.4, -3.4], [3.4, 3.4], [-3.4, 3.4]], out: [[0, 0], [0, 0], [0, 0], [0, 0]], in: [[0, 0], [0, 0], [0, 0], [0, 0]] } },
			],
		},
	],
	states: [{ name: "rest", parts: [{ part: "pot", offset: [0, 4, 0] }] }, { name: "turned", parts: [{ part: "pot", offset: [0, 4, 0], rotate: [0, Math.PI, 0] }] }],
	clips: [{ name: "turn", loop: true, keys: [{ t: 0, state: "rest" }, { t: 1.5, state: "turned" }, { t: 3, state: "rest" }] }],
};

// ------------------------------------------------------------------ the scene
const scene = {
	version: 1,
	space: "3d",
	name: "shelf",
	nodes: [
		{ name: "slime", ref: "slime.fart", at: [-9, 0, 0], clip: "bounce", t: 0 },
		{ name: "slime2", ref: "slime.fart", at: [9, 0, 2], clip: "wobble", t: 0.2, scale: 0.7 },
		{ name: "vase", ref: "vase.fart", at: [0, 0, 6], clip: "turn", t: 0 },
	],
};

function write(rel, doc) {
	const r = validate(doc);
	if (r.errors.length) {
		console.error(rel, r.errors);
		process.exit(1);
	}
	fs.writeFileSync(path.join(OUT, rel), stringifyDoc(doc));
	console.log("wrote", rel);
}
bakePaths(blob);
bakeTris3(slime);
write("blob.fart", blob);
write("slime.fart", slime);
write("vase.fart", vase);
fs.writeFileSync(path.join(OUT, "shelf.shart"), JSON.stringify(scene, null, 2) + "\n");
console.log("wrote shelf.shart");
void box;
