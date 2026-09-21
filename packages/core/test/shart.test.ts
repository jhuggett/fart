// Scenes (.shart): loading, flattening, attaching, palettes, collision.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flattenScene, loadScene, parseScene, refInfo, sceneCollision, sceneFiles, validateScene, worldTransforms3, xf3Apply, xfApply, type Scene, type Xf, type Xf3 } from "../src/index.ts";

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
const load = async (f: string) => {
	const { scene, report } = parseScene(await readFile(join(examples, f), "utf8"));
	assert.ok(scene, JSON.stringify(report.errors));
	return loadScene(scene, read);
};

test("the camp flattens: every instance placed, nested scene included, in paint order", async () => {
	const camp = await load("camp.shart");
	assert.deepEqual(camp.unresolved, []);
	const placed = flattenScene(camp);
	assert.deepEqual(placed.map((p) => p.path), ["hut", "hut/crate", "hut/arm", "guard", "rocks/a", "rocks/b", "annex/chest", "annex/crate"]);
	// the crate rides the hut: at [-4, -8, -2], scale 0.4
	const crate = placed[1];
	nearV((crate.xf as Xf3).slice(9), [-4, -8, -2]);
	near((crate.xf as Xf3)[0], 0.4);
	// the guard shows its clip at 0.2, mirrored, turned about y
	const guard = placed[3];
	assert.ok(guard.poses && guard.poses.length === 3);
	assert.ok((guard.xf as Xf3)[0] < 0 || (guard.xf as Xf3)[2] !== 0);
	// the annex's crate is turned inside the annex, placed at 40
	near((placed[7].xf as Xf3)[9], 60);
	assert.equal(sceneFiles(camp).length, 5);
});

test("attach: the arm hangs from the lamp's socket, wherever the hut's pose puts it", async () => {
	const camp = await load("camp.shart");
	const placed = flattenScene(camp);
	const hut = placed[0];
	const arm = placed[2];
	const W = worldTransforms3(hut.doc as never, hut.poses as never);
	const lamp = (hut.doc.parts ?? []).find((p) => p.name === "lamp")!;
	const pan = xf3Apply(W.get("lamp")!, (lamp.anchors![0] as { at: [number, number, number] }).at);
	// the arm's origin (its own anchor: none, so its origin) lands on the pan
	nearV(xf3Apply(arm.xf as Xf3, [0, 0, 0]), pan, 1e-3);
	// and the arm's -y points along the pan's dir [0, -1, 0]: a point up the arm goes up
	const up = xf3Apply(arm.xf as Xf3, [0, -10, 0]);
	assert.ok(up[1] < pan[1]);
});

test("2D: the fleet places a group turned, a mirrored instance, and a gem on a hinge; palettes lay over tokens", async () => {
	const fleet = await load("fleet.shart");
	assert.deepEqual(fleet.unresolved, []);
	const placed = flattenScene(fleet);
	assert.deepEqual(placed.map((p) => p.path), ["lead", "wing/l", "wing/r", "held", "held/gem"]);
	const r = placed[2];
	const X = r.xf as Xf;
	assert.ok(X[0] * X[3] - X[1] * X[2] < 0, "mirrored");
	// the group's turn carries its children: l sits at wing's at + rotated [-12, 0]
	const l = placed[1].xf as Xf;
	nearV(xfApply(l, [0, 0]), [30 - 12 * Math.cos(0.3), 10 - 12 * Math.sin(0.3)], 1e-3);
	// the scene's palette lays over: whatever palette.fart supplies joins the instance's tokens
	const pal = JSON.parse((await read("palette.fart"))!).palette[0].name as string;
	const lead = placed[0];
	assert.ok(lead.tokens.some((t) => t.name === pal));
	// a node palette on top
	const s: Scene = { version: 1, nodes: [{ name: "a", ref: "chest.fart", palette: "palette.fart" }] };
	const loaded = await loadScene(s, read);
	const [a] = flattenScene(loaded);
	assert.ok(a.tokens.some((t) => t.name === pal));
});

test("the validator: refs, spaces, states, anchors, cycles, and attach's place", async () => {
	const codes = async (s: Scene) => {
		const loaded = await loadScene(s, read);
		return validateScene(s, { refs: refInfo(loaded) }).errors.map((e) => e.code);
	};
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "a", ref: "chest.fart", state: "open" }] }), []);
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "a", ref: "chest.fart", state: "ajar" }] }), ["ref.state"]);
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "a", ref: "hero.fart", clip: "nope" }] }), ["ref.clip"]);
	assert.deepEqual(await codes({ version: 1, space: "3d", nodes: [{ name: "a", ref: "chest.fart" }] }), ["space"]);
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "a", ref: "chest.fart", children: [{ name: "b", ref: "minimal.fart", attach: { to: "nowhere" } }] }] }), ["ref.anchor"]);
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "g", children: [{ name: "b", ref: "minimal.fart", attach: { to: "x" } }] }] }), ["ref.anchor"]);
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "a", ref: "minimal.fart", attach: { to: "x" } }] }), ["schema"]);
	assert.deepEqual(await codes({ version: 1, nodes: [{ name: "a", ref: "yard.shart" }] }), ["space"]);
	const noRefs = validateScene({ version: 1, nodes: [{ name: "a", ref: "chest.fart" }] });
	assert.deepEqual(noRefs.warnings.map((w) => w.code), ["unresolved"]);
	assert.equal(noRefs.ok, true);
});

test("collision comes from the instances, through their world maps", async () => {
	const camp = await load("camp.shart");
	const cs = sceneCollision(flattenScene(camp));
	assert.ok(cs.length >= 8);
	const annexCrate = cs.filter((c) => c.path === "annex/crate");
	assert.equal(annexCrate.length, 0); // the crate has no collision of its own
	const hutWalls = cs.filter((c) => c.path === "hut");
	assert.equal(hutWalls.length, 8);
	const flap = hutWalls.find((c) => c.part === "flap")!;
	assert.equal(flap.kind, "mesh");
});
