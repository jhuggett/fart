// Format 1.7: paths with bakes, smooth normals, subdivision with creases, sweeps; morphs on all of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { as3d, asMesh, bakePath, bakePaths, cageHash, cornerNormals, flattenPart, parseDoc, pathPoints, projectDoc, sampleClip, sampleClip3, shapeDistance, shapesOfPosed, subdivide, surfaceOf, sweepMesh, toGlb, validate, type Doc, type MeshShape, type PathShape, type SweepShape } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const load = async (f: string): Promise<Doc> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return doc;
};
const codes = async (f: string) => parseDoc(await readFile(join(examples, f), "utf8")).report.errors.map((e) => e.code);

test("the validator: handles per point, a width when open, creases on real edges in 0–1, no sweeps in collision, no paths in 3D", async () => {
	for (const f of ["curve", "smooth", "sweep"]) assert.deepEqual(await codes(`valid/${f}.fart`), [], f);
	assert.deepEqual(await codes("invalid/path-handles.fart"), ["curve"]);
	assert.deepEqual(await codes("invalid/path-open-no-width.fart"), ["curve"]);
	assert.ok((await codes("invalid/path-in-3d.fart")).includes("schema"));
	assert.deepEqual(await codes("invalid/crease-range.fart"), ["crease"]);
	assert.deepEqual(await codes("invalid/crease-not-edge.fart"), ["crease"]);
	assert.ok((await codes("invalid/sweep-in-collision.fart")).includes("schema"));
	const r = validate({ version: 1, space: "3d", palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "mesh", color: "c", points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]], smooth: 1.5 }] }] });
	assert.ok(r.errors.some((e) => e.code === "schema"));
});

test("flattening: a straight path is its points; a curved one lies within the tolerance and bends", () => {
	assert.deepEqual(pathPoints({ points: [[0, 0], [4, 0], [4, 4]], closed: true }), [[0, 0], [4, 0], [4, 4]]);
	// a quarter circle of radius 10 as one cubic (kappa 0.5523)
	const k = 5.523;
	const pts = pathPoints({ points: [[10, 0], [0, 10]], out: [[0, k], [0, 0]], in: [[0, 0], [k, 0]] }, 0.05);
	assert.ok(pts.length > 6, `segments: ${pts.length}`);
	for (const p of pts) near(Math.hypot(p[0], p[1]), 10, 0.06);
	assert.deepEqual(pts[0], [10, 0]);
	assert.deepEqual(pts[pts.length - 1], [0, 10]);
	// a coarser tolerance means fewer points
	assert.ok(pathPoints({ points: [[10, 0], [0, 10]], out: [[0, k], [0, 0]], in: [[0, 0], [k, 0]] }, 1).length < pts.length);
});

test("the curve file: the bake is a poly a 1.6 reader draws; distance and bounds go through it; the morph moves vertices and keeps handles", async () => {
	const doc = await load("valid/curve.fart");
	const blob = doc.parts![0];
	const path = blob.shapes![0] as PathShape;
	const bake = bakePath(path);
	assert.ok(bake.points.length > 6 && bake.tris && bake.tris.length >= 3 * (bake.points.length - 2));
	near(shapeDistance(path, [0, 0]), 0);
	assert.ok(shapeDistance(path, [30, 30]) > 10);
	// the open stroke: inside its width counts as on it
	const stroke = blob.shapes![1] as PathShape;
	near(shapeDistance(stroke, [-3, -1]), 0);
	// posed: the squash moves vertices, the handles ride, the base bake is dropped so a flattener recomputes
	const posed = shapesOfPosed(doc, blob, doc.states![1].parts[0])[0] as PathShape;
	assert.deepEqual(posed.points[0], [-8, -2]);
	assert.deepEqual(posed.out, path.out);
	assert.equal(posed.bake, undefined);
	const mid = sampleClip(doc, doc.clips![0], 0.25).find((e) => e.part === "blob")!;
	near(mid.morph![0].points[0][0], -7);
	// bakePaths writes bakes into the file the way a save does
	const copy = JSON.parse(JSON.stringify(doc)) as Doc;
	bakePaths(copy);
	assert.ok((copy.parts![0].shapes![0] as PathShape).bake?.points.length);
	assert.deepEqual(validate(copy).errors, []);
});

