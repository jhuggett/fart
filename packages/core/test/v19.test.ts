// 1.9: skins. A mesh's points placed by several parts' world maps.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { shapesOf3Skinned, shapesOf3Worn, worldTransforms3, xf3Apply, partOf3, type Doc3, type MeshShape, type Vec3 } from "../src/index.ts";

const doc = JSON.parse(fs.readFileSync(new URL("../../../spec/examples/valid/skin.fart", import.meta.url), "utf8")) as Doc3;
const near = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

test("at rest a skinned mesh is the mesh itself", () => {
	const arm = partOf3(doc, "arm")!;
	const W = worldTransforms3(doc, doc.states![0].parts);
	assert.equal(shapesOf3Skinned(doc, arm, doc.states![0].parts[1], W)[0], arm.shapes![0]);
});

test("posed, each point is the weighted sum of its joints' maps", () => {
	const arm = partOf3(doc, "arm")!;
	const poses = doc.states![1].parts;
	const W = worldTransforms3(doc, poses);
	const base = arm.shapes![0] as MeshShape;
	const made = shapesOf3Skinned(doc, arm, poses[1], W)[0] as MeshShape;
	const [B, A] = [W.get("body")!, W.get("arm")!];
	base.points.forEach((p, i) => {
		const world = xf3Apply(A, made.points[i]); // (handed back in the part's rest space: through its map, it is in the world)
		const entry = base.skin!.weights[i];
		const want: Vec3 = [0, 0, 0];
		for (let k = 0; k < entry.length; k += 2) {
			const q = xf3Apply(entry[k] === 0 ? B : A, p);
			for (let a = 0; a < 3; a++) want[a] += q[a] * entry[k + 1];
		}
		assert.ok(near(world, want), `point ${i}: ${world} is not ${want}`);
	});
	// a point wholly the body's has not moved; one wholly the arm's has gone with it
	assert.ok(near(xf3Apply(A, made.points[0]), base.points[0]));
	assert.ok(near(made.points[4], base.points[4]));
});

test("a like part's skin follows its own side, and holds to the shared joint across the middle", () => {
	const d = structuredClone(doc) as Doc3;
	d.parts!.push({ name: "arm_l", like: "arm", parent: "body", pivot: [1, -2, 1] });
	const poses = [{ part: "body" }, { part: "arm", rotate: [0, 0, 0.9] as Vec3 }, { part: "arm_l", mirror: true, offset: [-1, -2, 1] as Vec3, rotate: [0, 0, -0.9] as Vec3 }];
	const W = worldTransforms3(d, poses);
	const left = partOf3(d, "arm_l")!;
	const made = shapesOf3Skinned(d, left, poses[2], W)[0] as MeshShape;
	const right = shapesOf3Skinned(d, partOf3(d, "arm")!, poses[1], W)[0] as MeshShape;
	made.points.forEach((p, i) => {
		const l = xf3Apply(W.get("arm_l")!, p);
		const r = xf3Apply(W.get("arm")!, right.points[i]);
		assert.ok(near(l, [-r[0], r[1], r[2]]), `point ${i}: the left (${l}) is not the right's mirror image (${r})`);
	});
});

test("a skin on a host is rigid alone, and worn, follows the host's parts", () => {
	const sleeve = JSON.parse(fs.readFileSync(new URL("../../../spec/examples/valid/skin-host.fart", import.meta.url), "utf8")) as Doc3;
	const own = partOf3(sleeve, "sleeve")!;
	assert.equal(shapesOf3Skinned(sleeve, own, undefined, worldTransforms3(sleeve, []))[0], own.shapes![0]);
	const host: Doc3 = { version: 1, space: "3d", name: "body", parts: [{ name: "torso", pivot: [1, 0, 1] }, { name: "upper_arm_r", parent: "torso", pivot: [1, -2, 1] }] } as Doc3;
	const W = worldTransforms3(host, [{ part: "torso" }, { part: "upper_arm_r", rotate: [0, 0, 0.9] }]);
	const worn = shapesOf3Worn(own.shapes!, host, partOf3(host, "upper_arm_r")!, W)[0] as MeshShape;
	const base = own.shapes![0] as MeshShape;
	const A = W.get("upper_arm_r")!;
	// wholly the arm's: where a rigid shape of the arm would be; wholly the torso's: where it was
	assert.ok(near(worn.points[0], base.points[0]));
	assert.ok(near(xf3Apply(A, worn.points[4]), base.points[4]));
});

test("a skin goes out to glTF and comes back: the same joints, the same weights, point for point", async () => {
	const { toGlb, importGltf } = await import("../src/index.ts");
	const back = importGltf(toGlb(doc)).doc!;
	const was = partOf3(doc, "arm")!.shapes![0] as MeshShape;
	const now = back.parts!.flatMap((p) => (p.shapes ?? []).map((sh) => ({ part: p.name, sh: sh as MeshShape })));
	assert.ok(now.length > 0 && now.every((x) => x.sh.skin), "every shape that came back is skinned");
	was.points.forEach((p, i) => {
		const want = new Map<string, number>();
		for (let k = 0; k < was.skin!.weights[i].length; k += 2) want.set(was.skin!.joints[was.skin!.weights[i][k]], was.skin!.weights[i][k + 1]);
		let found = 0;
		for (const { sh } of now) sh.points.forEach((q, j) => {
			if (!near(q, p)) return;
			found++;
			const got = new Map<string, number>();
			for (let k = 0; k < sh.skin!.weights[j].length; k += 2) got.set(sh.skin!.joints[sh.skin!.weights[j][k]], sh.skin!.weights[j][k + 1]);
			for (const [name, w] of want) assert.ok(Math.abs((got.get(name) ?? 0) - w) < 0.002, `point ${i}: ${name} is ${got.get(name)}, was ${w}`);
		});
		assert.ok(found > 0, `point ${i} came back`);
	});
});
