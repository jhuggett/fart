// examples/curves, the complex ones: a head whose cage carries blend-shape
// morphs (open, smile, frown, pout), a waving flag (a 17×11 grid, six wave
// phases lerped), and a 2D face whose mouth path morphs through visemes.
// Run: node examples/curves/generate-faces.mjs
import { bakePaths, bakeTris3, lathe, stringifyDoc, validate } from "@fastart/core";
import fs from "node:fs";
import path from "node:path";

const OUT = new URL(".", import.meta.url).pathname;
const r3 = (x) => Math.round(x * 1000) / 1000 + 0;
const V = (p) => p.map(r3);

// ------------------------------------------------------------------ head
// a lathe gives the skull: 16 segments round, rings from crown to chin.
// Then the cage is sculpted by moving points: a mouth row dented in, a
// nose pushed out, a jaw. Each morph is the same cage with some points
// moved: a blend shape, the way a face rig works. Smooth 1 rounds it.
const SEG = 16;
const profile = [
	[0, -12], // crown
	[4.2, -11.2],
	[6.2, -9.2],
	[6.9, -6.5],
	[6.7, -3.5],
	[6.0, -1.0], // cheek
	[5.2, 1.6], // mouth row
	[4.4, 3.6], // chin row
	[2.6, 5.2],
	[0, 5.6], // chin point
];
const skull = lathe("skin", profile, "y", SEG);
// which ring and which segment each point is, from the lathe's order (an apex ring is one point)
const ringOf = [];
const segOf = [];
{
	let i = 0;
	profile.forEach(([r], ri) => {
		const n = r <= 0 ? 1 : SEG;
		for (let k = 0; k < n; k++) {
			ringOf[i] = ri;
			segOf[i] = n === 1 ? -1 : k;
			i++;
		}
	});
}
// the front is -z: the lathe puts segment k at angle k/SEG·2π from +x, so the front (−z) is k = 12
const front = (k) => Math.cos(((k - 12) / SEG) * Math.PI * 2); // 1 at the front, −1 at the back
const sculpt = (pts, f) => pts.map((p, i) => (segOf[i] < 0 ? p : V(f([...p], ringOf[i], segOf[i], front(segOf[i])))));
// the rest face: the mouth row dented where it faces front, a nose on the cheek row
const rest = sculpt(skull.points, (p, ri, k, fr) => {
	if (ri === 6 && fr > 0.6) p[2] += 1.4 * (fr - 0.6) * 2.5; // the mouth: in
	if (ri === 5 && k === 12) p[2] -= 1.6; // the nose: out
	if (ri === 5 && (k === 11 || k === 13)) p[2] -= 0.5;
	return p;
});
const morph = (f) => sculpt(rest, f);
const open = morph((p, ri, k, fr) => {
	if (fr <= 0.3) return p;
	const w = (fr - 0.3) / 0.7;
	if (ri === 7) p[1] += 2.4 * w; // the chin row drops
	if (ri === 8) p[1] += 2.0 * w;
	if (ri === 9) p[1] += 1.8;
	if (ri === 6) p[2] += 1.2 * w; // the mouth row sinks deeper: an open mouth
	return p;
});
const smile = morph((p, ri, k, fr) => {
	if (ri === 6 && (k === 10 || k === 14)) {
		p[1] -= 0.9; // the corners up
		p[0] *= 1.12; // and out
	}
	if (ri === 5 && (k === 10 || k === 14)) p[2] -= 0.4; // cheeks out
	if (ri === 6 && k === 12) p[1] += 0.3;
	return p;
});
const frown = morph((p, ri, k, fr) => {
	if (ri === 6 && (k === 10 || k === 14)) p[1] += 0.9; // the corners down
	if (ri === 4 && fr > 0.7) p[1] += 0.4; // the brow row down
	return p;
});
const pout = morph((p, ri, k, fr) => {
	if (ri === 6 && fr > 0.6) {
		p[2] -= 1.4 * (fr - 0.6) * 2.5; // the lips out
		p[0] *= 0.92;
	}
	return p;
});
// the mouth: a lens of eight points round a centre, sitting in the dent; its morphs follow the face's
const lens = (w, h, lift = 0, cornerUp = 0, curl = 0) => {
	const pts = [[0, 1.6 + lift, -5.2]]; // the centre, inside
	for (let k = 0; k < 8; k++) {
		const a = (k / 8) * Math.PI * 2;
		const x = Math.cos(a) * w;
		const y = 1.6 + lift + Math.sin(a) * h + (Math.abs(Math.cos(a)) > 0.9 ? -cornerUp : 0);
		pts.push(V([x, y, -5.9 - curl * (1 - Math.abs(Math.sin(a)))]));
	}
	return pts;
};
const lensFaces = Array.from({ length: 8 }, (_, k) => [0, 1 + ((k + 1) % 8), 1 + k]);
const mouthRest = lens(1.9, 0.35);
const mouthOpen = lens(1.7, 1.5, 0.9);
const mouthSmile = lens(2.6, 0.45, -0.1, 0.7);
const mouthFrown = lens(2.0, 0.35, 0.2, -0.6);
const mouthPout = lens(1.1, 0.7, 0, 0, 0.9);
const mouthPart = (points) => ({ part: "mouth", offset: [0, 1.6, -5.5], ...(points === mouthRest ? {} : { morph: [{ shape: 0, points }] }) });

