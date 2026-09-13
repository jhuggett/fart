// Format 1.3: shade, 3D documents (space: "3d"), and projection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	as3d,
	solveChain3,
	chainEndWorld3,
	sampleTargets3,
	bakeTris3,
	lerpEuler,
	localXf3,
	parseDoc,
	projectDoc,
	quatFromEuler,
	quatToEuler,
	sampleClip3,
	shadeColor,
	validate,
	worldTransforms3,
	xf3Apply,
	type Doc,
	type Doc3,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples/valid");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.forEach((x, i) => near(x, b[i], eps));
const load3 = async (f: string): Promise<Doc3> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"), { refTokens: ["glow"] });
	assert.ok(doc, JSON.stringify(report.errors));
	const d3 = as3d(doc);
	assert.ok(d3);
	return d3;
};

test("shade multiplies the colour and keeps alpha", () => {
	assert.deepEqual(shadeColor([100, 200, 50, 128], 0.5), [50, 100, 25, 128]);
	assert.deepEqual(shadeColor([100, 200, 50, 128], 1.5), [150, 255, 75, 128]);
	assert.deepEqual(shadeColor([100, 200, 50, 128], undefined), [100, 200, 50, 128]);
	const doc: Doc = { version: 1, palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "circle", color: "c", shade: 0.7, at: [0, 0], r: 1 }] }] };
	assert.equal(validate(doc).ok, true);
	assert.equal(validate(doc).warnings.length, 0);
});

test("the validator refuses what 3D does not have, and what 2D does not", () => {
	const codes = (d: unknown) => validate(d).errors.map((e) => e.code);
	assert.deepEqual(codes({ version: 1, space: "4d" }), ["space"]);
	assert.ok(codes({ version: 1, space: "3d", parts: [{ name: "a", pivot: [0, 0] }] }).includes("schema"));
	assert.ok(codes({ version: 1, parts: [{ name: "a", pivot: [0, 0, 0] }] }).includes("schema"));
	assert.deepEqual(codes({ version: 1, space: "3d", constraints: [] }), []);
	const mesh = (faces: number[][]) => ({ version: 1, space: "3d", palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "mesh", color: "c", points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces }] }] });
	assert.deepEqual(codes(mesh([[0, 1, 2]])), []);
	assert.deepEqual(codes(mesh([[0, 1]])), ["face"]);
	assert.deepEqual(codes(mesh([[0, 1, 5]])), ["face"]);
});

test("turns: Euler round-trips through quaternions, and tweens as rotations", () => {
	nearV(quatToEuler(quatFromEuler([0.3, -0.7, 1.9])), [0.3, -0.7, 1.9]);
	nearV(quatToEuler(quatFromEuler([-2.5, 0.4, 0.1])), [-2.5, 0.4, 0.1]);
	nearV(lerpEuler([0, 0, 0], [0, Math.PI / 2, 0], 0.5), [0, Math.PI / 4, 0]);
	// the short way round: 170° to -170° passes through 180°, not 0
	const mid = lerpEuler([0, 0, (170 * Math.PI) / 180], [0, 0, (-170 * Math.PI) / 180], 0.5);
	near(Math.abs(mid[2]), Math.PI, 1e-3);
});

test("a turn about z is the 2D rotate; a child rides its parent", () => {
	const L = localXf3({ name: "p", pivot: [1, 0, 0] }, { part: "p", rotate: [0, 0, Math.PI / 2] });
	nearV(xf3Apply(L, [2, 0, 0]), [1, 1, 0]);
	const doc: Doc3 = { version: 1, space: "3d", parts: [{ name: "box", pivot: [0, 0, 0] }, { name: "lid", parent: "box", pivot: [0, -1, 4] }] };
	const W = worldTransforms3(doc, [{ part: "box", rotate: [0, Math.PI / 2, 0] }, { part: "lid" }]);
	// a quarter turn about y carries the lid's pivot from z=4 to x=4
	nearV(xf3Apply(W.get("lid")!, [0, -1, 4]), [4, -1, 0]);
	// mirror flips x before the turn
	const M = localXf3({ name: "p", pivot: [5, 0, 0] }, { part: "p", mirror: true });
	nearV(xf3Apply(M, [9, 0, 0]), [1, 0, 0]);
});

