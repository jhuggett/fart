// Format 1.8: paint per face, shades per point, modifiers on the cage (mirror, solidify, crease), pipes; bakes, morphs and exports of all of it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, copyFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildSidecar, glbJson, sidecarFresh, sidecarInfo, sidecarPath, sourceHash, stringifyDoc, SIDECAR_GENERATOR, applyMods, as3d, asMesh, bakeSurfaces, builtOf, cageHash, flattenPart, hullPart, parseDoc, pathPoints3, pipe, posedMesh, projectDoc, shapesOf3Posed, subdivide, sweepMesh, toGlb, triMesh, validate, windOutward, type Doc, type Doc3, type MeshShape, type Mod, type SweepShape, type Vec3 } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const load = async (f: string): Promise<Doc3> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return as3d(doc)!;
};
const codes = async (f: string) => parseDoc(await readFile(join(examples, f), "utf8")).report.errors.map((e) => e.code);

const palette = [{ name: "steel", rgb: [100, 100, 100, 255] }, { name: "gold", rgb: [200, 160, 40, 255] }, { name: "leather", rgb: [80, 50, 30, 255] }];
const cube = (): { points: Vec3[]; faces: number[][] } => ({ points: [[-2, -2, 2], [2, -2, 2], [2, 2, 2], [-2, 2, 2], [-2, -2, -2], [2, -2, -2], [2, 2, -2], [-2, 2, -2]], faces: [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [4, 5, 1, 0], [3, 2, 6, 7]] });
// the right half of a hood: a top and three walls, open below and at the seam on x = 0
const half = (): { points: Vec3[]; faces: number[][] } => ({ points: [[0, -4, -3], [3, -4, -3], [3, -4, 3], [0, -4, 3], [0, 0, -3], [3, 0, -3], [3, 0, 3], [0, 0, 3]], faces: [[0, 1, 2, 3], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3]] });
const docOf = (...shapes: unknown[]) => ({ version: 1, space: "3d", palette, parts: [{ name: "a", pivot: [0, 0, 0], shapes }] });
const errs = (...shapes: unknown[]) => validate(docOf(...shapes)).errors.map((e) => e.code);
/** every face unchanged by windOutward: the mesh already faces out */
const outward = (m: { points: Vec3[]; faces: number[][] }) => assert.deepEqual(windOutward({ kind: "mesh", points: m.points, faces: m.faces.map((f) => [...f]) }).faces, m.faces);
/** how many faces use each edge */
const edgeUse = (faces: number[][]) => {
	const use = new Map<string, number>();
	for (const f of faces) f.forEach((a, i) => {
		const b = f[(i + 1) % f.length];
		const k = a < b ? `${a}:${b}` : `${b}:${a}`;
		use.set(k, (use.get(k) ?? 0) + 1);
	});
	return [...use.values()];
};
const closed = (m: { faces: number[][] }) => assert.ok(edgeUse(m.faces).every((n) => n === 2), "every edge has two faces");

test("the validator: paint fits the faces and the colours, shades fit the points, mods are known, a pipe's radii fit its path", async () => {
	for (const f of ["paint", "mods", "pipe"]) assert.deepEqual(await codes(`valid/${f}.fart`), [], f);
	assert.deepEqual(await codes("invalid/paint-count.fart"), ["paint"]);
	assert.deepEqual(await codes("invalid/paint-range.fart"), ["paint"]);
	assert.deepEqual(await codes("invalid/paint-no-colors.fart"), ["paint"]);
	assert.deepEqual(await codes("invalid/paint-token.fart"), ["ref.token"]);
	assert.deepEqual(await codes("invalid/shades-count.fart"), ["shades"]);
	assert.deepEqual(await codes("invalid/mod-unknown.fart"), ["mod"]);
	assert.deepEqual(await codes("invalid/mod-paint-range.fart"), ["paint"]);
	assert.ok((await codes("invalid/mod-axis.fart")).includes("schema"));
	assert.deepEqual(await codes("invalid/pipe-radii.fart"), ["pipe"]);
	assert.deepEqual(await codes("invalid/pipe-closed-two.fart"), ["pipe"]);
	assert.ok((await codes("invalid/pipe-no-path.fart")).includes("schema"));
	// the rest, inline
	const mesh = { kind: "mesh", color: "steel", ...cube() };
	assert.deepEqual(errs({ ...mesh, colors: ["gold"], paint: [0, 0, 0, 0, 0, 1] }), []);
	assert.deepEqual(errs({ ...mesh, colors: ["gold"], paint: [0, 0, 0, 0, 0, 1.5] }), ["schema"]);
	assert.deepEqual(errs({ ...mesh, shades: [1, 1, 1, 1, 1, 1, 1, -1] }), ["schema"]);
	assert.deepEqual(errs({ ...mesh, mods: [{ op: "crease", angle: 30, value: 1.2 }] }), ["crease"]);
	assert.deepEqual(errs({ ...mesh, mods: [{ op: "solidify" }] }), ["schema"]);
	assert.deepEqual(errs({ ...mesh, mods: [{ op: "solidify", thick: 0.2, offset: 2 }] }), ["schema"]);
	assert.deepEqual(errs({ ...mesh, mods: [{ op: "solidify", thick: 0.2, inner: 1 }] }), ["paint"], "inner names a colour the shape lacks");
	// a bake's paint and shades are over the bake's own faces and points
	const bake = { points: cube().points, faces: cube().faces, of: "x" };
	assert.deepEqual(errs({ ...mesh, colors: ["gold"], smooth: 1, bake: { ...bake, paint: [0, 1] } }), ["paint"]);
	assert.deepEqual(errs({ ...mesh, colors: ["gold"], smooth: 1, bake: { ...bake, paint: [0, 1, 0, 0, 0, 2] } }), ["paint"]);
	assert.deepEqual(errs({ ...mesh, smooth: 1, bake: { ...bake, shades: [1, 1] } }), ["shades"]);
	// a sweep's paint counts the faces it generates; it has no points to shade
	const prism = { kind: "sweep", color: "steel", op: "extrude", axis: "y", from: 0, to: 1, profile: { points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] } };
	assert.deepEqual(errs({ ...prism, colors: ["gold"], paint: [1, 1, 0, 0, 0, 0] }), []);
	assert.deepEqual(errs({ ...prism, colors: ["gold"], paint: [1, 1, 0] }), ["paint"]);
	assert.deepEqual(errs({ ...prism, shades: [1, 1, 1, 1] }), ["shades"]);
	// a pipe: handles per path point, a section of three or more
	const tube = { kind: "sweep", color: "steel", op: "pipe", path: { points: [[0, 0, 0], [0, -4, 0]] }, radius: 0.4 };
	assert.deepEqual(errs(tube), []);
	assert.deepEqual(errs({ ...tube, path: { ...tube.path, out: [[0, -1, 0]] } }), ["curve"]);
	assert.deepEqual(errs({ ...tube, profile: { points: [[0, 0], [1, 0]] } }), ["curve"]);
	assert.ok(errs({ ...tube, path: { points: [[0, 0], [0, -4]] } }).includes("schema"));
	// an unresolved colour is the same refusal a colour gets
	assert.deepEqual(errs({ ...mesh, colors: ["nope"], paint: [1, 0, 0, 0, 0, 0] }), ["ref.token"]);
});

