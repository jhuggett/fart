// Format 1.4: collision that poses, the box kind, layers, convexity, hulls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { as3d, boxMesh, collisionWorld, collisionWorld3, convexHull, faceUnitNormal, hullPart, parseDoc, sampleClip3, setHull, stringifyDoc, validate, worldTransforms3, xf3Apply, type Doc, type Doc3 } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples/valid");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.forEach((x, i) => near(x, b[i], eps));
const hut = async (): Promise<Doc3> => {
	const { doc, report } = parseDoc(await readFile(join(examples, "hut.fart"), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return as3d(doc)!;
};

test("a posed collider lands where the part's mesh lands; unposed shapes pass through", async () => {
	const doc = await hut();
	const open = doc.states!.find((s) => s.name === "open")!;
	const cs = collisionWorld3(doc, open.parts);
	assert.equal(cs.length, 8);
	const flap = cs.find((c) => c.part === "flap")!;
	assert.equal(flap.kind, "mesh");
	const W = worldTransforms3(doc, open.parts);
	const want = xf3Apply(W.get("flap")!, [10.3, -10, -8]);
	assert.ok(flap.kind === "mesh" && flap.points.some((p) => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) < 1e-3));
	// the walls stand still
	const wall = cs[0];
	assert.equal(wall.part, undefined);
	assert.equal(wall.layer, "solid");
	assert.ok(wall.kind === "mesh" && wall.points.some((p) => p[0] === 10 && p[1] === -10 && p[2] === -10.5));
	// a clip frame poses it too
	const mid = collisionWorld3(doc, sampleClip3(doc, doc.clips![0], 0.25)).find((c) => c.part === "flap")!;
	assert.ok(mid.kind === "mesh" && !mid.points.some((p) => Math.hypot(p[0] - want[0], p[1] - want[1], p[2] - want[2]) < 1e-3));
});

test("a box expands to eight outward-wound points; layers and extra fields ride along", async () => {
	const doc = await hut();
	const m = boxMesh({ kind: "box", at: [1, 2, 3], size: [2, 4, 6], rotate: [0, Math.PI / 2, 0] });
	assert.equal(m.points.length, 8);
	assert.equal(m.faces.length, 6);
	m.faces.forEach((f, i) => {
		const n = faceUnitNormal(m, i);
		const c = f.reduce((acc, k) => [acc[0] + m.points[k][0] / 4, acc[1] + m.points[k][1] / 4, acc[2] + m.points[k][2] / 4], [0, 0, 0]);
		assert.ok(n[0] * (c[0] - 1) + n[1] * (c[1] - 2) + n[2] * (c[2] - 3) > 0);
	});
	// turned a quarter about y, the box's x extent lies along z
	const xs = m.points.map((p) => p[0]);
	near(Math.max(...xs) - Math.min(...xs), 6);
	const cs = collisionWorld3(doc, doc.states![0].parts);
	const lamp = cs.find((c) => c.part === "lamp")!;
	assert.equal(lamp.layer, "trigger");
	assert.deepEqual(lamp.extra, { "x-game": { warmth: 1 } });
	assert.equal(cs.find((c) => c.part === "table")!.layer, "surface");
	// a ball's radius scales with the part
	const scaled = collisionWorld3(doc, [{ part: "hut" }, { part: "lamp", scale: 2 }]).find((c) => c.part === "lamp")!;
	assert.ok(scaled.kind === "ball" && Math.abs(scaled.r - 5) < 1e-6);
	// the fields survive a round trip through the file
	const back = parseDoc(stringifyDoc(doc)).doc!;
	assert.deepEqual((back.collision as { layer?: string }[])[7].layer, "trigger");
	assert.deepEqual((back.collision as Record<string, unknown>[])[7]["x-game"], { warmth: 1 });
	assert.deepEqual(validate(back).warnings.map((w) => w.code), ["unknown"]);
});

test("the validator: convexity, unknown parts, boxes only in collision, layers named", () => {
	const codes = (d: unknown) => validate(d).errors.map((e) => e.code);
	const cube = boxMesh({ kind: "box", at: [0, 0, 0], size: [2, 2, 2] });
	assert.deepEqual(codes({ version: 1, space: "3d", parts: [{ name: "a" }], collision: [cube] }), []);
	const dented = { ...cube, points: cube.points.map((p, i) => (i === 7 ? [0, 0, 0] : p)) };
	const r = validate({ version: 1, space: "3d", parts: [{ name: "a" }], collision: [dented] });
	assert.ok(r.errors.some((e) => e.code === "convex" && /faces\/\d+$/.test(e.path)));
	assert.deepEqual(codes({ version: 1, space: "3d", parts: [{ name: "a" }], collision: [{ kind: "ball", part: "zz", at: [0, 0, 0], r: 1 }] }), ["ref.part"]);
	assert.deepEqual(codes({ version: 1, parts: [{ name: "a" }], collision: [{ kind: "circle", part: "a", at: [0, 0], r: 1, layer: "player" }] }), []);
	assert.ok(codes({ version: 1, space: "3d", palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "box", color: "c", at: [0, 0, 0], size: [1, 1, 1] }] }] }).includes("schema"));
	assert.ok(codes({ version: 1, space: "3d", parts: [{ name: "a" }], collision: [{ kind: "ball", at: [0, 0, 0], r: 1, layer: "" }] }).includes("schema"));
	// visible meshes are not checked for convexity
	assert.deepEqual(codes({ version: 1, space: "3d", palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ ...dented, color: "c" }] }] }), []);
});

