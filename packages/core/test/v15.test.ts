// Format 1.5: textures whose maps are drawings; mapping, rasterising, projection, glTF.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { affineFrom, as3d, boxUV, flattenPart, mappingXf, meshUVs, parseDoc, projectDoc, rasterizeMap, rasterValues, resolveTextures, textureColor, toGlb, toPng, validate, xfApply, type Doc, type Doc3, type Vec2 } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples/valid");
const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.forEach((x, i) => near(x, b[i], eps));
const read = async (rel: string) => {
	try {
		return await readFile(join(examples, rel), "utf8");
	} catch {
		return null;
	}
};
const load = async (f: string): Promise<Doc> => {
	const { doc, report } = parseDoc(await readFile(join(examples, f), "utf8"));
	assert.ok(doc, JSON.stringify(report.errors));
	return doc;
};

test("the validator: textures named once, refs relative, shapes name real textures, mappings shaped", async () => {
	const codes = (d: unknown) => validate(d).errors.map((e) => e.code);
	const t = { name: "t", cell: [1, 1], maps: { color: { ref: "x.fart" } } };
	assert.deepEqual(codes({ version: 1, textures: [t] }), []);
	assert.deepEqual(codes({ version: 1, textures: [t, t] }), ["dup.texture"]);
	assert.deepEqual(codes({ version: 1, textures: [{ ...t, maps: {} }] }), ["schema"]);
	assert.deepEqual(codes({ version: 1, textures: [{ ...t, maps: { color: { ref: "/x.fart" } } }] }), ["path"]);
	assert.deepEqual(codes({ version: 1, palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "circle", color: "c", texture: "zz", at: [0, 0], r: 1 }] }] }), ["ref.texture"]);
	assert.ok(codes({ version: 1, textures: [t], palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "circle", color: "c", texture: "t", mapping: { xf: [1, 2] }, at: [0, 0], r: 1 }] }] }).includes("schema"));
	// 3D: uvs need one list per face
	const cube = { kind: "mesh", color: "c", texture: "t", mapping: { uvs: [[[0, 0], [1, 0], [1, 1]]] }, points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], faces: [[0, 1, 2], [0, 1, 3]] };
	assert.ok(codes({ version: 1, space: "3d", textures: [t], palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [cube] }] }).includes("schema"));
	const r = validate({ version: 1, textures: [t] }, { unresolvedRefs: ["x.fart"] });
	assert.deepEqual(r.warnings.map((w) => w.code), ["unresolved"]);
});

test("mapping: box mapping reads the two axes across the normal; a 2D mapping is an affine; affineFrom inverts it", () => {
	nearV(boxUV([3, 4, 5], [0, 0, -1]), [3, 4]);
	nearV(boxUV([3, 4, 5], [1, 0, 0], 2), [2.5, 2]);
	nearV(boxUV([3, 4, 5], [0, -1, 0]), [3, 5]);
	const xf = mappingXf({ at: [2, 3], angle: Math.PI / 2, scale: 2 });
	nearV(xfApply(xf, [1, 0]), [2, 5]);
	assert.deepEqual(mappingXf({ xf: [1, 0, 0, 1, 9, 9] }), [1, 0, 0, 1, 9, 9]);
	const uv: Vec2[] = [[0, 0], [8, 0], [8, 8]];
	const xy = uv.map((p) => xfApply(xf, p));
	const back = affineFrom(uv, xy)!;
	nearV(back, xf, 1e-3);
	assert.equal(affineFrom([[0, 0], [1, 1], [2, 2]], xy), null);
});

test("the crate: box-mapped faces, explicit uvs on the lid, uvs in the flattened triangles", async () => {
	const crate = as3d(await load("crate.fart"))!;
	const box = crate.parts![0].shapes![0];
	const uvs = meshUVs(box);
	assert.equal(uvs.length, 6);
	// the front face (facing -z) reads (x, y) in world units
	const front = box.kind === "mesh" ? box.faces.findIndex((f) => f.every((i) => (box as { points: number[][] }).points[i][2] === -8)) : -1;
	assert.ok(front >= 0);
	nearV(uvs[front][0], [(box as { points: number[][] }).points[(box as { faces: number[][] }).faces[front][0]][0], (box as { points: number[][] }).points[(box as { faces: number[][] }).faces[front][0]][1]]);
	const lid = crate.parts![0].shapes![2];
	assert.deepEqual(meshUVs(lid)[0], [[0, 0], [8, 0], [8, 8], [0, 8]]);
	const tms = flattenPart(crate, crate.parts![0]);
	assert.equal(tms[0].texture, "planks");
	assert.equal(tms[0].uvs!.length, tms[0].count * 6);
	assert.equal(tms[1].texture, undefined);
});

