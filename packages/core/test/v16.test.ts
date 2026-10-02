// Format 1.6: morphs. A state reshapes a shape's points; clips lerp them; the
// validator keeps them honest; projection bakes them; glTF carries them as targets.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { as3d, blendPoses, blendPoses3, drawList, flattenPart, layerPoses, parseDoc, projectDoc, sampleClip, sampleClip3, shapesOfPosed, shapesOf3Posed, toGlb, validate, projectFrame, type Doc, type Doc3, type PolyShape, type MeshShape } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.forEach((x, i) => near(x, b[i], eps));
const load = async (f: string): Promise<Doc> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return doc;
};
const codes = async (f: string) => parseDoc(await readFile(join(examples, f), "utf8")).report.errors.map((e) => e.code);

test("the validator: a morph names the part's own poly or mesh with every corner; a like part cannot", async () => {
	assert.deepEqual(await codes("valid/morph.fart"), []);
	assert.deepEqual(await codes("valid/morph3d.fart"), []);
	for (const f of ["morph-count", "morph-like", "morph-shape", "morph-kind", "morph-key"]) assert.deepEqual(await codes(`invalid/${f}.fart`), ["morph"], f);
	const bad = validate({ version: 1, parts: [{ name: "a", shapes: [{ kind: "poly", color: "c", points: [[0, 0], [1, 0], [0, 1]] }] }], palette: [{ name: "c", rgb: [1, 1, 1, 255] }], states: [{ name: "s", parts: [{ part: "a", morph: [{ shape: "0", points: [[0, 0]] }] }] }] });
	assert.ok(bad.errors.some((e) => e.code === "schema"));
});

test("2D: a state's morph reshapes the poly, a clip lerps it, the twin drawn like it keeps the base", async () => {
	const doc = await load("valid/morph.fart");
	const blob = doc.parts![0];
	const squash = doc.states![1].parts[0];
	const posed = shapesOfPosed(doc, blob, squash)[0] as PolyShape;
	assert.deepEqual(posed.points[0], [-8, -2]);
	assert.deepEqual((shapesOfPosed(doc, blob, doc.states![0].parts[0])[0] as PolyShape).points[0], [-6, -4]);
	// the twin is like the blob: no points of its own, so a morph on it is ignored
	assert.deepEqual((shapesOfPosed(doc, doc.parts![1], { part: "twin", morph: [{ shape: 0, points: squash.morph![0].points }] })[0] as PolyShape).points[0], [-6, -4]);
	// halfway between round (t=0) and squash (t=0.5) with an in-out ease: the eased half is 0.5
	const frame = sampleClip(doc, doc.clips![0], 0.25);
	const sp = frame.find((e) => e.part === "blob")!;
	nearV(sp.morph![0].points[0], [-7, -3]);
	nearV(sp.offset!, [0, 1]);
	// at a key, the key's morph exactly; at the loop's end, the base (no morph)
	assert.deepEqual(sampleClip(doc, doc.clips![0], 0.5).find((e) => e.part === "blob")!.morph![0].points[2], [10, 0]);
	assert.equal(sampleClip(doc, doc.clips![0], 1).find((e) => e.part === "blob")!.morph, undefined);
	// blending and layering mix morphs too
	const mixed = blendPoses(doc, doc.states![0].parts, doc.states![1].parts, 0.5).find((e) => e.part === "blob")!;
	nearV(mixed.morph![0].points[0], [-7, -3]);
	const layered = layerPoses(doc, doc.states![0].parts, [doc.states![1].parts[0]], 1).find((e) => e.part === "blob")!;
	assert.deepEqual(layered.morph![0].points[0], [-8, -2]);
	// draw entries carry the pose entry, so a renderer reads shapesOfPosed(doc, e.part, e.sp)
	const entries = drawList(doc, "squash");
	assert.equal((shapesOfPosed(doc, entries[0].part, entries[0].sp)[0] as PolyShape).points[5][0], -10);
});