const head = {
	version: 1,
	space: "3d",
	name: "head",
	palette: [
		{ name: "skin", rgb: [222, 180, 150, 255] },
		{ name: "lip", rgb: [170, 90, 90, 255] },
		{ name: "hair", rgb: [60, 40, 35, 255] },
		{ name: "white", rgb: [245, 245, 240, 255] },
		{ name: "ink", rgb: [30, 30, 36, 255] },
	],
	parts: [
		{
			name: "face", pivot: [0, 5.6, 0],
			shapes: [
				{ kind: "mesh", color: "skin", points: rest, faces: skull.faces, smooth: 1, normals: "smooth", creases: [] },
			],
		},
		{
			name: "hair", parent: "face", pivot: [0, -12, 0],
			shapes: [{ kind: "mesh", color: "hair", smooth: 1, ...(() => {
				const cap = lathe("hair", [[0, -12.8], [4.8, -11.6], [7.1, -8.6], [7.4, -5.2], [6.4, -4.4], [6.6, -8.2], [4.3, -10.8], [0, -11.8]], "y", SEG);
				return { points: cap.points, faces: cap.faces };
			})() }],
		},
		{
			name: "mouth", parent: "face", pivot: [0, 1.6, -5.5],
			shapes: [{ kind: "mesh", color: "lip", points: mouthRest, faces: lensFaces, normals: "smooth" }],
		},
		{
			name: "eyes", parent: "face", pivot: [0, -2.4, -5],
			shapes: [
				{ kind: "ball", color: "white", at: [-2.4, -2.4, -5.3], r: 1.1 },
				{ kind: "ball", color: "ink", at: [-2.4, -2.4, -6.2], r: 0.5 },
				{ kind: "ball", color: "white", at: [2.4, -2.4, -5.3], r: 1.1 },
				{ kind: "ball", color: "ink", at: [2.4, -2.4, -6.2], r: 0.5 },
			],
		},
	],
	states: [
		{ name: "rest", parts: [{ part: "face", offset: [0, 5.6, 0] }, { part: "hair" }, mouthPart(mouthRest), { part: "eyes", offset: [0, -2.4, -5] }] },
		{ name: "open", parts: [{ part: "face", offset: [0, 5.6, 0], morph: [{ shape: 0, points: open }] }, { part: "hair" }, mouthPart(mouthOpen), { part: "eyes", offset: [0, -2.4, -5] }] },
		{ name: "smile", parts: [{ part: "face", offset: [0, 5.6, 0], morph: [{ shape: 0, points: smile }] }, { part: "hair" }, mouthPart(mouthSmile), { part: "eyes", offset: [0, -2.4, -5], scale: 0.92 }] },
		{ name: "frown", parts: [{ part: "face", offset: [0, 5.6, 0], morph: [{ shape: 0, points: frown }] }, { part: "hair" }, mouthPart(mouthFrown), { part: "eyes", offset: [0, -2.2, -5] }] },
		{ name: "pout", parts: [{ part: "face", offset: [0, 5.6, 0], morph: [{ shape: 0, points: pout }] }, { part: "hair" }, mouthPart(mouthPout), { part: "eyes", offset: [0, -2.4, -5] }] },
		{ name: "blink", parts: [{ part: "face", offset: [0, 5.6, 0] }, { part: "hair" }, mouthPart(mouthRest), { part: "eyes", offset: [0, -2.4, -5], scale: 0.15 }] },
	],
	clips: [
		{ name: "talk", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.18, state: "open", ease: "out" }, { t: 0.36, state: "rest", ease: "in" }, { t: 0.5, state: "pout", ease: "in-out" }, { t: 0.7, state: "open", ease: "in-out" }, { t: 0.9, state: "smile", ease: "in-out" }, { t: 1.3, state: "rest", ease: "in-out" }] },
		{ name: "moods", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.6, state: "smile", ease: "in-out" }, { t: 1.4, state: "frown", ease: "in-out" }, { t: 2.0, state: "pout", ease: "in-out" }, { t: 2.6, state: "rest", ease: "in-out" }] },
		{ name: "blink", keys: [{ t: 0, state: "rest" }, { t: 0.1, state: "blink", ease: "in" }, { t: 0.22, state: "rest", ease: "out" }] },
	],
};
delete head.parts[0].shapes[0].creases;

