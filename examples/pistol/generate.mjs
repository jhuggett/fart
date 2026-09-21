// examples/pistol: a flintlock pistol modelled once in 3D (space: "3d"),
// then projected to the 2D views a game draws: the side, the top, the
// front. Run `node examples/pistol/generate.mjs` after building core.
//
// The model faces -z (the muzzle points at the viewer in the front
// view), so `left` is the profile with the muzzle to the right and `top`
// is the top-down sprite with the muzzle up.
import { bakeTris3, projectDoc, stringifyDoc, validate } from "@fastart/core";
import fs from "node:fs";
import path from "node:path";

const OUT = new URL(".", import.meta.url).pathname;

// ---- helpers: outward-wound meshes from profiles
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const inside = (p, poly) => {
	let ins = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i];
		const b = poly[j];
		if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins;
	}
	return ins;
};
/**
 * Extrude a 2D profile along an axis. `profile` is a list of [u, v]
 * pairs in the plane's other two coordinates, in order (either winding);
 * `axis` is "x" or "z"; the solid runs from `from` to `to` on that axis.
 * For axis x the profile is [z, y]; for axis z it is [x, y].
 */
function extrude(color, profile, axis, from, to, extra = {}) {
	const lift = (uv, a) => (axis === "x" ? [a, uv[1], uv[0]] : [uv[0], uv[1], a]);
	const n = profile.length;
	const points = [...profile.map((uv) => lift(uv, from)), ...profile.map((uv) => lift(uv, to))];
	const faces = [];
	// caps: normal along -axis at `from`, +axis at `to` (from < to)
	const axisIdx = axis === "x" ? 0 : 2;
	const capA = profile.map((_, i) => i);
	const capB = profile.map((_, i) => i + n);
	const fix = (face, want) => {
		// Newell's method: the normal of the whole loop, right for concave profiles too
		const nn = [0, 0, 0];
		for (let k = 0; k < face.length; k++) {
			const a = points[face[k]];
			const b = points[face[(k + 1) % face.length]];
			nn[0] += (a[1] - b[1]) * (a[2] + b[2]);
			nn[1] += (a[2] - b[2]) * (a[0] + b[0]);
			nn[2] += (a[0] - b[0]) * (a[1] + b[1]);
		}
		return dot(nn, want) >= 0 ? face : [...face].reverse();
	};
	const lo = from < to ? from : to;
	const hi = from < to ? to : from;
	const wantA = [0, 0, 0];
	wantA[axisIdx] = from === lo ? -1 : 1;
	const wantB = [0, 0, 0];
	wantB[axisIdx] = to === hi ? 1 : -1;
	faces.push(fix(capA, wantA), fix(capB, wantB));
	// sides: outward is away from the profile's interior
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		const quad = [i, j, j + n, i + n];
		const mid = [(profile[i][0] + profile[j][0]) / 2, (profile[i][1] + profile[j][1]) / 2];
		const e = [profile[j][0] - profile[i][0], profile[j][1] - profile[i][1]];
		const len = Math.hypot(e[0], e[1]) || 1;
		const out2 = [e[1] / len, -e[0] / len]; // a perpendicular; which side is outside is tested
		const probe = [mid[0] + out2[0] * 1e-3, mid[1] + out2[1] * 1e-3];
		const outward2 = inside(probe, profile) ? [-out2[0], -out2[1]] : out2;
		const want = axis === "x" ? [0, outward2[1], outward2[0]] : [outward2[0], outward2[1], 0];
		faces.push(fix(quad, want));
	}
	return { kind: "mesh", color, points: points.map((p) => p.map((c) => +c.toFixed(3))), faces, ...extra };
}
const octagon = (cx, cy, r) => Array.from({ length: 8 }, (_, i) => [+(cx + r * Math.cos((i / 8) * Math.PI * 2 + Math.PI / 8)).toFixed(3), +(cy + r * Math.sin((i / 8) * Math.PI * 2 + Math.PI / 8)).toFixed(3)]);
const ball = (color, at, r) => ({ kind: "ball", color, at, r });
const rod = (color, a, b, w) => ({ kind: "rod", color, a, b, w });

// ---- the pistol: z runs along the barrel, muzzle at -z; y down; x across (the lock is on the +x side)
const stockProfile = [
	[-11, 0.9], [2.5, 0.9], [3.5, 1.5], [4.5, 4], [6.5, 7.5], [7.5, 9.5], [4.5, 10.2], [2.5, 8.2], [1.2, 4.2], [0, 2.9], [-11, 2.4],
];
const hammerProfile = [
	[2.2, 2.6], [3.2, 2.6], [3.4, 0.6], [2.9, -0.9], [2.0, -1.3], [1.6, -0.6], [2.2, -0.2], [2.5, 0.8],
];
const frizzenProfile = [
	[-1.4, 0.4], [-0.6, 0.4], [-0.6, -1.4], [-1.0, -1.8], [-1.4, -1.4],
];
const triggerProfile = [
	[2.6, 3.0], [3.4, 3.0], [3.7, 4.8], [3.1, 5.5], [2.4, 4.7],
];

