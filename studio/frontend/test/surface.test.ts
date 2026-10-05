// What format 1.8 lays on a mesh, as arithmetic: paint kept minimal,
// rays into a soup of triangles, shades from the sky a corner sees, a
// path rounded through its points; and a compiled sidecar read back as
// the triangles core generated, in each part's rest space.
// `npm test -w @fastart/studio`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { box, buildSidecar, flattenPart, pipe, sourceHash, stringifyDoc, validate, type Doc3, type MeshShape } from "../../../packages/core/src/index.ts";
import { castRay, cornerShades, nearestOnTris, paintFaces, paintIndex, pointNormals, roundHandles, soupOf, soupTris, tidyPaint, tokenOfFace, type Painted, type V3 } from "../src/state/surfaceops.ts";
import { compiledBounds, compiledHit, hashBytes, paintCompiled, readCompiled, sidecarStamp, type Painter } from "../src/state/sidecarRead.ts";

const enc = (s: string) => new TextEncoder().encode(s);

test("paint: a face takes a token, and colors and paint stay minimal", () => {
	const sh: Painted = { color: "steel" };
	assert.equal(paintFaces(sh, 6, [0, 2], "brass"), 2);
	assert.deepEqual(sh.colors, ["brass"]);
	assert.deepEqual(sh.paint, [1, 0, 1, 0, 0, 0]);
	paintFaces(sh, 6, [2], "lining");
	assert.deepEqual(sh.colors, ["brass", "lining"]);
	assert.deepEqual(sh.paint, [1, 0, 2, 0, 0, 0]);
	assert.equal(tokenOfFace(sh, 2), "lining");
	assert.equal(tokenOfFace(sh, 1), "steel");
	// the first colour is no longer worn: it goes, and the indices close up
	paintFaces(sh, 6, [0], "steel");
	assert.deepEqual(sh.colors, ["lining"]);
	assert.deepEqual(sh.paint, [0, 0, 1, 0, 0, 0]);
	// the last painted face takes the shape's own colour: nothing is left to keep
	assert.equal(paintFaces(sh, 6, [2], "steel"), 1);
	assert.equal(sh.colors, undefined);
	assert.equal(sh.paint, undefined);
	// painting a face what it already wears changes nothing
	assert.equal(paintFaces(sh, 6, [3], "steel"), 0);
	assert.equal(sh.paint, undefined);
});

test("paint: what a modifier names stays, and its index follows the list", () => {
	const sh: Painted = { color: "steel", colors: ["brass", "lining", "plume"], paint: [0, 3, 0, 0], mods: [{ op: "solidify", thick: 0.2, inner: 2 }] };
	tidyPaint(sh, 4);
	// brass is worn by nothing and named by nothing: dropped; lining is the inner colour: kept
	assert.deepEqual(sh.colors, ["lining", "plume"]);
	assert.deepEqual(sh.paint, [0, 2, 0, 0]);
	assert.equal(sh.mods![0].inner, 1);
	// a paint of the wrong count is no paint
	const odd: Painted = { color: "steel", colors: ["brass"], paint: [1, 1] };
	tidyPaint(odd, 4);
	assert.equal(odd.paint, undefined);
	assert.equal(odd.colors, undefined);
	// the index of a token, the shape's own being 0
	const p: Painted = { color: "steel", colors: ["brass"] };
	assert.equal(paintIndex(p, "steel"), 0);
	assert.equal(paintIndex(p, "brass"), 1);
	assert.equal(paintIndex(p, "plume"), 2);
	assert.deepEqual(p.colors, ["brass", "plume"]);
});

test("rays: the nearest triangle, by its front or either side, within reach", () => {
	const b = box("steel", [0, 0, 0], [2, 2, 2]);
	const soup = soupOf(new Float64Array(soupTris(b.points as V3[], b.faces)));
	assert.equal(soup.tris.length, 12 * 9);
	// from outside, along +z: the near face at z = -1
	const hit = castRay(soup, [0.2, 0.3, -5], [0, 0, 1]);
	assert.ok(hit && Math.abs(hit.t - 4) < 1e-9);
	// only faces that look at the origin of the ray: the same one
	assert.ok(Math.abs(castRay(soup, [0.2, 0.3, -5], [0, 0, 1], Infinity, true)!.t - 4) < 1e-9);
	// from inside every face shows its back: either side finds the wall, the front finds nothing
	assert.ok(Math.abs(castRay(soup, [0, 0, 0], [1, 0, 0])!.t - 1) < 1e-9);
	assert.equal(castRay(soup, [0, 0, 0], [1, 0, 0], Infinity, true), null);
	// past its reach, and off to one side
	assert.equal(castRay(soup, [0, 0, -5], [0, 0, 1], 3), null);
	assert.equal(castRay(soup, [4, 0, -5], [0, 0, 1]), null);
	// many triangles: the tree answers as a search of every one would
	const many: number[] = [];
	for (let i = 0; i < 400; i++) {
		const m = box("steel", [(i % 20) * 3, Math.floor(i / 20) * 3, 0], [1, 1, 1]);
		soupTris(m.points as V3[], m.faces, many);
	}
	const big = soupOf(new Float64Array(many));
	for (const [x, y] of [[0, 0], [9, 12], [57, 57], [1.5, 1.5]]) {
		const h = castRay(big, [x, y, -10], [0, 0, 1]);
		const want = x % 3 === 0 && y % 3 === 0;
		assert.equal(!!h, want, `${x},${y}`);
		if (h) assert.ok(Math.abs(h.t - 9.5) < 1e-9);
	}
	// the nearest point of a surface to a point off it, and the normal there
	const near = nearestOnTris(soup.tris, [0.25, -3, 0.5])!;
	assert.deepEqual(near.at.map((x) => Math.round(x * 1000) / 1000), [0.25, -1, 0.5]);
	assert.deepEqual(near.n.map((x) => Math.round(x)), [0, -1, 0]);
	assert.ok(Math.abs(near.d - 2) < 1e-9);
});