test("paint: a token per triangle, by face; a face's children wear its paint through subdivision; without paint, one colour", async () => {
	const doc = await load("valid/paint.fart");
	const cage = doc.parts![0].shapes![0] as MeshShape;
	// the cage alone, unsmoothed: six quads, twelve triangles, two per face
	const flat = triMesh({ ...cage, smooth: 0 });
	assert.equal(flat.count, 12);
	assert.deepEqual(flat.colors, ["leather", "leather", "leather", "leather", "steel", "steel", "steel", "steel", "gold", "gold", "steel", "steel"]);
	// smoothed once: each face is four children in its paint
	const sub = subdivide({ points: cage.points, faces: cage.faces, paint: cage.paint }, 1);
	assert.deepEqual(sub.paint, [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0]);
	const tm = flattenPart(doc, doc.parts![0])[0];
	assert.equal(tm.colors!.length, tm.count);
	assert.equal(tm.colors!.filter((c) => c === "gold").length, 8);
	assert.equal(tm.colors!.filter((c) => c === "leather").length, 16);
	assert.equal(tm.color, "steel");
	// the sweep: its caps painted, its sides not
	const prism = flattenPart(doc, doc.parts![0])[1];
	assert.deepEqual(prism.colors, ["gold", "gold", "gold", "gold", "steel", "steel", "steel", "steel", "steel", "steel", "steel", "steel"]);
	// a shape without paint says nothing per triangle, and so does paint of all zeros
	assert.equal(triMesh({ kind: "mesh", color: "steel", ...cube() }).colors, undefined);
	assert.equal(triMesh({ kind: "mesh", color: "steel", colors: ["gold"], paint: [0, 0, 0, 0, 0, 0], ...cube() }).colors, undefined);
	// paint that does not fit the faces is passed over: the whole shape in its colour
	assert.equal(triMesh({ kind: "mesh", color: "steel", colors: ["gold"], paint: [1], ...cube() }).colors, undefined);
});

test("shades: one per point, carried to each vertex, refined by the weights that refine positions; a morph leaves them", async () => {
	const doc = await load("valid/paint.fart");
	const cage = doc.parts![0].shapes![0] as MeshShape;
	const flat = triMesh({ ...cage, smooth: 0 });
	assert.equal(flat.shades!.length, flat.count * 3);
	// each vertex wears the shade of the point it stands on
	for (let v = 0; v < flat.count * 3; v++) {
		const at = cage.points.findIndex((p) => p[0] === flat.positions[v * 3] && p[1] === flat.positions[v * 3 + 1] && p[2] === flat.positions[v * 3 + 2]);
		near(flat.shades![v], cage.shades![at], 1e-6);
	}
	assert.equal(flat.shade, undefined, "the shape's own shade stays apart");
	// uniform shades stay uniform; mixed ones stay within their range
	const even = subdivide({ ...cube(), shades: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }, 2);
	assert.equal(even.shades!.length, even.points.length);
	for (const s of even.shades!) near(s, 0.5);
	const sub = subdivide({ points: cage.points, faces: cage.faces, shades: cage.shades }, 1);
	assert.equal(sub.shades!.length, sub.points.length);
	assert.ok(sub.shades!.every((s) => s >= 0.7 - 1e-6 && s <= 1 + 1e-6));
	// a face point is the mean of its corners: face 0 is two points at 1 and two at 0.7
	near(sub.shades![8], 0.85);
	// shades that do not fit the points are passed over
	assert.equal(subdivide({ ...cube(), shades: [1, 1] }, 1).shades, undefined);
	assert.equal(triMesh({ kind: "mesh", color: "steel", shades: [1, 1], ...cube() }).shades, undefined);
	// a morph moves points and nothing else
	const mods = await load("valid/mods.fart");
	const posed = shapesOf3Posed(mods, mods.parts![0], mods.states![1].parts[0])[0] as MeshShape;
	assert.deepEqual(posed.shades, (mods.parts![0].shapes![0] as MeshShape).shades);
});

