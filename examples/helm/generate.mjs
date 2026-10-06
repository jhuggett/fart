// examples/helm: the 1.8 demo. A helm whose file holds half a hood: a
// mirror mod makes the other half, solidify gives the steel a thickness
// with a lining inside and a brass rim round the face opening, a crease
// mod bevels the folds, and two levels of subdivision round it all. The
// brow band is painted by face, the hood is darker toward the brim by a
// shade per point, and the plume and the band round the brow are pipes.
// Run: node examples/helm/generate.mjs   (after npm run build -w @fastart/core)
import { asMesh, bakeTris3, stringifyDoc, validate } from "@fastart/core";
import fs from "node:fs";
import path from "node:path";

const OUT = new URL(".", import.meta.url).pathname;
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;

// ------------------------------------------------------------------ the hood
// Half a dome on x >= 0: a crown point on the seam, then rings from the
// crown to the brim, each from the front (-z) round the right to the back.
const CROWN = [0, -9, 0];
const RINGS = [
	{ y: -8, r: 2.6, shade: 1 },
	{ y: -6, r: 4.3, shade: 1 },
	{ y: -3.5, r: 5, shade: 0.92 },
	{ y: -1, r: 5.2, shade: 0.8 },
];
const STEPS = 4; // quarter turns of 45 degrees: the first and the last point of a ring lie on the seam
const points = [CROWN];
const shades = [1];
for (const ring of RINGS) {
	for (let k = 0; k <= STEPS; k++) {
		const a = (k / STEPS) * Math.PI;
		points.push([r3(ring.r * Math.sin(a)), ring.y, r3(-ring.r * Math.cos(a))]);
		shades.push(ring.shade);
	}
}
const at = (ring, k) => 1 + ring * (STEPS + 1) + k;
const faces = [];
const paint = [];
// a face is wound so its normal leaves the middle of the head
const MIDDLE = [0, -4, 0];
const push = (loop, colour) => {
	const [a, b, c] = loop.map((i) => points[i]);
	const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
	const out = [a[0] - MIDDLE[0], a[1] - MIDDLE[1], a[2] - MIDDLE[2]];
	faces.push(n[0] * out[0] + n[1] * out[1] + n[2] * out[2] >= 0 ? loop : [...loop].reverse());
	paint.push(colour);
};
for (let k = 0; k < STEPS; k++) push([0, at(0, k), at(0, k + 1)], 0);
for (let ring = 0; ring + 1 < RINGS.length; ring++) {
	for (let k = 0; k < STEPS; k++) {
		// the face opening: the front quarter of the two lower bands is left out, and solidify rims the hole
		if (ring >= 1 && k === 0) continue;
		// the lowest band is the brow band, in brass
		push([at(ring, k), at(ring, k + 1), at(ring + 1, k + 1), at(ring + 1, k)], ring === RINGS.length - 2 ? 1 : 0);
	}
}
const hood = {
	kind: "mesh", color: "steel", colors: ["brass", "lining"],
	points, faces, paint, shades,
	mods: [
		{ op: "mirror", axis: "x", merge: 0.001 },
		{ op: "solidify", thick: 0.35, offset: -1, inner: 2, rim: 1 },
		{ op: "crease", angle: 50, value: 0.2 },
	],
	smooth: 2,
};

// ------------------------------------------------------------------ the pipes
// a band round the brow: a flat section carried round a closed path
const BAND = 8;
const band = {
	kind: "sweep", color: "brass", op: "pipe", closed: true,
	path: { points: Array.from({ length: BAND }, (_, k) => [r3(5.3 * Math.sin((k / BAND) * Math.PI * 2 + Math.PI / BAND)), -1.2, r3(-5.3 * Math.cos((k / BAND) * Math.PI * 2 + Math.PI / BAND))]) },
	profile: { points: [[-0.2, -0.45], [0.2, -0.45], [0.2, 0.45], [-0.2, 0.45]] },
	normals: "smooth", angle: 40,
};
// the plume: a tube from the crown, up and back, swelling and then tapering to a point
const plume = {
	kind: "sweep", color: "plume", colors: ["brass"], op: "pipe", segments: 6, smooth: 1,
	path: {
		points: [[0, -9, 0], [0, -12.5, 1.5], [0, -12, 5.5], [0, -8, 8]],
		out: [[0, -1.5, 0], [0, -0.8, 1.6], [0, 1.2, 1.4], [0, 0, 0]],
		in: [[0, 0, 0], [0, 1.2, -1], [0, -1, -1.6], [0, -1.6, -0.8]],
	},
	radius: 0.8, radii: [0.5, 1, 0.9, 0],
};
// its socket: a short straight pipe, painted by face (four sides, then the two caps in brass)
const socket = {
	kind: "sweep", color: "steel", colors: ["brass"], op: "pipe", segments: 4,
	path: { points: [[0, -8.6, 0], [0, -9.8, 0]] }, radius: 0.75,
	paint: [0, 0, 0, 0, 1, 1],
};

const helm = {
	version: 1, space: "3d", name: "helm",
	palette: [
		{ name: "steel", rgb: [150, 158, 172, 255] },
		{ name: "brass", rgb: [212, 170, 78, 255] },
		{ name: "lining", rgb: [92, 54, 46, 255] },
		{ name: "plume", rgb: [196, 52, 60, 255] },
	],
	parts: [
		{ name: "hood", pivot: [0, 0, 0], anchors: [{ name: "crown", at: [0, -9, 0], dir: [0, -1, 0] }], shapes: [hood, band] },
		{ name: "plume", parent: "hood", pivot: [0, -9, 0], shapes: [socket, plume] },
	],
	states: [
		{ name: "rest", parts: [{ part: "hood" }, { part: "plume" }] },
		{ name: "nod", parts: [{ part: "hood" }, { part: "plume", rotate: [0.25, 0, 0] }] },
		{ name: "toss", parts: [{ part: "hood" }, { part: "plume", rotate: [-0.2, 0, 0.12] }] },
	],
	clips: [{ name: "sway", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.5, state: "nod", ease: "in-out" }, { t: 1.1, state: "toss", ease: "in-out" }, { t: 1.6, state: "rest", ease: "in-out" }] }],
};

bakeTris3(helm);
const r = validate(helm);
if (r.errors.length) {
	console.error(r.errors);
	process.exit(1);
}
fs.writeFileSync(path.join(OUT, "helm.fart"), stringifyDoc(helm));
const drawn = helm.parts.flatMap((p) => p.shapes).reduce((n, sh) => n + asMesh(sh).faces.length, 0);
console.log(`wrote helm.fart  (${points.length} cage points in the hood, ${drawn} faces drawn)`);