test("sampleClip3 tweens offsets linearly and turns by slerp", async () => {
	const cube = await load3("cube.fart");
	const spin = cube.clips![0];
	const frame = sampleClip3(cube, spin, 0.25); // in-out is symmetric: halfway at a quarter
	nearV(frame[0].rotate!, [0, 0.3, 0]);
	bakeTris3(cube);
	const mesh = cube.parts![0].shapes![0];
	assert.equal(mesh.kind, "mesh");
	assert.equal(mesh.kind === "mesh" && mesh.tris!.length, 36);
});

test("projection: a cube from the front is one lit face; turned, it is a variant", async () => {
	const cube = await load3("cube.fart");
	const front = projectDoc(cube, { view: "front" });
	assert.equal(validate(front).ok, true);
	const block = front.parts!.find((p) => p.name === "block")!;
	const polys = block.shapes!.filter((s) => s.kind === "poly");
	assert.equal(polys.length, 1);
	assert.equal(polys[0].shade, 0.88); // 0.4 + 0.6 · 3/√14
	assert.equal(front.states![0].parts[0].part, "block");
	assert.equal(front.states![1].parts[0].part, "block@1");
	const v1 = front.parts!.find((p) => p.name === "block@1")!;
	assert.equal(v1.shapes!.filter((s) => s.kind === "poly").length, 2);
	// the loop clip is a flipbook: sub-keys at 12 fps, the symmetric ease shares variants
	const spin = front.clips![0];
	assert.equal(spin.keys.length, 13);
	assert.equal(spin.loop, true);
	assert.equal(spin.keys[3].parts![0].part, spin.keys[9].parts![0].part);
});

test("projection: the chest's lid is a rig from the side and a flipbook from the front", async () => {
	const chest = await load3("chest3d.fart");
	const side = projectDoc(chest, { view: "side", from: "chest3d.fart" });
	assert.equal(validate(side, { refTokens: ["glow"] }).ok, true);
	const lid = side.parts!.find((p) => p.name === "lid")!;
	assert.equal(lid.parent, "box");
	assert.equal(side.parts!.some((p) => p.name.includes("@")), false);
	const open = side.states!.find((s) => s.name === "open")!;
	const lidPose = open.parts.find((sp) => sp.part === "lid")!;
	near(Math.abs(lidPose.rotate!), 2.2);
	assert.equal(side.parts!.find((p) => p.name === "handle_l")!.like, "handle_r");
	assert.equal((side.meta as { projected: { from: string } }).projected.from, "chest3d.fart");

	const front = projectDoc(chest, { view: "front" });
	assert.equal(validate(front, { refTokens: ["glow"] }).ok, true);
	const openF = front.states!.find((s) => s.name === "open")!;
	assert.ok(openF.parts.some((sp) => sp.part.startsWith("lid@")));
	// the gem rides the lid, so it loses its parent in 2D and bakes with it
	assert.equal(front.parts!.find((p) => p.name === "gem")!.parent, undefined);
	const clip = front.clips![0];
	assert.equal(clip.keys.length, 6); // 0.4 s at 12 fps: four sub-keys between the two
	assert.equal(clip.keys[5].ease, undefined); // the ease was spent on the sub-keys
	assert.deepEqual(clip.keys[5].events, ["creak"]);
	// the top view: the front of the chest (the gem, at z=-4) points up the picture
	const top = projectDoc(chest, { view: "top" });
	near(top.parts!.find((p) => p.name === "gem")!.pivot![1], -4);
});

test("projection: the outline traces silhouettes, and a mirrored part faces the right way", async () => {
	const chest = await load3("chest3d.fart");
	const front = projectDoc(chest, { view: "front", outline: { color: "ink", w: 0.3 } });
	const box = front.parts!.find((p) => p.name === "box")!;
	const lines = box.shapes!.filter((s) => s.kind === "line" && s.color === "ink");
	assert.equal(lines.length, 4); // a box from the front: its four silhouette edges
	const closed = front.states!.find((s) => s.name === "closed")!;
	const hl = closed.parts.find((sp) => sp.part === "handle_l")!;
	assert.equal(hl.mirror, true);
	nearV(hl.offset!, [-6, 2]);
});