test("mirror: the cage reflected and joined, the seam welded and pinned, the copy facing out, paint, shades and creases copied", () => {
	const sh: MeshShape = { kind: "mesh", color: "steel", colors: ["gold"], paint: [0, 1, 0, 1], shades: [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3], creases: [[1, 2, 0.5], [0, 3, 1], [5, 1]], mods: [{ op: "mirror", axis: "x" }], ...half() };
	sh.points[0] = [0.0005, -4, -3]; // within the merge of the plane
	const m = applyMods(sh);
	// four of the eight points lie on the plane: twelve points, the copies after the originals
	assert.equal(m.points.length, 12);
	assert.equal(m.faces.length, 8);
	assert.deepEqual(m.points[0], [0, -4, -3], "a welded point is pinned to the plane");
	assert.deepEqual(m.points[1], [3, -4, -3]);
	assert.deepEqual(m.points[8], [-3, -4, -3], "point 1's copy is the first appended");
	// the copy of face [0, 4, 5, 1], reversed, its welded points shared
	assert.deepEqual(m.faces[5], [8, 10, 4, 0]);
	assert.deepEqual(m.paint, [0, 1, 0, 1, 0, 1, 0, 1]);
	assert.deepEqual(m.shades, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.9, 0.8, 0.5, 0.4]);
	// the crease between two unwelded points is copied; the one along the seam is its own reflection
	assert.deepEqual(m.creases, [[1, 2, 0.5], [0, 3, 1], [5, 1], [8, 9, 0.5], [10, 1]]);
	assert.equal(m.mods, undefined);
	// with a floor it is closed and faces out
	const boxed = applyMods({ ...sh, faces: [...half().faces, [7, 6, 5, 4]] });
	closed(boxed);
	outward(boxed);
	// a face lying in the plane is not copied
	const flat = applyMods({ kind: "mesh", color: "steel", points: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0]], faces: [[0, 1, 2], [0, 1, 3]], mods: [{ op: "mirror", axis: "x" }] });
	assert.equal(flat.faces.length, 3);
	// another axis, a wider merge
	const up = applyMods({ kind: "mesh", color: "steel", points: [[0, 0.2, 0], [1, 0.2, 0], [1, 2, 0], [0, 2, 0]], faces: [[0, 1, 2, 3]], mods: [{ op: "mirror", axis: "y", merge: 0.25 }] });
	assert.equal(up.points.length, 6);
	assert.deepEqual(up.points[0], [0, 0, 0]);
	assert.deepEqual(up.points[4], [1, -2, 0]);
	// a mesh without mods is itself
	const plain: MeshShape = { kind: "mesh", color: "steel", ...cube() };
	assert.equal(applyMods(plain), plain);
	assert.equal(builtOf(plain), plain);
});

test("solidify: a wall along the point normals, the inner side turned, a rim on every boundary edge, painted as asked", () => {
	// one square facing -y (up, y being down): its normal is [0, -1, 0]
	const square = (mod: Record<string, unknown>, more: Partial<MeshShape> = {}): MeshShape => applyMods({ kind: "mesh", color: "steel", points: [[0, 0, 0], [0, 0, 2], [2, 0, 2], [2, 0, 0]], faces: [[0, 3, 2, 1]], mods: [{ op: "solidify", ...mod } as Mod], ...more });
	const inward = square({ thick: 0.5 });
	assert.equal(inward.points.length, 8);
	assert.equal(inward.faces.length, 6, "the face, its inner twin, four rim quads");
	assert.deepEqual(inward.points[0], [0, 0, 0], "offset -1: the cage is the outside");
	assert.deepEqual(inward.points[4], [0, 0.5, 0], "and the wall grows inward, against the normal");
	assert.deepEqual(inward.faces[1], [5, 6, 7, 4]);
	assert.deepEqual(inward.faces[2], [3, 0, 4, 7], "the rim of edge 0–3");
	closed(inward);
	outward(inward);
	assert.equal(inward.paint, undefined);
	const out = square({ thick: 0.5, offset: 1 });
	assert.deepEqual(out.points[0], [0, -0.5, 0]);
	assert.deepEqual(out.points[4], [0, 0, 0]);
	const both = square({ thick: 0.5, offset: 0 });
	assert.deepEqual(both.points[0], [0, -0.25, 0]);
	assert.deepEqual(both.points[4], [0, 0.25, 0]);
	// paint: the inner and the rim as named, else the source face's
	const painted = square({ thick: 0.5, inner: 2, rim: 1 }, { colors: ["gold", "leather"] });
	assert.deepEqual(painted.paint, [0, 2, 1, 1, 1, 1]);
	const inherit = square({ thick: 0.5 }, { colors: ["gold"], paint: [1] });
	assert.deepEqual(inherit.paint, [1, 1, 1, 1, 1, 1]);
	// shades and creases follow both shells
	const dressed = square({ thick: 0.5 }, { shades: [1, 0.5, 1, 0.5], creases: [[0, 1, 0.4], [2, 1]] });
	assert.deepEqual(dressed.shades, [1, 0.5, 1, 0.5, 1, 0.5, 1, 0.5]);
	assert.deepEqual(dressed.creases, [[0, 1, 0.4], [2, 1], [4, 5, 0.4], [6, 1]]);
	// a closed surface has no boundary: a hollow shell, no rim
	const shell = applyMods({ kind: "mesh", color: "steel", ...cube(), mods: [{ op: "solidify", thick: 0.5 }] });
	assert.equal(shell.points.length, 16);
	assert.equal(shell.faces.length, 12);
	// a cube corner's normal is the diagonal: the inner corner sits 0.5 along it
	near(Math.hypot(shell.points[8][0] - shell.points[0][0], shell.points[8][1] - shell.points[0][1], shell.points[8][2] - shell.points[0][2]), 0.5);
	assert.ok(Math.abs(shell.points[8][0]) < 2);
});