// ------------------------------------------------------------------ flag
// a 17×11 grid of quads on a pole; six states carry the wave at six
// phases, so the clip lerps cage to cage and the cloth travels.
const NX = 17;
const NY = 11;
const grid = [];
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) grid.push([i * 1.0, -10 + j * 1.0, 0]);
// cloth is two-sided: every quad once facing the viewer (−z) and once facing away, since a face
// wound away from the eye is culled; the angle keeps the two sides' normals apart
const quads = [];
for (let j = 0; j + 1 < NY; j++) for (let i = 0; i + 1 < NX; i++) {
	const a = j * NX + i;
	quads.push([a, a + NX, a + NX + 1, a + 1]);
}
const twoSided = [...quads, ...quads.map((q) => [...q].reverse())];
const wave = (phase) => grid.map(([x, y]) => V([x, y + 0.15 * Math.sin(x * 0.6 + phase) * (x / 16), 1.6 * Math.sin(x * 0.55 - phase) * (x / 16) + 0.5 * Math.sin(y * 0.9 + phase) * (x / 16)]));
const PHASES = 6;
const flag = {
	version: 1,
	space: "3d",
	name: "flag",
	palette: [
		{ name: "cloth", rgb: [200, 60, 70, 255] },
		{ name: "pole", rgb: [120, 110, 100, 255] },
		{ name: "brass", rgb: [210, 170, 80, 255] },
	],
	parts: [
		{
			name: "pole", pivot: [0, 6, 0],
			shapes: [{ kind: "rod", color: "pole", a: [-0.3, 6, 0], b: [-0.3, -12, 0], w: 0.6 }, { kind: "ball", color: "brass", at: [-0.3, -12.3, 0], r: 0.5 }],
		},
		{
			name: "cloth", parent: "pole", pivot: [0, -10, 0],
			shapes: [{ kind: "mesh", color: "cloth", normals: "smooth", angle: 100, points: grid.map(V), faces: twoSided }],
		},
	],
	states: [
		{ name: "still", parts: [{ part: "pole" }, { part: "cloth" }] },
		...Array.from({ length: PHASES }, (_, k) => ({ name: `wave${k}`, parts: [{ part: "pole" }, { part: "cloth", morph: [{ shape: 0, points: wave((k / PHASES) * Math.PI * 2) }] }] })),
	],
	clips: [
		{ name: "wave", loop: true, keys: Array.from({ length: PHASES + 1 }, (_, k) => ({ t: k * 0.2, state: `wave${k % PHASES}` })) },
	],
};