// the wood grain: a texture is a drawing, tiled over a cell (1.5); the stock is box mapped with it
const grain = {
	version: 1,
	name: "grain",
	palette: [{ name: "grain", rgb: [86, 54, 30, 255] }, { name: "grain_light", rgb: [150, 104, 62, 255] }],
	parts: [
		{
			name: "grain", pivot: [0, 0],
			shapes: [
				...[0.4, 1.3, 2.1, 3.3, 4.2, 5.1].map((y, i) => ({ kind: "poly", color: i % 2 ? "grain_light" : "grain", points: [[0, y], [2.5, y + 0.15], [5, y - 0.1], [8, y + 0.12], [8, y + 0.32], [5, y + 0.12], [2.5, y + 0.37], [0, y + 0.22]] })),
				{ kind: "circle", color: "grain", at: [5.6, 2.7], r: 0.5 },
				{ kind: "circle", color: "grain_light", at: [5.6, 2.7], r: 0.22 },
			],
		},
	],
	states: [{ name: "all", parts: [{ part: "grain" }] }],
};

const pistol = {
	version: 1,
	space: "3d",
	name: "flintlock",
	textures: [{ name: "grain", cell: [8, 6], maps: { color: { ref: "textures/grain.fart" } } }],
	palette: [
		{ name: "wood", rgb: [122, 82, 48, 255] },
		{ name: "steel", rgb: [168, 176, 186, 255] },
		{ name: "brass", rgb: [214, 176, 84, 255] },
		{ name: "flash", rgb: [255, 220, 120, 255], emissive: 2 },
	],
	parts: [
		{
			name: "stock", pivot: [0, 1.6, 0],
			shapes: [
				{ ...extrude("wood", stockProfile, "x", -1.0, 1.0), texture: "grain", mapping: { scale: 1 } },
				rod("brass", [0, 2.75, -12.5], [0, 2.75, 0.5], 0.35), // the ramrod, proud under the fore-end
				ball("brass", [0, 9.9, 6.0], 1.15), // the butt cap
			],
			anchors: [{ name: "grip", at: [0, 6.5, 5.2], dir: [0, 0, -1] }],
		},
		{
			name: "barrel", parent: "stock", pivot: [0, 0, 2],
			shapes: [
				extrude("steel", octagon(0, 0, 0.95), "z", -14.5, 2.0),
				ball("brass", [0, -1.1, -14.0], 0.25), // the bead sight
			],
			anchors: [{ name: "muzzle", at: [0, 0, -14.5], dir: [0, 0, -1] }],
		},
		{
			name: "lock", parent: "stock", pivot: [1.2, 1.8, 1.5],
			shapes: [extrude("steel", [[-1.8, 0.4], [3.6, 0.4], [4.2, 1.6], [3.8, 3.4], [-1.2, 3.4], [-1.8, 2.2]], "x", 1.0, 1.4)],
			anchors: [{ name: "pan", at: [1.4, 0.4, -0.3], dir: [0, -1, 0] }],
		},
		{ name: "hammer", parent: "lock", pivot: [1.5, 2.0, 2.6], shapes: [extrude("steel", hammerProfile, "x", 1.4, 1.9)] },
		{ name: "frizzen", parent: "lock", pivot: [1.5, 0.4, -0.6], shapes: [extrude("steel", frizzenProfile, "x", 1.3, 1.8)] },
		{ name: "trigger", parent: "stock", pivot: [0, 3.1, 3.0], shapes: [extrude("brass", triggerProfile, "x", -0.3, 0.3)] },
		{
			name: "guard", parent: "stock", pivot: [0, 3.2, 1.6],
			shapes: [rod("brass", [0, 3.2, 1.6], [0, 6.2, 3.2], 0.35), rod("brass", [0, 6.2, 3.2], [0, 3.8, 5.6], 0.35)],
		},
	],
	states: [
		{ name: "rest", parts: [{ part: "stock" }, { part: "barrel" }, { part: "lock" }, { part: "frizzen" }, { part: "hammer" }, { part: "trigger" }, { part: "guard" }] },
		{ name: "cocked", parts: [{ part: "stock" }, { part: "barrel" }, { part: "lock" }, { part: "frizzen" }, { part: "hammer", rotate: [0.9, 0, 0] }, { part: "trigger" }, { part: "guard" }] },
		{ name: "fired", parts: [{ part: "stock" }, { part: "barrel" }, { part: "lock" }, { part: "frizzen", rotate: [1.3, 0, 0] }, { part: "hammer", rotate: [-0.55, 0, 0] }, { part: "trigger", rotate: [-0.35, 0, 0] }, { part: "guard" }] },
		{ name: "lowered", parts: [{ part: "stock", rotate: [0.35, 0, 0] }, { part: "barrel" }, { part: "lock" }, { part: "frizzen" }, { part: "hammer" }, { part: "trigger" }, { part: "guard" }] },
	],
	clips: [
		{ name: "cock", keys: [{ t: 0, state: "rest" }, { t: 0.3, state: "cocked", ease: "out", events: ["click"] }] },
		{ name: "fire", keys: [{ t: 0, state: "cocked" }, { t: 0.07, state: "fired", ease: "in", events: ["flash"] }, { t: 0.5, state: "fired" }, { t: 0.9, state: "rest", ease: "in-out" }] },
		{ name: "lower", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.6, state: "lowered", ease: "in-out" }, { t: 1.2, state: "rest", ease: "in-out" }] },
	],
	meta: { note: "a flintlock, modelled once; the 2D files beside it are fart project's" },
};

bakeTris3(pistol);
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
write("textures/grain.fart", grain);
write("flintlock.fart", pistol);
const outline = { color: "ink", w: 0.25 };
for (const view of ["left", "top", "front"]) {
	const d = projectDoc(pistol, { view, from: "flintlock.fart", outline });
	d.palette.push({ name: "ink", rgb: [30, 26, 34, 255] });
	write(`flintlock-${view}.fart`, d);
}