test("crease: every edge sharper than the angle takes the value; a crease already there stands", () => {
	const sh: MeshShape = { kind: "mesh", color: "steel", ...cube(), mods: [{ op: "crease", angle: 40, value: 0.7 }] };
	const all = applyMods(sh);
	assert.equal(all.creases!.length, 12, "a cube's twelve edges meet at 90 degrees");
	assert.ok(all.creases!.every((c) => c.length === 3 && c[2] === 0.7));
	assert.equal(applyMods({ ...sh, mods: [{ op: "crease", angle: 100 }] }).creases, undefined);
	// the defaults: 30 degrees, a crease of 1
	assert.ok(applyMods({ ...sh, mods: [{ op: "crease" }] }).creases!.every((c) => c[2] === 1));
	// explicit creases win
	const kept = applyMods({ ...sh, creases: [[0, 1, 0.2]] });
	assert.equal(kept.creases!.length, 12);
	assert.deepEqual(kept.creases![0], [0, 1, 0.2]);
	// a boundary edge has one face and takes none
	const open = applyMods({ kind: "mesh", color: "steel", ...half(), mods: [{ op: "crease", angle: 40 }] });
	assert.equal(open.creases!.length, 5, "the top to each of three walls, and wall to wall twice");
	// with smooth it is a bevel: the creased cube holds its corners nearer the cage than the plain one
	const round = asMesh({ kind: "mesh", color: "steel", ...cube(), smooth: 2 });
	const bevel = asMesh({ ...sh, smooth: 2 });
	assert.ok(Math.abs(bevel.points[0][0]) > Math.abs(round.points[0][0]) + 0.2, `${bevel.points[0][0]} vs ${round.points[0][0]}`);
	// unsmoothed, a crease of 1 from the mod is a hard edge under smooth normals
	const hard = triMesh({ ...sh, normals: "smooth", mods: [{ op: "crease", angle: 40, value: 1 }] });
	near(Math.abs(hard.normals[0]) + Math.abs(hard.normals[1]) + Math.abs(hard.normals[2]), 1, 1e-6);
});

test("the pipeline: cage, morph, mods in order, smooth; the mods decide at rest, so a morph keeps the topology", async () => {
	const doc = await load("valid/mods.fart");
	const part = doc.parts![0];
	const hood = part.shapes![0] as MeshShape;
	const built = builtOf(hood);
	// mirrored: 12 points, 8 faces; solidified: 24 points, 16 faces and a rim of 6 (the seam splits two of the four lower edges)
	assert.equal(built.points.length, 24);
	assert.equal(built.faces.length, 22);
	closed(built);
	outward(built);
	assert.deepEqual(built.paint, [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]);
	assert.equal(built.shades!.length, 24);
	// the explicit crease on 4–5 rides the mirror and both shells, at its own value; the crease mod fills in the rest at 0.6
	const of = (a: number, b: number) => built.creases!.find((c) => c.length === 3 && ((c[0] === a && c[1] === b) || (c[0] === b && c[1] === a)));
	assert.equal(of(4, 5)![2], 1);
	assert.equal(of(16, 17)![2], 1, "the inner shell's copy");
	assert.ok(built.creases!.some((c) => c[2] === 0.6));
	// the surface: two levels, sixteen children a face, each in its face's paint
	const surf = asMesh(hood);
	assert.equal(surf.faces.length, 22 * 16);
	assert.equal(surf.paint!.length, surf.faces.length);
	assert.equal(surf.paint!.filter((p) => p === 2).length, 6 * 16);
	assert.equal(surf.shades!.length, surf.points.length);
	const tm = flattenPart(doc, part)[0];
	assert.equal(tm.colors!.filter((c) => c === "gold").length, 6 * 16 * 2);
	assert.equal(tm.colors!.filter((c) => c === "leather").length, 8 * 16 * 2);
	assert.equal(tm.shades!.length, tm.count * 3);
	// order matters: solidify before mirror welds the wall's inner points too, and makes a different mesh
	const swapped = builtOf({ ...hood, mods: [hood.mods![1], hood.mods![0], hood.mods![2]] });
	assert.notEqual(swapped.faces.length, built.faces.length);
	// posed: the same points and faces by count, wider; the seam still welded and on the plane
	const posed = shapesOf3Posed(doc, part, doc.states![1].parts[0])[0] as MeshShape;
	const wide = builtOf(posed);
	assert.deepEqual(wide.faces, built.faces);
	assert.deepEqual(wide.creases, built.creases);
	near(Math.max(...wide.points.map((p) => p[0])), 3.9);
	assert.equal(wide.points[0][0], 0);
	// a morph that drags a seam point off the plane does not unweld it, and one that brings a point to the plane does not weld it
	const dragged = half().points.map((p): Vec3 => (p[0] === 0 ? [1, p[1], p[2]] : [0, p[1], p[2]]));
	const odd = builtOf(posedMesh(hood, dragged));
	assert.equal(odd.points.length, 24);
	assert.deepEqual(odd.faces, built.faces);
	assert.equal(odd.points[0][0], 0);
	// the hull reads the built cage, both halves of it
	const hull = hullPart(doc, "a")!;
	assert.ok(Math.min(...hull.points.map((p) => p[0])) < -2.9);
	// glTF: the morph is a target over the built, subdivided layout
	const glb = toGlb(doc, { fps: 10 });
	const jsonLen = new DataView(glb.buffer).getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as { meshes: { primitives: { targets?: { POSITION: number }[] }[] }[]; accessors: { count: number; max?: number[] }[] };
	const target = gltf.meshes[0].primitives[0].targets![0];
	assert.equal(gltf.accessors[target.POSITION].count, tm.count * 3);
	assert.ok(gltf.accessors[target.POSITION].max![0] > 0.5);
});