test("shades: a corner under a roof is darker than one in the open, and strength scales it", () => {
	// a floor, and a slab hanging over one half of it
	const floor: MeshShape = { kind: "mesh", points: [[-4, 0, -4], [4, 0, -4], [4, 0, 4], [-4, 0, 4]], faces: [[0, 1, 2, 3]] };
	const roof = box("steel", [2, -1, 0], [4, 0.4, 8]);
	const tris = soupTris(floor.points as V3[], floor.faces);
	soupTris(roof.points as V3[], roof.faces, tris);
	const soup = soupOf(new Float64Array(tris));
	const normals = pointNormals(floor.points as V3[], floor.faces);
	// (y is down in the format: the floor's faces look up, toward −y)
	assert.deepEqual(normals[0].map((x) => Math.round(x)), [0, -1, 0]);
	const pts: V3[] = [[-3, 0, 0], [2, 0, 0]];
	const up: V3[] = [[0, -1, 0], [0, -1, 0]];
	const full = cornerShades(pts, up, soup, { strength: 1, reach: 6 });
	assert.ok(full[0] > 0.95, `in the open: ${full[0]}`);
	assert.ok(full[1] < 0.5, `under the slab: ${full[1]}`);
	const half = cornerShades(pts, up, soup, { strength: 0.5, reach: 6 });
	assert.ok(Math.abs(1 - half[1] - (1 - full[1]) / 2) < 0.011, `${half[1]} against ${full[1]}`);
	// the same every run, and out of reach nothing shades
	assert.deepEqual(cornerShades(pts, up, soup, { strength: 1, reach: 6 }), full);
	assert.deepEqual(cornerShades(pts, up, soup, { strength: 1, reach: 0.5 }), [1, 1]);
	// a corner no face uses keeps 1
	assert.deepEqual(cornerShades([[2, 0, 0]], [[0, 0, 0]], soup, { reach: 6 }), [1]);
});

test("pipes: a path rounded through its points is a valid pipe that passes through them", () => {
	const points: V3[] = [[0, 0, 0], [2, -2, 0], [4, 0, 1], [6, -1, 3]];
	const h = roundHandles(points);
	assert.equal(h.in.length, 4);
	assert.deepEqual(h.out[0], [0, 0, 0]);
	assert.deepEqual(h.in[3], [0, 0, 0]);
	// the tangent at a middle point runs from its neighbours: a sixth of the way each side
	assert.deepEqual(h.out[1], [0.667, 0, 0.167]);
	assert.deepEqual(h.in[1], [-0.667, 0, -0.167]);
	const doc = { version: 1, space: "3d", palette: [{ name: "steel", rgb: [1, 2, 3, 255] }], parts: [{ name: "a", shapes: [{ kind: "sweep", color: "steel", op: "pipe", path: { points, ...h }, radius: 0.3 }] }] };
	assert.deepEqual(validate(doc).errors, []);
	const m = pipe("steel", { points, ...h }, { radius: 0.3 });
	// every path point is the middle of a ring of the mesh
	for (const p of points) {
		const near = m.points.filter((q) => Math.abs(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) - 0.3) < 0.02);
		assert.ok(near.length >= 8, `a ring about ${p}`);
	}
	// a closed path has a handle at every point
	const ring = roundHandles(points.slice(0, 3), true);
	assert.ok(ring.out.every((o) => o.some((x) => x !== 0)));
});

test("the hash of a file's bytes is the format's, without big numbers", () => {
	assert.equal(hashBytes(enc("")), "cbf29ce484222325");
	assert.equal(hashBytes(enc("a")), "af63dc4c8601ec8c");
	const text = stringifyDoc({ version: 1, space: "3d", parts: [{ name: "p", shapes: [box("ink", [0, 0, 0], [1, 2, 3])] }] } as never);
	for (const s of [text, "é ü 漢字 \u0000 ￿", "x".repeat(70000)]) assert.equal(hashBytes(enc(s)), sourceHash(enc(s)), s.slice(0, 20));
});