test("3D: the chest swells, the child rides the unchanged pivot, flattening and the frame see the morph", async () => {
	const doc = as3d(await load("valid/morph3d.fart"))!;
	const chest = doc.parts![0];
	const full = doc.states![1].parts[0];
	const posed = shapesOf3Posed(doc, chest, full)[0] as MeshShape;
	assert.deepEqual(posed.points[0], [-5, -4, 3]);
	assert.deepEqual(posed.faces, (chest.shapes![0] as MeshShape).faces);
	const tm = flattenPart(doc, chest, full)[0];
	// every flattened corner lies on the swollen box: |x| is 5, not 4
	for (let i = 0; i < tm.positions.length; i += 3) near(Math.abs(tm.positions[i]), 5);
	const rest = flattenPart(doc, chest)[0];
	for (let i = 0; i < rest.positions.length; i += 3) near(Math.abs(rest.positions[i]), 4);
	// halfway through the swell
	const mid = sampleClip3(doc, doc.clips![0], 0.4).find((e) => e.part === "chest")!;
	nearV(mid.morph![0].points[0], [-4.5, -3.5, 2.5]);
	const b = blendPoses3(doc, doc.states![0].parts, doc.states![1].parts, 0.5).find((e) => e.part === "chest")!;
	nearV(b.morph![0].points[6], [4.5, 3.5, -2.5]);
	// the frame: the posed solids carry the morph, the projected faces are wider
	const fp = projectFrame(doc, doc.states![1].parts, { view: "front" }).find((f) => f.part.name === "chest")!;
	assert.deepEqual((fp.solids[0] as MeshShape).points[1], [5, -4, 3]);
	const xs = fp.shapes.filter((s) => s.shape.kind === "poly").flatMap((s) => (s.shape as PolyShape).points.map((p) => p[0]));
	near(Math.max(...xs), 5);
});

test("projection bakes a morphed entry into a variant part; the clip span subdivides", async () => {
	const doc = as3d(await load("valid/morph3d.fart"))!;
	const flat = projectDoc(doc, { view: "front" });
	const names = flat.parts!.map((p) => p.name);
	assert.ok(names.includes("chest@1"), names.join(","));
	const full = flat.states!.find((s) => s.name === "full")!;
	assert.equal(full.parts.find((e) => e.part.startsWith("chest"))!.part, "chest@1");
	assert.equal(flat.states!.find((s) => s.name === "rest")!.parts.find((e) => e.part.startsWith("chest"))!.part, "chest");
	assert.ok(flat.clips![0].keys.length > 3, "sub-keys for the swell");
	assert.deepEqual(validate(flat).errors, []);
});

test("glTF: a morph is a target with its deltas, and the clip's weights land on the lerped points", async () => {
	const doc = as3d(await load("valid/morph3d.fart"))!;
	const glb = toGlb(doc, { fps: 10 });
	const jsonLen = new DataView(glb.buffer).getUint32(12, true);
	const gltf = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen))) as { meshes: { name: string; primitives: { targets?: unknown[] }[]; weights?: number[]; extras?: { targetNames: string[] } }[]; animations: { channels: { target: { path: string } }[] }[]; accessors: { count: number; type: string; max?: number[] }[] };
	const chest = gltf.meshes.find((m) => m.name === "chest")!;
	assert.deepEqual(chest.extras?.targetNames, ["full"]);
	assert.deepEqual(chest.weights, [0]);
	assert.equal(chest.primitives.length, 2);
	for (const p of chest.primitives) assert.equal(p.targets?.length, 1);
	const head = gltf.meshes.find((m) => m.name === "head")!;
	assert.equal(head.primitives[0].targets, undefined);
	assert.ok(gltf.animations[0].channels.some((c) => c.target.path === "weights"));
	// the target's deltas: one unit out on x at the box's corners, nothing on the ball
	const posAcc = (chest.primitives[0].targets![0] as { POSITION: number }).POSITION;
	near(gltf.accessors[posAcc].max![0], 1);
	const ballAcc = (chest.primitives[1].targets![0] as { POSITION: number }).POSITION;
	near(gltf.accessors[ballAcc].max![0], 0);
});

test("a 1.5-style reader: the base shape stands; morph rides through parse and stringify untouched", async () => {
	const text = await readFile(join(examples, "valid/morph.fart"), "utf8");
	const { doc } = parseDoc(text);
	assert.ok(doc);
	assert.equal((doc!.states![1].parts[0].morph![0].points as number[][]).length, 6);
	const d3: Doc3 = as3d(await load("valid/morph3d.fart"))!;
	assert.equal(d3.states![1].parts[0].morph![0].shape, 0);
});