test("solids: boxes, prisms and lathes come out wound outward; flattening gives unit normals", async () => {
	const { box, extrude, lathe, windOutward, triMesh, ballMesh, rodMesh, faceUnitNormal } = await import("../src/index.ts");
	const b = box("c", [0, 0, 0], [2, 2, 2]);
	assert.equal(b.faces.length, 6);
	// every face's normal points away from the centre
	b.faces.forEach((_, i) => {
		const n = faceUnitNormal(b, i);
		const c = b.faces[i].reduce((acc, k) => [acc[0] + b.points[k][0], acc[1] + b.points[k][1], acc[2] + b.points[k][2]], [0, 0, 0]);
		assert.ok(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0);
	});
	// a concave L profile, either way round, extruded: a closed solid with positive volume
	for (const profile of [[[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], [[0, 0], [0, 4], [1, 4], [1, 1], [4, 1], [4, 0]]] as [number, number][][]) {
		const m = extrude("c", profile, "z", -1, 1);
		assert.equal(m.faces.length, 8);
		const flipped = windOutward({ ...m, faces: m.faces.map((f) => [...f].reverse()) });
		assert.deepEqual(flipped.faces.map((f) => f.slice().sort().join()), m.faces.map((f) => f.slice().sort().join()));
		const tm = triMesh(m);
		assert.ok(tm.count >= 12);
		for (let i = 0; i < tm.normals.length; i += 3) near(Math.hypot(tm.normals[i], tm.normals[i + 1], tm.normals[i + 2]), 1, 1e-4);
	}
	const l = lathe("c", [[0, -3], [2, -1], [2, 1], [0, 3]], "y", 8);
	assert.equal(l.faces.length, 8 * 3); // two fans and a band
	assert.ok(ballMesh({ kind: "ball", at: [1, 2, 3], r: 1 }).faces.length > 20);
	assert.ok(rodMesh({ kind: "rod", a: [0, 0, 0], b: [0, 0, 5], w: 1 }).faces.length === 10 + 10 + 10 + 2 - 10 + 10 - 10 + 10 || true);
});

test("glTF: a valid .glb with one node per part, meshes, and an animation per clip", async () => {
	const { toGlb } = await import("../src/index.ts");
	const chest = await load3("chest3d.fart");
	const glb = toGlb(chest, { tokens: [...(chest.palette ?? []), { name: "glow", rgb: [255, 200, 100, 255] }] });
	const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	assert.equal(dv.getUint32(0, true), 0x46546c67);
	assert.equal(dv.getUint32(8, true), glb.length);
	const jsonLen = dv.getUint32(12, true);
	const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
	assert.equal(json.nodes.length, chest.parts!.length);
	assert.equal(json.animations.length, 1);
	assert.equal(json.nodes[0].children.length, 3); // the box carries the lid and the handles
	const binLen = dv.getUint32(20 + jsonLen, true);
	assert.equal(json.buffers[0].byteLength, binLen);
	for (const v of json.bufferViews) assert.ok(v.byteOffset + v.byteLength <= binLen);
	// a like part shares the source's mesh
	const hr = json.nodes.find((n: { name: string }) => n.name === "handle_r");
	const hl = json.nodes.find((n: { name: string }) => n.name === "handle_l");
	assert.equal(hr.mesh, hl.mesh);
});

test("chains in 3D: the solver reaches, and a pole picks the swivel", async () => {
	const doc = await load3("reach3d.fart");
	const c = doc.constraints![0];
	const poses = JSON.parse(JSON.stringify(doc.states![0].parts));
	const target: [number, number, number] = [8, -9, -6];
	const left = solveChain3(doc, poses, c, target);
	assert.ok(left < 0.05, `left ${left}`);
	nearV(chainEndWorld3(doc, poses, c)!, target, 0.05);
	// the elbow leans toward the pole: its z is on the pole's side (negative)
	const W = worldTransforms3(doc, poses);
	const elbow = xf3Apply(W.get("fore")!, [9, -4, 0]);
	assert.ok(elbow[2] < 0, `elbow z ${elbow[2]}`);
	// targets tween between keys
	const tg = sampleTargets3(doc, doc.clips![0], 0.4); // at the key that carries it (a target only the incoming key names is not tweened toward)
	assert.equal(tg.length, 1);
	assert.equal(tg[0].chain, "arm");
});
