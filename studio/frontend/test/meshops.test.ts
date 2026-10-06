// The mesh operations, as geometry: what they do to counts, to the
// manifold, to the winding (by the volume a closed solid encloses), to
// creases, to pattern coordinates and to a morph carried through.
// `npm test -w @fastart/studio`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { box, lathe, validate } from "../../../packages/core/src/index.ts";
import {
	MeshError,
	bridgeRims,
	carryPoints,
	creaseByAngle,
	creaseOf,
	deleteFaces,
	edgeRing,
	extrudeEdges,
	extrudeFaces,
	fillRim,
	flipFaces,
	hasEdge,
	insetFaces,
	inspect,
	loopCut,
	mergeCorners,
	mirrorMap,
	rims,
	setCreases,
	sharpEdges,
	signedVolume,
	windOutward,
	withMirrorEdges,
	withMirrorFaces,
	faceNormal,
	type Cage,
	type V3,
} from "../src/state/meshops.ts";

const cube = (size: V3 = [2, 2, 2], centre: V3 = [0, 0, 0]): Cage => {
	const m = box("ink", centre, size);
	return { points: m.points.map((p) => [...p] as V3), faces: m.faces.map((f) => [...f]) };
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
/** the face whose normal points most along a direction */
const faceToward = (c: Cage, d: V3) => {
	let best = 0;
	let bestDot = -Infinity;
	c.faces.forEach((f, i) => {
		const n = faceNormal(c.points, f);
		const l = Math.hypot(...n) || 1;
		const k = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l;
		if (k > bestDot) {
			bestDot = k;
			best = i;
		}
	});
	return best;
};
/** the result as a document, through the format's validator */
const valid = (c: Cage) => {
	const r = validate({ version: 1, space: "3d", palette: [{ name: "ink", rgb: [0, 0, 0, 255] }], parts: [{ name: "a", pivot: [0, 0, 0], shapes: [{ kind: "mesh", color: "ink", points: c.points, faces: c.faces, ...(c.creases ? { creases: c.creases } : {}) }] }] });
	assert.deepEqual(r.errors, []);
};
const solid = (c: Cage, what: string) => {
	const r = inspect(c);
	assert.ok(r.manifold, `${what}: manifold (crowded ${r.crowded}, disagree ${r.disagree})`);
	assert.ok(r.closed, `${what}: closed (open edges ${r.open})`);
	assert.ok(r.volume > 0, `${what}: winds outward (volume ${r.volume})`);
	valid(c);
	return r;
};

test("a box from core is a closed manifold that winds outward", () => {
	const r = solid(cube(), "cube");
	assert.equal(r.points, 8);
	assert.equal(r.faces, 6);
	assert.equal(r.edges, 12);
	assert.ok(near(r.volume, 8));
});

test("extrude one face: five new faces, the volume grows by area times amount", () => {
	const c = cube();
	const f = faceToward(c, [0, 0, 1]);
	const r = extrudeFaces(c, [f], 0.5);
	const rep = solid(r.cage, "extruded cube");
	assert.equal(rep.points, 12);
	assert.equal(rep.faces, 10);
	assert.ok(near(rep.volume, 8 + 4 * 0.5, 1e-3));
	assert.deepEqual(r.faces, [f]);
	// the chosen face moved along its normal and still faces the same way
	assert.equal(faceToward(r.cage, [0, 0, 1]), f);
	assert.ok(r.cage.faces[f].every((v) => near(r.cage.points[v][2], 1.5)));
	// a negative amount digs in
	assert.ok(near(solid(extrudeFaces(c, [f], -0.5).cage, "dug cube").volume, 8 - 2, 1e-3));
});

test("extrude two faces that share an edge: one region, no wall between them", () => {
	const c = cube();
	const a = faceToward(c, [0, 0, 1]);
	const b = faceToward(c, [1, 0, 0]);
	const r = extrudeFaces(c, [a, b], 0.25);
	const rep = solid(r.cage, "corner extrude");
	// 6 border edges: 6 walls; 6 border corners doubled
	assert.equal(rep.faces, 12);
	assert.equal(rep.points, 14);
});

test("extruding every face of a closed mesh fattens it, with no new points", () => {
	const c = cube();
	const r = extrudeFaces(c, c.faces.map((_, i) => i), 0.5);
	const rep = solid(r.cage, "fat cube");
	assert.equal(rep.points, 8);
	assert.equal(rep.faces, 6);
	assert.ok(near(rep.volume, 27, 1e-2));
});

test("inset a face: a ring of quads, the inner face kept and smaller, the volume unchanged", () => {
	const c = cube();
	const f = faceToward(c, [0, -1, 0]);
	const r = insetFaces(c, [f], 0.25);
	const rep = solid(r.cage, "inset cube");
	assert.equal(rep.faces, 10);
	assert.equal(rep.points, 12);
	assert.ok(near(rep.volume, 8, 1e-6));
	const inner = r.cage.faces[f].map((v) => r.cage.points[v]);
	assert.ok(inner.every((p) => near(Math.abs(p[0]), 0.75) && near(Math.abs(p[2]), 0.75) && near(p[1], -1)));
	// raised: the inner face lifts along the normal
	const up = insetFaces(c, [f], 0.25, 0.5);
	assert.ok(up.cage.faces[f].every((v) => near(up.cage.points[v][1], -1.5)));
	assert.ok(solid(up.cage, "raised inset").volume > 8);
});

test("inset refuses the whole of a closed mesh, with a reason", () => {
	const c = cube();
	assert.throws(() => insetFaces(c, c.faces.map((_, i) => i), 0.1), MeshError);
	assert.throws(() => insetFaces(c, [], 0.1), /Choose a face/);
	assert.throws(() => extrudeFaces(c, [99], 0.1), /no face 99/);
});

test("loop cut round a cube: four faces become eight, at the fraction asked", () => {
	const c = cube();
	const f = c.faces[faceToward(c, [0, 0, 1])];
	// an edge of the front face that runs along x
	let e: [number, number] = [f[0], f[1]];
	for (let i = 0; i < 4; i++) {
		const a = f[i];
		const b = f[(i + 1) % 4];
		if (c.points[a][1] === c.points[b][1]) e = [a, b];
	}
	assert.equal(edgeRing(c, e[0], e[1]).length, 4);
	const r = loopCut(c, e[0], e[1], 0.25);
	const rep = solid(r.cage, "cut cube");
	assert.equal(rep.points, 12);
	assert.equal(rep.faces, 10);
	assert.ok(near(rep.volume, 8));
	assert.equal(r.edges!.length, 4);
	// no face is renumbered: a cut face keeps its place as one half, and every other face is where it was
	const ringFaces = new Set(c.faces.map((g, i) => (g.some((v, k) => edgeRing(c, e[0], e[1]).some(([p, q]) => (p === v && q === g[(k + 1) % 4]) || (q === v && p === g[(k + 1) % 4]))) ? i : -1)).filter((i) => i >= 0));
	c.faces.forEach((g, i) => {
		if (!ringFaces.has(i)) assert.deepEqual(r.cage.faces[i], g);
		assert.equal(r.faceFrom[i], i);
	});
	assert.deepEqual(r.faceFrom.slice(c.faces.length).sort(), [...ringFaces].sort());
	const x = c.points[e[0]][0] + (c.points[e[1]][0] - c.points[e[0]][0]) * 0.25;
	for (const [a, b] of r.edges!) {
		assert.ok(near(r.cage.points[a][0], x) && near(r.cage.points[b][0], x), "the loop lies in one plane");
		assert.ok(hasEdge(r.cage, a, b));
	}
	assert.throws(() => loopCut(c, e[0], e[1], 1), /fraction/);
	assert.throws(() => loopCut(c, f[0], f[2], 0.5), /not an edge/);
});

test("a loop cut that ends at a face that is not a quad leaves no gap there", () => {
	// a lathe's side quads run into its cap faces
	const m = lathe("ink", [[1, -1], [1, 1]], "y", 6);
	const c: Cage = { points: m.points.map((p) => [...p] as V3), faces: m.faces.map((f) => [...f]) };
	solid(c, "prism");
	const quad = c.faces.find((f) => f.length === 4)!;
	// an edge that runs along the axis: its ring is one quad, ending at... the round: cut round the prism instead
	let along: [number, number] | null = null;
	let round: [number, number] | null = null;
	for (let i = 0; i < 4; i++) {
		const a = quad[i];
		const b = quad[(i + 1) % 4];
		if (Math.abs(c.points[a][1] - c.points[b][1]) > 1) along = [a, b];
		else round = [a, b];
	}
	const r1 = loopCut(c, along![0], along![1], 0.5);
	assert.equal(solid(r1.cage, "prism cut round").faces, c.faces.length + 6);
	// across the caps: two quads at most are cut and the caps take the new corners
	const r2 = loopCut(c, round![0], round![1], 0.5);
	const rep = solid(r2.cage, "prism cut along");
	assert.ok(rep.faces > c.faces.length);
	assert.ok(r2.cage.faces.some((f) => f.length === 7), "a cap gained a corner");
});

test("delete a face opens a rim; fill closes it again", () => {
	const c = cube();
	const f = faceToward(c, [0, 0, 1]);
	const open = deleteFaces(c, [f]);
	const rep = inspect(open.cage);
	assert.equal(rep.faces, 5);
	assert.equal(rep.points, 8);
	assert.ok(rep.manifold && !rep.closed);
	assert.equal(rep.open, 4);
	assert.equal(rep.rims.length, 1);
	assert.equal(rep.rims[0].length, 4);
	const closed = fillRim(open.cage, [rep.rims[0][0], rep.rims[0][1]]);
	assert.ok(near(solid(closed.cage, "refilled cube").volume, 8));
	assert.throws(() => fillRim(c, [0, 1]), /not on a rim/);
	assert.throws(() => deleteFaces(c, c.faces.map((_, i) => i)), /every face/);
});

test("deleting faces drops the corners nothing uses, and remaps the rest", () => {
	const c = cube();
	const a = faceToward(c, [0, 0, 1]);
	const b = faceToward(c, [1, 0, 0]);
	const d = faceToward(c, [0, 1, 0]);
	const r = deleteFaces(c, [a, b, d]);
	// the corner the three shared is gone
	assert.equal(r.cage.points.length, 7);
	assert.ok(r.cage.faces.every((f) => f.every((v) => v >= 0 && v < 7)));
	assert.equal(r.src.length, 7);
	valid(r.cage);
});

test("bridge two rims: two open boxes become one tube, wound outward", () => {
	const lo = deleteFaces(cube([2, 2, 2], [0, 0, 0]), [faceToward(cube(), [0, 0, 1])]).cage;
	const hiBox = cube([2, 2, 2], [0, 0, 5]);
	const hi = deleteFaces(hiBox, [faceToward(hiBox, [0, 0, -1])]).cage;
	const both: Cage = { points: [...lo.points, ...hi.points], faces: [...lo.faces, ...hi.faces.map((f) => f.map((v) => v + lo.points.length))] };
	const rs = rims(both);
	assert.equal(rs.length, 2);
	const r = bridgeRims(both, [rs[0][0], rs[0][1]], [rs[1][0], rs[1][1]]);
	const rep = solid(r.cage, "bridged boxes");
	assert.equal(rep.faces, 14);
	assert.equal(rep.points, 16);
	// two boxes of 8 and the 2 x 2 x 3 between them
	assert.ok(near(rep.volume, 8 + 8 + 12, 1e-6));
	assert.equal(r.faces!.length, 4);
	assert.throws(() => bridgeRims(both, [rs[0][0], rs[0][1]], [rs[0][1], rs[0][2]]), /same rim/);
});

test("bridge refuses rims of different counts", () => {
	const a = deleteFaces(cube(), [0]).cage;
	const m = lathe("ink", [[1, 4], [1, 6]], "z", 6);
	const p: Cage = { points: m.points.map((q) => [...q] as V3), faces: m.faces.map((f) => [...f]) };
	const open = deleteFaces(p, [p.faces.findIndex((f) => f.length === 6)]).cage;
	const both: Cage = { points: [...a.points, ...open.points], faces: [...a.faces, ...open.faces.map((f) => f.map((v) => v + a.points.length))] };
	const rs = rims(both);
	assert.equal(rs.length, 2);
	assert.throws(() => bridgeRims(both, rs[0][0], rs[1][0]), /same count/);
});

test("extrude a rim: a band of quads grows from the open edges", () => {
	const c = cube();
	const open = deleteFaces(c, [faceToward(c, [0, 0, 1])]).cage;
	const rim = rims(open)[0];
	const edges = rim.map((v, i) => [v, rim[(i + 1) % rim.length]] as [number, number]);
	const along = extrudeEdges(open, edges, { dir: [0, 0, 1] });
	let rep = inspect(along.cage);
	assert.ok(rep.manifold);
	assert.equal(rep.faces, 9);
	assert.equal(rep.points, 12);
	assert.equal(rep.rims.length, 1);
	assert.ok(rep.rims[0].every((v) => near(along.cage.points[v][2], 2)));
	// filled, it is a taller box that winds outward: the band was wound with its neighbours
	assert.ok(near(solid(fillRim(along.cage, rep.rims[0][0]).cage, "taller box").volume, 12));
	// outward: in the plane of each edge's face, so a box's rim keeps going the way its walls were
	const out = extrudeEdges(open, edges, { amount: 1 });
	rep = inspect(out.cage);
	assert.ok(rep.manifold);
	assert.ok(rep.rims[0].every((v) => out.cage.points[v][2] > 1.5));
	assert.equal(out.edges!.length, 4);
	assert.throws(() => extrudeEdges(c, [[c.faces[0][0], c.faces[0][1]]], { amount: 1 }), /open edge/);
});

test("merge corners: a doubled seam welds into a closed solid", () => {
	// two open boxes face to face, their rims on the same four points but not shared
	const aBox = cube([2, 2, 2], [0, 0, 0]);
	const a = deleteFaces(aBox, [faceToward(aBox, [0, 0, 1])]).cage;
	const bBox = cube([2, 2, 2], [0, 0, 2]);
	const b = deleteFaces(bBox, [faceToward(bBox, [0, 0, -1])]).cage;
	const both: Cage = { points: [...a.points, ...b.points], faces: [...a.faces, ...b.faces.map((f) => f.map((v) => v + a.points.length))] };
	assert.equal(inspect(both).open, 8);
	const r = mergeCorners(both, 0.001);
	const rep = solid(r.cage, "welded boxes");
	assert.equal(rep.points, 12);
	assert.equal(rep.faces, 10);
	assert.ok(near(rep.volume, 16));
	assert.throws(() => mergeCorners(cube(), 0.001), /No two corners/);
	// only the named ones
	const one = mergeCorners(cube(), 5, [0, 1]);
	assert.equal(one.cage.points.length, 7);
});

test("flip turns a face; wind outward puts it back, piece by piece", () => {
	const c = cube();
	const flipped = flipFaces(c, [0, 3]).cage;
	const bad = inspect(flipped);
	assert.ok(!bad.manifold && bad.disagree > 0);
	const fixed = windOutward(flipped);
	assert.match(fixed.note, /Turned 2 faces/);
	assert.ok(near(solid(fixed.cage, "rewound cube").volume, 8));
	// a whole solid inside out, and a second piece that is right
	const inside = flipFaces(c, c.faces.map((_, i) => i)).cage;
	assert.ok(signedVolume(inside.points, inside.faces) < 0);
	const other = cube([1, 1, 1], [5, 0, 0]);
	const two: Cage = { points: [...inside.points, ...other.points], faces: [...inside.faces, ...other.faces.map((f) => f.map((v) => v + 8))] };
	const out = windOutward(two);
	assert.match(out.note, /Turned 6 faces/);
	assert.ok(near(solid(out.cage, "two pieces").volume, 9));
	assert.match(windOutward(out.cage).note, /already/);
});

test("creases: set on a selection, cleared at 0, found by angle", () => {
	const c = cube();
	const f = c.faces[0];
	const edges: [number, number][] = [[f[0], f[1]], [f[2], f[1]]];
	let r = setCreases(c, edges, 0.6);
	assert.equal(r.cage.creases!.length, 2);
	assert.equal(creaseOf(r.cage, f[1], f[0]), 0.6);
	assert.ok(r.cage.creases!.every((e) => e[0] < e[1]));
	// set again: replaced, not doubled
	r = setCreases(r.cage, [edges[0]], 1);
	assert.equal(r.cage.creases!.length, 2);
	assert.equal(creaseOf(r.cage, f[0], f[1]), 1);
	r = setCreases(r.cage, edges, 0);
	assert.equal(r.cage.creases, undefined);
	assert.throws(() => setCreases(c, [[f[0], f[2]]], 1), /not an edge/);
	assert.throws(() => setCreases(c, edges, 2), /0 \(smooth\) to 1/);
	// every edge of a cube is 90 degrees sharp
	assert.equal(sharpEdges(c, 60).length, 12);
	assert.equal(sharpEdges(c, 90).length, 0);
	const by = creaseByAngle(c, 60, 0.8);
	assert.equal(by.cage.creases!.length, 12);
	assert.throws(() => creaseByAngle(c, 120), /No edge is sharper/);
	// an edge that has a crease keeps it
	const kept = creaseByAngle(setCreases(c, [edges[0]], 0.3).cage, 60, 1);
	assert.equal(kept.cage.creases!.length, 12);
	assert.equal(creaseOf(kept.cage, edges[0][0], edges[0][1]), 0.3);
	assert.match(kept.note, /Creased 11 edges.*1 had a crease already/);
	assert.throws(() => creaseByAngle(kept.cage, 60, 1), /has a crease already/);
	// a 12-sided prism: the rim edges are sharp (90), the sides are not (30)
	const m = lathe("ink", [[1, -1], [1, 1]], "y", 12);
	const p: Cage = { points: m.points.map((q) => [...q] as V3), faces: m.faces.map((g) => [...g]) };
	assert.equal(creaseByAngle(p, 45).cage.creases!.length, 24);
	valid(by.cage);
});

test("creases follow their edges through an operation", () => {
	const c = cube();
	const f = faceToward(c, [0, 0, 1]);
	const loop = c.faces[f];
	const top: [number, number][] = loop.map((v, i) => [v, loop[(i + 1) % 4]]);
	const creased = setCreases(c, top, 1).cage;
	// extrude: the crease is on the ring left behind and on the face that moved
	const ex = extrudeFaces(creased, [f], 1);
	assert.equal(ex.cage.creases!.length, 8);
	for (const e of ex.cage.creases!) assert.ok(hasEdge(ex.cage, e[0], e[1]), "every crease is on an edge");
	valid(ex.cage);
	// a loop cut across a creased edge: both halves keep it
	const cut = loopCut(creased, top[0][0], top[0][1], 0.5);
	const halves = cut.cage.creases!.filter((e) => e.includes(cut.edges![0][0]) || e.includes(cut.edges![0][1]) || cut.edges!.some(([a, b]) => e.includes(a) || e.includes(b)));
	assert.ok(halves.length >= 4, "the two cut edges gave four halves");
	for (const e of cut.cage.creases!) assert.ok(hasEdge(cut.cage, e[0], e[1]));
	valid(cut.cage);
	// delete: creases of edges that are gone go, the rest are renumbered
	const a = faceToward(creased, [1, 0, 0]);
	const b = faceToward(creased, [0, 1, 0]);
	const del = deleteFaces(creased, [f, a, b]);
	for (const e of del.cage.creases ?? []) assert.ok(hasEdge(del.cage, e[0], e[1]));
	valid(del.cage);
	// merge: a crease whose end was merged away lands on the corner it merged into
	const merged = mergeCorners(creased, 5, [top[0][0], top[2][0]]);
	for (const e of merged.cage.creases ?? []) assert.ok(hasEdge(merged.cage, e[0], e[1]));
	valid(merged.cage);
});

test("explicit pattern coordinates stay one list per face, one pair per corner", () => {
	const c = cube();
	c.uvs = c.faces.map((f) => f.map((_, k) => [k % 2, k > 1 ? 1 : 0] as [number, number]));
	const f = faceToward(c, [0, 0, 1]);
	const shaped = (x: Cage) => {
		assert.equal(x.uvs!.length, x.faces.length);
		x.faces.forEach((g, i) => assert.equal(x.uvs![i].length, g.length));
	};
	const ex = extrudeFaces(c, [f], 1).cage;
	shaped(ex);
	// the face that moved keeps its own coordinates, corner for corner
	assert.deepEqual(ex.uvs![f], c.uvs[f]);
	shaped(insetFaces(c, [f], 0.2).cage);
	shaped(deleteFaces(c, [f]).cage);
	const cut = loopCut(c, c.faces[f][0], c.faces[f][1], 0.5).cage;
	shaped(cut);
	// a flipped face's coordinates turn with its corners
	const fl = flipFaces(c, [f]).cage;
	shaped(fl);
	fl.faces[f].forEach((v, k) => assert.deepEqual(fl.uvs![f][k], c.uvs![f][c.faces[f].indexOf(v)]));
});

test("a morph is carried through: each new point sits where the operation put it, from where the morph had it", () => {
	const c = cube();
	const morph = c.points.map((p) => [p[0] * 2, p[1], p[2] + 1] as V3);
	const f = faceToward(c, [0, 0, 1]);
	const ex = extrudeFaces(c, [f], 0.5);
	const m2 = carryPoints(c.points, ex.cage.points, ex.src, morph);
	assert.equal(m2.length, ex.cage.points.length);
	// the extruded face in the morph is the morph's face moved by the same 0.5
	for (const v of ex.cage.faces[f]) assert.ok(near(m2[v][2], 1 + 1 + 0.5) && near(Math.abs(m2[v][0]), 2));
	const cut = loopCut(c, c.faces[f][0], c.faces[f][1], 0.5);
	const m3 = carryPoints(c.points, cut.cage.points, cut.src, morph);
	for (const [a] of cut.edges!) {
		const s = cut.src[a];
		assert.ok(near(m3[a][0], (morph[s[0]][0] + morph[s[1]][0]) / 2));
	}
});

test("symmetry: mirrors across x are found, and a mirrored selection gives a mirrored result", () => {
	const c = cube();
	const m = mirrorMap(c.points);
	c.points.forEach((p, i) => {
		const q = c.points[m[i]];
		assert.ok(near(q[0], -p[0]) && near(q[1], p[1]) && near(q[2], p[2]));
	});
	const right = faceToward(c, [1, 0, 0]);
	const left = faceToward(c, [-1, 0, 0]);
	assert.deepEqual(withMirrorFaces(c, [right]).sort(), [right, left].sort());
	// a face that crosses the plane is its own mirror
	const front = faceToward(c, [0, 0, 1]);
	assert.deepEqual(withMirrorFaces(c, [front]), [front]);
	const r = extrudeFaces(c, withMirrorFaces(c, [right]), 0.5);
	const mm = mirrorMap(r.cage.points);
	assert.ok(mm.every((j) => j >= 0), "every point of the result has its mirror");
	assert.ok(near(solid(r.cage, "both sides extruded").volume, 8 + 2 + 2, 1e-3));
	const e = c.faces[right];
	assert.equal(withMirrorEdges(c, [[e[0], e[1]]]).length, 2);
	// a point on the plane mirrors to itself
	assert.equal(mirrorMap([[0, 1, 2], [3, 0, 0]])[0], 0);
	assert.equal(mirrorMap([[0, 1, 2], [3, 0, 0]])[1], -1);
});

test("a model built from a box by the operations: a helm's bowl stays a valid, closed, outward solid at every step", () => {
	let c = cube([4, 3, 4], [0, 0, 0]);
	const steps: string[] = [];
	const step = (name: string, next: Cage) => {
		c = next;
		solid(c, name);
		steps.push(name);
	};
	const top = () => faceToward(c, [0, -1, 0]);
	step("inset the crown", insetFaces(c, [top()], 0.6).cage);
	step("raise it", extrudeFaces(c, [top()], 0.8).cage);
	step("inset again", insetFaces(c, [top()], 0.5, 0.3).cage);
	const f = c.faces[faceToward(c, [0, 0, 1])];
	step("a cut round the brow", loopCut(c, f[0], f[1], 0.5).cage);
	step("creases by angle", creaseByAngle(c, 50, 0.7).cage);
	// open the bottom and give it a rim that flares, then close it
	const open = deleteFaces(c, [faceToward(c, [0, 1, 0])]).cage;
	const rim = rims(open)[0];
	const flared = extrudeEdges(open, rim.map((v, i) => [v, rim[(i + 1) % rim.length]] as [number, number]), { amount: 0.4 }).cage;
	assert.ok(inspect(flared).manifold);
	step("flared and filled", fillRim(flared, rims(flared)[0][0]).cage);
	assert.equal(steps.length, 6);
	for (const e of c.creases ?? []) assert.ok(hasEdge(c, e[0], e[1]));
});