test("the bake: the mesh a generated shape draws, with paint and shades for it; used while it is the cage's, mods and all", async () => {
	const doc = await load("valid/mods.fart");
	const copy = structuredClone(doc);
	const hood = copy.parts![0].shapes![0] as MeshShape;
	const fresh = asMesh(hood);
	assert.equal(bakeSurfaces(copy), 1);
	assert.deepEqual(validate(copy).errors, []);
	const bake = hood.bake!;
	assert.equal(bake.of, cageHash(hood));
	assert.equal(bake.faces.length, 22 * 16);
	assert.equal(bake.paint!.length, bake.faces.length);
	assert.equal(bake.shades!.length, bake.points.length);
	assert.equal(bake.tris!.length, bake.faces.length * 6);
	// drawn from the bake: the very arrays
	const drawn = asMesh(hood);
	assert.equal(drawn.points, bake.points);
	assert.equal(drawn.paint, bake.paint);
	assert.equal(drawn.shades, bake.shades);
	assert.deepEqual(drawn.points, fresh.points);
	assert.deepEqual(triMesh(hood).colors, triMesh(doc.parts![0].shapes![0]).colors);
	// the hash covers the mods, the paint and the shades: change any and the bake is passed over
	const thicker = { ...hood, mods: [hood.mods![0], { ...hood.mods![1], thick: 1 }, hood.mods![2]] } as MeshShape;
	assert.notEqual(cageHash(thicker), bake.of);
	assert.notEqual(asMesh(thicker).points, bake.points);
	assert.notEqual(cageHash({ ...hood, shades: hood.shades!.map(() => 1) }), bake.of);
	assert.notEqual(cageHash({ ...hood, paint: [0, 0, 0, 1] }), bake.of);
	// a morphed cage is another cage
	assert.notEqual(asMesh(posedMesh(hood, hood.points.map((p): Vec3 => [p[0] * 2, p[1], p[2]]))).points, bake.points);
	// a cage with none of the three hashes as it did in 1.7
	const plain = { ...cube(), creases: [[0, 1, 0.5]], smooth: 2 };
	const s = JSON.stringify([plain.points, plain.faces, plain.creases, 2]);
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	assert.equal(cageHash(plain), h.toString(16).padStart(8, "0"));
	assert.equal(cageHash({ ...plain, mods: [] }), cageHash(plain));
	// sweeps and painted smooth meshes bake too
	const paint = structuredClone(await load("valid/paint.fart"));
	assert.equal(bakeSurfaces(paint), 2);
	const cubeBake = (paint.parts![0].shapes![0] as MeshShape).bake!;
	assert.equal(cubeBake.paint!.length, 24);
	assert.equal(asMesh(paint.parts![0].shapes![0]).points, cubeBake.points);
	const prism = paint.parts![0].shapes![1] as SweepShape;
	assert.deepEqual(prism.bake!.paint, [1, 1, 0, 0, 0, 0]);
	assert.deepEqual(validate(paint).errors, []);
	const pipes = structuredClone(await load("valid/pipe.fart"));
	assert.equal(bakeSurfaces(pipes), 3);
	assert.deepEqual(validate(pipes).errors, []);
	assert.equal((pipes.parts![0].shapes![0] as SweepShape).bake!.faces.length, 10);
	// a bake that lacks the paint a painted cage needs is passed over
	const bare = structuredClone(hood);
	delete bare.bake!.paint;
	assert.notEqual(asMesh(bare).points, bare.bake!.points);
});