test("2D: a collision shape that names a part rides its pose", () => {
	const doc: Doc = {
		version: 1,
		parts: [{ name: "lid", pivot: [0, 0] }],
		states: [{ name: "open", parts: [{ part: "lid", rotate: Math.PI / 2, scale: 2 }] }],
		collision: [{ kind: "circle", part: "lid", at: [4, 0], r: 1, layer: "surface" }, { kind: "line", a: [0, 0], b: [1, 0], w: 2 }],
	};
	assert.equal(validate(doc).ok, true);
	const cs = collisionWorld(doc, doc.states![0].parts);
	assert.equal(cs.length, 2);
	const lid = cs[0];
	assert.ok(lid.kind === "circle");
	if (lid.kind === "circle") {
		nearV(lid.at, [0, 8]);
		near(lid.r, 2);
	}
	assert.equal(lid.layer, "surface");
	assert.equal(cs[1].layer, "solid");
});

test("hulls: a part's hull is convex, wound outward, rides the part, and replaces itself", async () => {
	const doc = await hut();
	const hull = hullPart(doc, "table")!;
	assert.ok(hull);
	assert.equal(hull.part, "table");
	assert.deepEqual(hull.meta, { hull: true });
	assert.equal(validate({ version: 1, space: "3d", palette: doc.palette, parts: doc.parts, collision: [hull] }).ok, true);
	// every table point is inside the hull
	for (const f of hull.faces) {
		const n = faceUnitNormal(hull, hull.faces.indexOf(f));
		const p0 = hull.points[f[0]];
		for (const sh of doc.parts!.find((p) => p.name === "table")!.shapes!) if (sh.kind === "mesh") for (const p of sh.points) assert.ok(n[0] * (p[0] - p0[0]) + n[1] * (p[1] - p0[1]) + n[2] * (p[2] - p0[2]) <= 1e-3);
	}
	const before = doc.collision!.length;
	setHull(doc, "table");
	setHull(doc, "table");
	assert.equal(doc.collision!.length, before + 1);
	// a cube's hull is a cube: six faces
	const cube = convexHull(boxMesh({ kind: "box", at: [0, 0, 0], size: [2, 2, 2] }).points)!;
	assert.equal(cube.faces.length, 6);
	assert.equal(cube.points.length, 8);
	// flat input has no hull
	assert.equal(convexHull([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]), null);
});