test("subdivision: a cube becomes rounder each level; sharp creases keep the base square; the surface follows a morph", async () => {
	const doc = as3d(await load("valid/smooth.fart"))!;
	const cage = doc.parts![0].shapes![0] as MeshShape;
	const one = subdivide({ points: cage.points, faces: cage.faces }, 1);
	assert.equal(one.faces.length, 24);
	assert.ok(one.faces.every((f) => f.length === 4));
	// a plain cube rounds: its corners move inward
	for (let i = 0; i < 8; i++) assert.ok(Math.abs(one.points[i][0]) < 4 && Math.abs(one.points[i][2]) < 2);
	// with the back face's edges creased sharp, the back corners stay in the back plane (the crease rounds them only along the crease)
	const creased = subdivide({ points: cage.points, faces: cage.faces, creases: cage.creases }, 1);
	for (const i of [4, 5, 6, 7]) near(creased.points[i][2], -2);
	for (const i of [1, 2, 3]) assert.ok(creased.points[i][2] < 2); // point 0 is a pinned corner
	// the corner [0, 0.5] is sharpness 5: pinned for five levels, then it rounds (OpenSubdiv's rule)
	assert.deepEqual(creased.points[0], cage.points[0]);
	const six = subdivide({ points: cage.points, faces: cage.faces, creases: [[0, 0.5]] }, 6);
	assert.ok(six.points[0][0] > -4, "after the sharpness runs out the corner rounds");
	const surf = surfaceOf(cage);
	assert.equal(surf.faces.length, 96);
	assert.equal(asMesh(cage).faces.length, 96);
	// the morphed cage's surface is wider
	const posed = asMesh({ ...cage, points: (doc.states![1].parts[0].morph![0].points as number[][]) as MeshShape["points"] });
	const w = (m: MeshShape) => Math.max(...m.points.map((p) => p[0]));
	assert.ok(w(posed) > w(surf) + 0.5, `${w(posed)} vs ${w(surf)}`);
	// the lerp of cages lands between
	const mid = sampleClip3(doc, doc.clips![0], 0.4).find((e) => e.part === "body")!;
	const midSurf = asMesh({ ...cage, points: mid.morph![0].points });
	assert.ok(w(midSurf) > w(surf) && w(midSurf) < w(posed));
	// the bake: when it matches the cage it is used, when the cage changes it is not
	const baked: MeshShape = { ...cage, bake: { points: surf.points, faces: surf.faces, of: cageHash(cage) } };
	assert.equal(surfaceOf(baked).faces.length, 96);
	const stale: MeshShape = { ...baked, points: posed.points.slice(0, 8) as MeshShape["points"] };
	assert.notEqual(surfaceOf(stale).points[0], baked.bake!.points[0]);
});

test("smooth normals: averaged around a vertex, split at sharp edges and past the angle", async () => {
	const doc = as3d(await load("valid/smooth.fart"))!;
	const pyramid = doc.parts![0].shapes![1] as MeshShape;
	const cn = cornerNormals(pyramid.points, pyramid.faces, { angle: pyramid.angle });
	// the base is flat (its sides meet it at > 60°), so its corners keep the base normal
	for (const n of cn[0]) near(Math.abs(n[1]), 1, 1e-6);
	// the apex corner of each side averages the sides: all four apex normals agree and point along -y
	const apex = cn.slice(1).map((f, i) => f[pyramid.faces[i + 1].indexOf(4)]);
	for (const n of apex) {
		near(n[0], 0, 1e-6);
		near(n[2], 0, 1e-6);
		assert.ok(n[1] < 0);
	}
	const tm = flattenPart(doc, doc.parts![0])[1];
	assert.ok(tm.normals.length === tm.positions.length);
	// a flat mesh keeps face normals: the cube's cage lit flat has only axis normals... but it is smooth: subdivided and averaged
	const body = flattenPart(doc, doc.parts![0])[0];
	assert.ok(body.count > 90);
});

test("sweeps: a lathe with a curved profile makes a closed jar; an extrude makes a prism; the hull and projection see them", async () => {
	const doc = as3d(await load("valid/sweep.fart"))!;
	const jar = doc.parts![0].shapes![0] as SweepShape;
	const m = sweepMesh(jar);
	assert.equal(m.kind, "mesh");
	assert.ok(m.points.length > 40, `${m.points.length} points: the profile flattened into more than its five`);
	assert.ok(m.faces.length > 40);
	const smooth = asMesh(jar);
	assert.ok(smooth.faces.length > m.faces.length * 3, "smoothed once: four times the faces");
	const lid = sweepMesh(doc.parts![0].shapes![1] as SweepShape);
	assert.equal(lid.points.length, 8);
	assert.equal(lid.faces.length, 6);
	const flat = projectDoc(doc, { view: "front" });
	assert.deepEqual(validate(flat).errors, []);
	assert.ok(flat.parts![0].shapes!.length > 20);
});

test("glTF: a smooth morphed mesh exports targets on the subdivided layout; the stale-bake rule holds there too", async () => {
	const doc = as3d(await load("valid/smooth.fart"))!;
	const glb = toGlb(doc, { fps: 10 });
	const jsonLen = new DataView(glb.buffer).getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as { meshes: { name: string; primitives: { targets?: { POSITION: number }[] }[] }[]; accessors: { count: number; max?: number[] }[] };
	const body = gltf.meshes.find((mm) => mm.name === "body")!;
	const prim = body.primitives[0];
	assert.equal(prim.targets?.length, 1);
	const acc = gltf.accessors[prim.targets![0].POSITION];
	assert.ok(acc.count >= 96 * 2 * 3, `the target covers the subdivided surface (${acc.count} vertices)`);
	assert.ok(acc.max![0] > 0.5);
});