test("a pipe: a section carried along a path, round by default, tapered by radii, capped, wound outward, untwisted", async () => {
	// straight along -y (up): rings of six at radius 0.5
	const straight = pipe("steel", { points: [[0, 0, 0], [0, -4, 0]] }, { radius: 0.5, segments: 6 });
	assert.equal(straight.points.length, 12);
	assert.equal(straight.faces.length, 8, "six sides, two caps");
	for (const p of straight.points) near(Math.hypot(p[0], p[2]), 0.5);
	closed(straight);
	outward(straight);
	assert.equal(straight.faces[6].length, 6);
	// open ends
	const tube = pipe("steel", { points: [[0, 0, 0], [0, -4, 0]] }, { radius: 0.5, segments: 6, caps: false });
	assert.equal(tube.faces.length, 6);
	// defaults: eight sides, radius 1
	const plain = pipe("steel", { points: [[0, 0, 0], [4, 0, 0]] });
	assert.equal(plain.points.length, 16);
	near(Math.hypot(plain.points[0][1], plain.points[0][2]), 1);
	// radii: one per path point, linear between; zero at an open end is an apex
	const cone = pipe("steel", { points: [[0, 0, 0], [0, -2, 0], [0, -4, 0]] }, { radius: 2, radii: [1, 0.5, 0], segments: 4 });
	assert.equal(cone.points.length, 9, "two rings and the apex");
	near(Math.hypot(cone.points[4][0], cone.points[4][2]), 1);
	assert.deepEqual(cone.points[8], [0, -4, 0]);
	assert.equal(cone.faces.length, 4 + 4 + 1, "quads, triangles to the apex, one cap");
	assert.ok(cone.faces.slice(4, 8).every((f) => f.length === 3));
	closed(cone);
	outward(cone);
	// radii of the wrong count are passed over
	near(Math.hypot(pipe("steel", { points: [[0, 0, 0], [0, -4, 0]] }, { radius: 2, radii: [0.5] }).points[0][0], pipe("steel", { points: [[0, 0, 0], [0, -4, 0]] }, { radius: 2, radii: [0.5] }).points[0][2]), 2);
	// a bend in space: parallel transport keeps the section's bearing, so a path lying in a plane never rolls it about the path
	const bend = pipe("steel", { points: [[0, 0, 0], [4, 0, 0], [4, 0, 4], [8, 0, 4]] }, { radius: 0.5, segments: 4, caps: false });
	// the first normal of a path along x is the y axis squared off: ring point 0 sits straight along y from the path, at every ring
	for (let i = 0; i < 4; i++) {
		const p = bend.points[i * 4];
		const on = [[0, 0, 0], [4, 0, 0], [4, 0, 4], [8, 0, 4]][i];
		near(p[0], on[0]);
		near(p[1], 0.5);
		near(p[2], on[2]);
	}
	outward({ points: bend.points, faces: [...bend.faces, [3, 2, 1, 0], [12, 13, 14, 15]] });
	// curves: the path is flattened at the path tolerance, and a radius is read along each cubic by its own parameter
	const flat = pathPoints3({ points: [[0, 0, 0], [0, -10, 0]], out: [[5, 0, 0], [0, 0, 0]], in: [[0, 0, 0], [5, 0, 0]] });
	assert.ok(flat.points.length > 6);
	assert.equal(flat.at[0], 0);
	assert.equal(flat.at[flat.at.length - 1], 1);
	assert.ok(flat.at.every((t, i) => i === 0 || t > flat.at[i - 1]));
	assert.equal(pathPoints3({ points: [[0, 0, 0], [0, -10, 0], [3, -10, 0]] }).points.length, 3);
	// the corpus: a painted elbow, a plume to an apex, a closed ring with its own section
	const doc = await load("valid/pipe.fart");
	const [elbow, plume, ring] = doc.parts![0].shapes as SweepShape[];
	const e = sweepMesh(elbow);
	assert.equal(e.faces.length, 10);
	closed(e);
	outward(e);
	assert.deepEqual(e.paint, elbow.paint);
	const etm = triMesh(elbow);
	assert.deepEqual(etm.colors!.slice(0, 8), ["steel", "steel", "steel", "steel", "steel", "steel", "steel", "steel"]);
	assert.deepEqual(etm.colors!.slice(8, 16), ["gold", "gold", "gold", "gold", "gold", "gold", "gold", "gold"]);
	const p = sweepMesh(plume);
	assert.ok(p.points.length > 30, "the curve flattened into many rings");
	assert.deepEqual(p.points[p.points.length - 1], [2, -10, 4], "the tip is one point");
	closed(p);
	outward(p);
	assert.ok(asMesh(plume).faces.length > p.faces.length * 3, "smoothed once");
	const r = sweepMesh(ring);
	assert.equal(r.points.length, 12);
	assert.equal(r.faces.length, 12, "four corners of three sides, no caps");
	closed(r);
	outward(r);
	// the section's reach is its profile's: 0.4 at most from the path, whichever way the frame stands
	for (const q of r.points) assert.ok(Math.abs(Math.max(Math.abs(q[0]), Math.abs(q[2])) - 3) <= 0.41 && Math.abs(q[1] - 2) <= 0.41, JSON.stringify(q));
	// a profile wound the other way makes the same solid
	const other = sweepMesh({ ...ring, profile: { points: [...ring.profile!.points].reverse() } });
	outward(other);
	// a closed circuit out of plane ends where it began: the ring that closes it meets the first without a twist
	const loop = pipe("steel", { points: [[0, 0, 0], [4, 0, 0], [4, -4, 2], [0, -4, 4], [-2, 0, 3]] }, { radius: 0.3, segments: 5, closed: true });
	closed(loop);
	outward(loop);
	// a pipe does not morph and never stands in collision
	assert.ok(validate({ ...docOf(elbow), states: [{ name: "s", parts: [{ part: "a", morph: [{ shape: 0, points: [[0, 0, 0]] }] }] }] }).errors.some((x) => x.code === "morph"));
	assert.ok(validate({ ...docOf(), collision: [elbow] }).errors.some((x) => x.code === "schema"));
});

test("exports: glTF vertex colours carry the paint and the shades; projection paints each face its own token", async () => {
	const doc = await load("valid/paint.fart");
	const flat = structuredClone(doc);
	(flat.parts![0].shapes![0] as MeshShape).smooth = 0;
	const glb = toGlb(flat);
	const view = new DataView(glb.buffer);
	const jsonLen = view.getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as { meshes: { primitives: { attributes: { COLOR_0: number } }[] }[]; accessors: { bufferView: number; count: number }[]; bufferViews: { byteOffset: number }[] };
	const acc = gltf.accessors[gltf.meshes[0].primitives[0].attributes.COLOR_0];
	const at = 20 + jsonLen + 8 + gltf.bufferViews[acc.bufferView].byteOffset;
	const rgb = (v: number) => [0, 1, 2].map((k) => Math.round(view.getFloat32(at + (v * 4 + k) * 4, true) * 255));
	assert.equal(acc.count, 36);
	// face 0 is leather (90, 60, 40), two of its points at shade 1 and two at 0.7
	const face0 = [0, 1, 2, 3, 4, 5].map((v) => rgb(v).join());
	assert.deepEqual([...new Set(face0)].sort(), ["63,42,28", "90,60,40"]);
	// face 2 is the shape's own colour, shaded likewise; face 4 is gold, every point at 1
	assert.ok(["150,150,160", "105,105,112"].includes(rgb(12).join()), rgb(12).join());
	for (let v = 24; v < 30; v++) assert.deepEqual(rgb(v), [220, 180, 70]);
	// projection: from the front only the -z face shows, in its paint
	const front = projectDoc(flat, { view: "front" });
	assert.deepEqual(validate(front).errors, []);
	const polys = front.parts![0].shapes!.filter((s) => s.kind === "poly");
	assert.ok(polys.some((s) => s.color === "leather"));
	assert.ok(front.palette!.some((t) => t.name === "leather"));
	const top = projectDoc(flat, { view: "top" });
	assert.ok(top.parts![0].shapes!.some((s) => s.color === "gold"));
});