// ------------------------------------------------------------------ face (2D): a mouth path through visemes
const K = 0.5523;
const oval = (rx, ry, cx = 0, cy = 0) => ({
	points: [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]],
	out: [[rx * K, 0], [0, ry * K], [-rx * K, 0], [0, -ry * K]],
	in: [[-rx * K, 0], [0, -ry * K], [rx * K, 0], [0, ry * K]],
});
// the mouth: six vertices, corners, upper lip, lower lip; each viseme moves them and their handles
const mouth = {
	rest: { points: [[-3.5, 3], [-1.5, 2.6], [1.5, 2.6], [3.5, 3], [1.5, 3.6], [-1.5, 3.6]], out: [[0.6, -0.3], [1, 0], [0.8, 0.2], [-0.6, 0.3], [-1, 0], [-0.8, -0.2]], in: [[-0.6, 0.3], [-1, 0], [-0.8, -0.2], [0.6, -0.3], [1, 0], [0.8, 0.2]] },
	A: { points: [[-3.2, 3], [-1.6, 1.6], [1.6, 1.6], [3.2, 3], [1.6, 5.2], [-1.6, 5.2]], out: [[0.4, -0.8], [1, 0], [0.6, 0.7], [-0.4, 0.8], [-1, 0], [-0.6, -0.7]], in: [[-0.4, 0.8], [-1, 0], [-0.6, -0.7], [0.4, -0.8], [1, 0], [0.6, 0.7]] },
	O: { points: [[-1.8, 3], [-0.8, 1.8], [0.8, 1.8], [1.8, 3], [0.8, 4.4], [-0.8, 4.4]], out: [[0.2, -0.7], [0.5, 0], [0.5, 0.5], [-0.2, 0.7], [-0.5, 0], [-0.5, -0.5]], in: [[-0.2, 0.7], [-0.5, 0], [-0.5, -0.5], [0.2, -0.7], [0.5, 0], [0.5, 0.5]] },
	E: { points: [[-4.2, 2.8], [-1.6, 2.2], [1.6, 2.2], [4.2, 2.8], [1.6, 3.8], [-1.6, 3.8]], out: [[0.8, -0.3], [1.2, 0], [0.9, 0.2], [-0.8, 0.3], [-1.2, 0], [-0.9, -0.2]], in: [[-0.8, 0.3], [-1.2, 0], [-0.9, -0.2], [0.8, -0.3], [1.2, 0], [0.9, 0.2]] },
	M: { points: [[-3, 3], [-1.4, 2.95], [1.4, 2.95], [3, 3], [1.4, 3.1], [-1.4, 3.1]], out: [[0.6, 0], [1, 0], [0.8, 0], [-0.6, 0], [-1, 0], [-0.8, 0]], in: [[-0.6, 0], [-1, 0], [-0.8, 0], [0.6, 0], [1, 0], [0.8, 0]] },
	smile: { points: [[-4.2, 2.2], [-1.5, 2.9], [1.5, 2.9], [4.2, 2.2], [1.5, 4.2], [-1.5, 4.2]], out: [[0.6, 0.5], [1, 0], [0.8, -0.3], [-0.6, -0.5], [-1, 0], [-0.8, 0.3]], in: [[-0.6, -0.5], [-1, 0], [-0.8, 0.3], [0.6, 0.5], [1, 0], [0.8, -0.3]] },
};
const browL = { points: [[-5, -4.6], [-2.2, -5.2]], out: [[1.2, -0.8], [0, 0]], in: [[0, 0], [-1.2, 0.2]] };
const face = {
	version: 1,
	name: "face",
	palette: [
		{ name: "skin", rgb: [240, 200, 170, 255] },
		{ name: "lip", rgb: [190, 80, 90, 255] },
		{ name: "mouth", rgb: [70, 20, 30, 255] },
		{ name: "ink", rgb: [40, 30, 36, 255] },
		{ name: "white", rgb: [250, 250, 245, 255] },
	],
	parts: [
		{ name: "head", pivot: [0, 0], shapes: [{ kind: "path", color: "skin", closed: true, ...oval(9, 11) }] },
		{
			name: "brows", parent: "head", pivot: [0, -5],
			shapes: [
				{ kind: "path", color: "ink", w: 0.7, ...browL },
				{ kind: "path", color: "ink", w: 0.7, points: browL.points.map(([x, y]) => [-x, y]), out: browL.out.map(([x, y]) => [-x, y]), in: browL.in.map(([x, y]) => [-x, y]) },
			],
		},
		{
			name: "eyes", parent: "head", pivot: [0, -2.5],
			shapes: [
				{ kind: "path", color: "white", closed: true, ...oval(1.7, 1.2, -3.4, -2.5) },
				{ kind: "circle", color: "ink", at: [-3.2, -2.4], r: 0.6 },
				{ kind: "path", color: "white", closed: true, ...oval(1.7, 1.2, 3.4, -2.5) },
				{ kind: "circle", color: "ink", at: [3.6, -2.4], r: 0.6 },
			],
		},
		{ name: "mouth", parent: "head", pivot: [0, 3], shapes: [{ kind: "path", color: "mouth", closed: true, ...mouth.rest }] },
	],
	states: Object.entries(mouth).map(([name, m]) => ({
		name,
		parts: [{ part: "head" }, { part: "brows", ...(name === "A" || name === "O" ? { offset: [0, -5.6] } : {}) }, { part: "eyes", ...(name === "smile" ? { scale: 0.9 } : {}) }, { part: "mouth", ...(name === "rest" ? {} : { morph: [{ shape: 0, points: m.points, in: m.in, out: m.out }] }) }],
	})),
	clips: [
		{ name: "speak", loop: true, keys: [{ t: 0, state: "rest" }, { t: 0.15, state: "A", ease: "out" }, { t: 0.3, state: "M", ease: "in" }, { t: 0.45, state: "O", ease: "out" }, { t: 0.6, state: "E", ease: "in-out" }, { t: 0.75, state: "M", ease: "in" }, { t: 0.9, state: "A", ease: "out" }, { t: 1.1, state: "smile", ease: "in-out" }, { t: 1.5, state: "rest", ease: "in-out" }] },
	],
};

function write(rel, doc) {
	const r = validate(doc);
	if (r.errors.length) {
		console.error(rel, r.errors);
		process.exit(1);
	}
	fs.writeFileSync(path.join(OUT, rel), stringifyDoc(doc));
	console.log("wrote", rel, `(${(fs.statSync(path.join(OUT, rel)).size / 1024).toFixed(0)} KB)`);
}
bakeTris3(head);
bakeTris3(flag);
bakePaths(face);
write("head.fart", head);
write("flag.fart", flag);
write("face.fart", face);
console.log("head cage points:", rest.length, "faces:", skull.faces.length, "· flag points:", grid.length, "faces:", twoSided.length);