test("rasterising a map: boards are board-coloured, gaps are gap-coloured, the height mask reads as a value", async () => {
	const crate = as3d(await load("crate.fart"))!;
	const res = (await resolveTextures(crate, read, (t) => parseDoc(t).doc)).get("planks")!;
	assert.deepEqual(res.unresolved, []);
	assert.deepEqual(Object.keys(res.maps).sort(), ["color", "glow", "height"]);
	const color = rasterizeMap(res.texture, res.maps.color, 32);
	const px = (r: typeof color, x: number, y: number) => [...r.data.subarray((y * r.width + x) * 4, (y * r.width + x) * 4 + 4)];
	assert.deepEqual(px(color, 4, 4), [150, 105, 60, 255]); // a board, at (1, 1)
	assert.deepEqual(px(color, 4, 10), [0, 0, 0, 0]); // the gap between rows, at (1, 2.55): nothing painted
	assert.deepEqual(px(color, 14, 4), [70, 45, 25, 255]); // the vertical gap at x=3.5
	const height = rasterizeMap(res.texture, res.maps.height, 32);
	const v = rasterValues(height);
	near(v[4 * 32 + 4], 230 / 255, 0.01);
	near(v[10 * 32 + 4], 0);
	// the colour a textured shape shows: paint lays the map over the token; mask multiplies it
	assert.deepEqual(textureColor([100, 100, 100, 255], res.maps.color, color, res.texture, [1, 1]), [150, 105, 60, 255]);
	assert.deepEqual(textureColor([100, 100, 100, 255], res.maps.color, color, res.texture, [1, 2.55]), [100, 100, 100, 255]);
	const masked = textureColor([100, 100, 100, 255], res.maps.height, height, res.texture, [9, 1]); // wraps a cell
	near(masked[0], 100 * (230 / 255), 1);
	// the glow map draws only the knots state
	const glow = rasterizeMap(res.texture, res.maps.glow, 32);
	assert.deepEqual(px(glow, 4, 4), [0, 0, 0, 0]);
	assert.deepEqual(px(glow, 22, 5), [95, 60, 35, 255]); // the knot at (5.6, 1.2)
	// a PNG comes out with the right header and size
	const png = toPng(color);
	assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	assert.equal(new DataView(png.buffer).getUint32(16), 32);
});

test("projection carries a face's texture as a 2D mapping; glTF carries uvs and an image", async () => {
	const crate = as3d(await load("crate.fart"))!;
	const front = projectDoc(crate, { view: "front" });
	assert.equal(front.textures!.length, 1);
	const part = front.parts![0];
	const poly = part.shapes!.find((s) => s.kind === "poly" && s.texture === "planks")!;
	assert.ok(poly && poly.kind === "poly");
	const xf = mappingXf(poly.mapping);
	// the front face's pattern coordinates are its (x, y): the mapping is the identity there
	nearV(xfApply(xf, [-8, -8]), [-8, -8], 1e-2);
	nearV(xfApply(xf, [8, 8]), [8, 8], 1e-2);
	assert.equal(validate(front, { refTokens: [] }).ok, true);
	const res = (await resolveTextures(crate, read, (t) => parseDoc(t).doc)).get("planks")!;
	const png = toPng(rasterizeMap(res.texture, res.maps.color, 16));
	const glb = toGlb(crate, { images: { planks: png } });
	const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + dv.getUint32(12, true))));
	assert.equal(json.images.length, 1);
	assert.equal(json.textures.length, 1);
	assert.ok(json.meshes[0].primitives[0].attributes.TEXCOORD_0 !== undefined);
	assert.equal(json.meshes[0].primitives[0].material, 1);
	assert.equal(json.meshes[0].primitives[1].attributes.TEXCOORD_0, undefined);
});

test("2D: the floor's shapes validate with their mappings, and a like part keeps its source's texture", async () => {
	const floor = await load("floor.fart");
	assert.equal(validate(floor).ok, true);
	const sh = floor.parts![0].shapes![0];
	nearV(xfApply(mappingXf(sh.mapping), [0, 0]), [2, 0]);
	const d3: Doc3 = { version: 1, space: "3d", textures: [{ name: "t", cell: [1, 1], maps: { color: { ref: "x.fart" } } }], palette: [{ name: "c", rgb: [1, 1, 1, 255] }], parts: [{ name: "a", shapes: [{ kind: "ball", color: "c", texture: "t", at: [0, 0, 0], r: 1 }] }, { name: "b", like: "a", pivot: [0, 0, 0] }] };
	assert.equal(flattenPart(d3, d3.parts![1])[0].texture, "t");
});