interface SideGltf {
	asset: { generator: string; extras: { fart: { format: string; generator: string; of: string } } };
	nodes: { name: string; mesh?: number; children?: number[]; extras: { pivot: number[]; anchors?: { name: string; at: number[]; dir?: number[] }[] } }[];
	meshes: { name: string; primitives: { attributes: Record<string, number>; targets?: { POSITION: number }[]; extras: { shape: number; token: string; texture?: string } }[]; extras?: { targetNames: string[] } }[];
	accessors: { bufferView: number; count: number; type: string; componentType: number }[];
	bufferViews: { byteOffset: number; byteLength: number }[];
	animations?: { name: string }[];
}
/** a GLB's JSON chunk and a reader of its float accessors, straight from the container */
function openGlb(glb: Uint8Array): { gltf: SideGltf; floats: (accessor: number) => Float32Array } {
	const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	assert.equal(view.getUint32(0, true), 0x46546c67, "glTF");
	assert.equal(view.getUint32(8, true), glb.length);
	const jsonLen = view.getUint32(12, true);
	assert.equal(view.getUint32(16, true), 0x4e4f534a, "JSON");
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as SideGltf;
	assert.equal(view.getUint32(20 + jsonLen + 4, true), 0x004e4942, "BIN");
	const bin = 20 + jsonLen + 8;
	const width: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
	const floats = (accessor: number) => {
		const acc = gltf.accessors[accessor];
		assert.equal(acc.componentType, 5126);
		const out = new Float32Array(acc.count * width[acc.type]);
		const at = bin + gltf.bufferViews[acc.bufferView].byteOffset;
		for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(at + i * 4, true);
		return out;
	};
	return { gltf, floats };
}

test("the sidecar: everything generated, a primitive per shape and token, the token by name, a shade per vertex, anchors, the source's hash", async () => {
	const text = await readFile(join(examples, "valid/mods.fart"), "utf8");
	const source = new TextEncoder().encode(text);
	const doc = as3d(parseDoc(text).doc!)!;
	const glb = buildSidecar(doc, source);
	const { gltf, floats } = openGlb(glb);
	// what it says of itself
	assert.deepEqual(gltf.asset.extras.fart, { format: "1.8", generator: SIDECAR_GENERATOR, of: sourceHash(source) });
	assert.match(gltf.asset.extras.fart.of, /^[0-9a-f]{16}$/);
	assert.deepEqual(sidecarInfo(glb), gltf.asset.extras.fart);
	assert.equal(glbJson(new Uint8Array([1, 2, 3])), null);
	// FNV-1a, 64 bits: the published vectors
	assert.equal(sourceHash(new Uint8Array(0)), "cbf29ce484222325");
	assert.equal(sourceHash(new TextEncoder().encode("a")), "af63dc4c8601ec8c");
	// one mesh for the part; its primitives are the hood's three tokens, in the order its triangles meet them
	const tm = triMesh(doc.parts![0].shapes![0]);
	const prims = gltf.meshes[0].primitives;
	assert.deepEqual(prims.map((p) => p.extras), [{ shape: 0, token: "steel" }, { shape: 0, token: "leather" }, { shape: 0, token: "gold" }]);
	const count = (token: string) => tm.colors!.filter((c) => c === token).length;
	for (const p of prims) {
		assert.equal(gltf.accessors[p.attributes.POSITION].count, count(p.extras.token) * 3, `${p.extras.token}: three vertices a triangle`);
		assert.equal(gltf.accessors[p.attributes.NORMAL].count, count(p.extras.token) * 3);
		assert.equal(gltf.accessors[p.attributes._SHADE].count, count(p.extras.token) * 3);
		assert.equal(gltf.accessors[p.attributes._SHADE].type, "SCALAR");
		assert.equal(p.targets!.length, 1, "the morph is a target of every primitive");
		assert.equal(gltf.accessors[p.targets![0].POSITION].count, count(p.extras.token) * 3);
	}
	assert.equal(prims.reduce((n, p) => n + gltf.accessors[p.attributes.POSITION].count, 0), tm.count * 3, "every generated triangle, once");
	assert.deepEqual(gltf.meshes[0].extras!.targetNames, ["wide"]);
	assert.equal(gltf.animations![0].name, "flare");
	// positions are y-up from the pivot; the first steel vertex is the first steel triangle's first corner
	const first = tm.colors!.indexOf("steel");
	const pos = floats(prims[0].attributes.POSITION);
	near(pos[0], tm.positions[first * 9]);
	near(pos[1], -tm.positions[first * 9 + 1]);
	near(pos[2], -tm.positions[first * 9 + 2]);
	// _SHADE is the shape's shade times the point's: the hood's are within 0.8 to 1, and not all alike
	const shade = floats(prims[0].attributes._SHADE);
	assert.ok(shade.every((v) => v > 0.79 && v < 1.01));
	assert.ok(new Set(shade).size > 1);
	near(shade[0], tm.shades![first * 3], 1e-6);
	// smooth normals: unit length, and across a smooth surface more than the six of a box
	const nor = floats(prims[0].attributes.NORMAL);
	near(Math.hypot(nor[0], nor[1], nor[2]), 1, 1e-4);
	// nodes: the pivot and the anchors as the file has them; textures by name; a shade on the shape
	const dressed = {
		version: 1, space: "3d", palette,
		textures: [{ name: "weave", cell: [4, 4], maps: { color: { ref: "weave.fart" } } }],
		parts: [
			{ name: "base", pivot: [1, 2, 3], anchors: [{ name: "grip", at: [1, 0, 3], dir: [0, -1, 0] }, { name: "tip", at: [0, -4, 0] }], shapes: [{ kind: "mesh", color: "steel", shade: 0.5, colors: ["gold"], paint: [1, 0, 0, 0, 0, 0], texture: "weave", ...cube() }, { kind: "ball", color: "gold", at: [0, -3, 0], r: 1 }] },
			{ name: "arm", parent: "base", pivot: [1, 0, 3], shapes: [{ kind: "sweep", color: "leather", op: "pipe", path: { points: [[1, 0, 3], [1, -4, 3]] }, radius: 0.3, segments: 5 }] },
			{ name: "twin", like: "arm", parent: "base", pivot: [-1, 0, 3] },
		],
	} as unknown as Doc;
	const dtext = stringifyDoc(dressed);
	const d3 = as3d(parseDoc(dtext, { unresolvedRefs: [] }).doc!)!;
	const side = openGlb(buildSidecar(d3, new TextEncoder().encode(dtext)));
	const base = side.gltf.nodes[0];
	assert.deepEqual(base.extras, { pivot: [1, 2, 3], anchors: [{ name: "grip", at: [1, 0, 3], dir: [0, -1, 0] }, { name: "tip", at: [0, -4, 0] }] });
	assert.deepEqual(side.gltf.nodes[1].extras, { pivot: [1, 0, 3] });
	assert.deepEqual(base.children, [1, 2]);
	assert.equal(side.gltf.nodes[2].mesh, side.gltf.nodes[1].mesh, "a part drawn like another shares its mesh");
	const bp = side.gltf.meshes[base.mesh!].primitives;
	assert.deepEqual(bp.map((p) => p.extras), [{ shape: 0, token: "gold", texture: "weave" }, { shape: 0, token: "steel", texture: "weave" }, { shape: 1, token: "gold" }]);
	assert.equal(side.gltf.accessors[bp[0].attributes.POSITION].count, 6);
	assert.equal(side.gltf.accessors[bp[1].attributes.POSITION].count, 30);
	assert.ok(side.floats(bp[0].attributes._SHADE).every((v) => v === 0.5));
	assert.equal(side.gltf.accessors[bp[0].attributes.TEXCOORD_0].count, 6);
	assert.equal(bp[2].attributes.TEXCOORD_0, undefined);
	// the pipe is there as triangles: ten sides and two caps of five
	const arm = side.gltf.meshes[side.gltf.nodes[1].mesh!].primitives;
	assert.deepEqual(arm.map((p) => p.extras), [{ shape: 0, token: "leather" }]);
	assert.equal(side.gltf.accessors[arm[0].attributes.POSITION].count, (5 * 2 + 3 * 2) * 3);
	// plain glTF export is as it was: a primitive per shape, no extras, no _SHADE
	const plain = openGlb(toGlb(d3));
	assert.equal(plain.gltf.meshes[0].primitives.length, 2);
	assert.equal(plain.gltf.meshes[0].primitives[0].extras, undefined);
	assert.equal(plain.gltf.meshes[0].primitives[0].attributes._SHADE, undefined);
	assert.equal((plain.gltf.asset as { extras?: unknown }).extras, undefined);
	// fresh while the source's bytes are the ones it was built from
	assert.ok(sidecarFresh(glb, source));
	assert.ok(!sidecarFresh(glb, new TextEncoder().encode(text + "\n")), "a byte more is another source");
	assert.ok(!sidecarFresh(null, source));
	assert.ok(!sidecarFresh(toGlb(doc), source), "a plain export is no sidecar");
	assert.equal(sidecarPath("art/helm.fart"), "art/helm.fart.glb");
});