const model = (): Doc3 =>
	({
		version: 1,
		space: "3d",
		palette: [
			{ name: "steel", rgb: [100, 110, 120, 255] },
			{ name: "brass", rgb: [200, 160, 60, 255] },
		],
		parts: [
			{ name: "base", pivot: [1, -2, 3], shapes: [{ ...box("steel", [1, -2, 3], [2, 2, 2]), colors: ["brass"], paint: [1, 0, 0, 0, 0, 0], shade: 0.9, shades: [1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5] }] },
			{ name: "arm", pivot: [4, 0, 0], parent: "base", shapes: [{ kind: "ball", color: "brass", at: [4, 0, 0], r: 1 }] },
			{ name: "other", pivot: [-4, 0, 0], like: "arm" },
			{ name: "empty", pivot: [0, 0, 0], shapes: [] },
		],
		states: [{ name: "rest", parts: [{ part: "base" }, { part: "arm" }, { part: "other" }] }],
	}) as unknown as Doc3;

test("a sidecar read back is the triangles core generates, in each part's rest space, tokens by name", () => {
	const doc = model();
	const src = enc(stringifyDoc(doc as never));
	const glb = buildSidecar(doc, src);
	assert.deepEqual(sidecarStamp(glb)?.of, sourceHash(src));
	const c = readCompiled(glb, doc.parts!)!;
	assert.ok(c);
	assert.equal(c.of, sourceHash(src));
	assert.equal(c.parts.length, 4);
	assert.equal(c.parts[3], null, "a part that draws nothing");
	// the painted box: a primitive per token, in the order its triangles first use them
	const base = c.parts[0]!;
	assert.deepEqual(base.prims.map((p) => [p.token, p.pos.length / 9]), [["brass", 2], ["steel", 10]]);
	// positions are the document's own, the pivot and y-up undone
	const want = flattenPart(doc, doc.parts![0])[0];
	const got = [...base.prims[0].pos, ...base.prims[1].pos];
	const all = [...want.positions].map((x) => Math.round(x * 1e4) / 1e4);
	// (core's triangles run in face order; the sidecar groups them by token, so compare as sets of corners)
	const key = (a: number[], i: number) => `${a[i]},${a[i + 1]},${a[i + 2]}`;
	const have = new Set<string>();
	for (let i = 0; i < got.length; i += 3) have.add(key(got.map((x) => Math.round(x * 1e4) / 1e4), i));
	for (let i = 0; i < all.length; i += 3) assert.ok(have.has(key(all, i)), `corner ${key(all, i)}`);
	assert.deepEqual(base.centre, [1, -2, 3]);
	// _SHADE is the shape's shade times the point's
	const shades = new Set([...base.prims[0].shade, ...base.prims[1].shade].map((x) => Math.round(x * 100) / 100));
	assert.deepEqual([...shades].sort(), [0.45, 0.9]);
	// normals are unit and in the document's frame: the box's top (−y) is among them
	const n = base.prims[1].nor;
	assert.ok([...Array(n.length / 3).keys()].every((i) => Math.abs(Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) - 1) < 1e-5));
	// a part drawn like another has its source's triangles, about its source's pivot
	assert.equal(c.parts[2]!.triangles, c.parts[1]!.triangles);
	assert.deepEqual(c.parts[2]!.centre.map((x) => Math.round(x)), [4, 0, 0]);
	assert.equal(c.triangles, 12 + 2 * c.parts[1]!.triangles);
	// bytes that are not a sidecar, or not this document's shape, are refused
	assert.equal(readCompiled(new Uint8Array(40), doc.parts!), null);
	assert.equal(readCompiled(glb, doc.parts!.slice(0, 2)), null);
	assert.equal(sidecarStamp(enc("not a glb at all, just words")), null);
});

test("compiled triangles: bounds, what lies under a point, and a painting of them", () => {
	const doc = model();
	const c = readCompiled(buildSidecar(doc, enc("x")), doc.parts!)!;
	const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
	const list = [{ part: c.parts[0]!, F: I }];
	assert.deepEqual(compiledBounds(list), { lo: [0, -3], hi: [2, -1] });
	// the front of the box is at z = 2; off the box, nothing
	assert.equal(compiledHit(list, [1, -2]), 2);
	assert.equal(compiledHit(list, [5, 5]), null);
	// moved and mirrored, it is still found, front face first
	const M = [-1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 0, 0];
	assert.equal(compiledHit([{ part: c.parts[0]!, F: M }], [9, -2]), 2);
	// painted: only what faces the viewer, in its tokens' colours
	const calls: string[] = [];
	let tris = 0;
	const ctx: Painter = {
		fillStyle: "",
		strokeStyle: "",
		lineWidth: 1,
		lineJoin: "round",
		beginPath() {},
		moveTo() {
			tris++;
		},
		lineTo() {},
		closePath() {},
		fill() {
			calls.push(String(this.fillStyle));
		},
		stroke() {},
	};
	const n = paintCompiled(ctx, list, (t) => (t === "brass" ? [200, 160, 60, 255] : [100, 110, 120, 255]), 64);
	assert.equal(n, 2, "the box's front face, two triangles");
	assert.equal(tris, 2);
	assert.ok(calls.length >= 1 && calls.every((cs) => cs.startsWith("rgba(")));
	assert.equal(paintCompiled(ctx, [], () => [0, 0, 0, 255], 64), 0);
});