test("fart build: writes sidecars beside their sources, leaves fresh ones, --check fails on a missing or stale one, --clean removes them", async () => {
	const dir = await mkdtemp(join(tmpdir(), "fart-build-"));
	const cli = resolve(here, "../src/cli.ts");
	const run = (...args: string[]) => new Promise<{ code: number; out: string }>((done) => execFile(process.execPath, [cli, "build", ...args], (err, stdout) => done({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, out: stdout })));
	const there = (f: string) => access(join(dir, f)).then(() => true, () => false);
	try {
		await copyFile(join(examples, "valid/mods.fart"), join(dir, "mods.fart"));
		await copyFile(join(examples, "valid/pipe.fart"), join(dir, "pipe.fart"));
		await copyFile(join(examples, "valid/minimal.fart"), join(dir, "minimal.fart"));
		// nothing built yet
		let r = await run("--check", dir);
		assert.equal(r.code, 1);
		assert.match(r.out, /missing .*mods\.fart\.glb/);
		assert.ok(!(await there("mods.fart.glb")), "--check writes nothing");
		r = await run(dir);
		assert.equal(r.code, 0);
		assert.match(r.out, /2 built, 0 up to date/);
		assert.ok((await there("mods.fart.glb")) && (await there("pipe.fart.glb")));
		assert.ok(!(await there("minimal.fart.glb")), "a 2D document has no sidecar");
		const source = new Uint8Array(await readFile(join(dir, "mods.fart")));
		assert.equal(sidecarInfo(new Uint8Array(await readFile(join(dir, "mods.fart.glb"))))!.of, sourceHash(source));
		assert.equal((await run("--check", dir)).code, 0);
		// a second run has nothing to do; --force does it anyway
		assert.match((await run(dir)).out, /0 built, 2 up to date/);
		assert.match((await run("--force", join(dir, "pipe.fart"))).out, /1 built/);
		// the source changes: stale, then rebuilt
		const doc = JSON.parse(new TextDecoder().decode(source)) as Doc3;
		(doc.parts![0].shapes![0] as MeshShape).mods![1] = { op: "solidify", thick: 1, inner: 1, rim: 2 };
		await writeFile(join(dir, "mods.fart"), stringifyDoc(doc));
		r = await run("--check", dir);
		assert.equal(r.code, 1);
		assert.match(r.out, /stale .*mods\.fart\.glb/);
		assert.match((await run(dir)).out, /1 built, 1 up to date/);
		assert.equal((await run("--check", dir)).code, 0);
		// --clean
		r = await run("--clean", dir);
		assert.equal(r.code, 0);
		assert.ok(!(await there("mods.fart.glb")) && !(await there("pipe.fart.glb")));
		assert.ok(await there("mods.fart"), "the sources stay");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
