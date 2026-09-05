// Format 1.2: mirror and like, anchors with angles, targets, events,
// curves, blending and layering, attaching.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
	attachXf,
	bezier,
	blendPoses,
	clipEvents,
	ease,
	layerPoses,
	localXf,
	sampleClip,
	sampleTargets,
	shapesOf,
	anchorsOf,
	solveChain,
	solveTargets,
	chainEndWorld,
	validate,
	worldTransforms,
	xfApply,
	xfFlipped,
	type Doc,
	type StatePart,
} from "../src/index.ts";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-3) => a.forEach((x, i) => near(x, b[i], eps));

const digger: Doc = {
	version: 1,
	palette: [{ name: "c", rgb: [1, 1, 1, 255] }],
	parts: [
		{ name: "body", pivot: [0, 0], shapes: [{ kind: "circle", color: "c", at: [0, 0], r: 5 }] },
		{ name: "claw_r", parent: "body", pivot: [5, 0], shapes: [{ kind: "line", color: "c", a: [5, 0], b: [9, -2], w: 1 }], anchors: [{ name: "tip", at: [9, -2] }] },
		{ name: "claw_l", like: "claw_r", parent: "body", pivot: [5, 0] },
	],
};

test("like: shapes and anchors come from the source; the array is shared", () => {
	const l = digger.parts![2];
	assert.equal(shapesOf(digger, l), digger.parts![1].shapes);
	assert.equal(anchorsOf(digger, l)[0].name, "tip");
	assert.equal(validate(digger).ok, true);
});

test("mirror flips about the pivot before the turn", () => {
	const part = digger.parts![1];
	const M = localXf(part, { part: "claw_r", mirror: true });
	nearV(xfApply(M, [9, -2]), [1, -2]); // 9 reflects across x=5 to 1
	nearV(xfApply(M, [5, 0]), [5, 0]); // the pivot stays
	assert.ok(xfFlipped(M));
	// with an offset, the mirrored claw lands on the other side
	const L = localXf(part, { part: "claw_l", mirror: true, offset: [-5, 0] });
	nearV(xfApply(L, [9, -2]), [-9, -2]);
	// a turn is applied after the flip, in the parent's frame
	const R = localXf(part, { part: "claw_r", mirror: true, rotate: Math.PI / 2 });
	nearV(xfApply(R, [9, 0]), [5, -4]); // (1,0) about (5,0) by +90°: dx=-4 → (5, -4)
});

test("mirror does not tween: the outgoing key's flip holds", () => {
	const doc: Doc = {
		...digger,
		states: [
			{ name: "a", parts: [{ part: "claw_r", mirror: true }] },
			{ name: "b", parts: [{ part: "claw_r", rotate: 1 }] },
		],
		clips: [{ name: "k", keys: [{ t: 0, state: "a" }, { t: 1, state: "b" }] }],
	};
	assert.equal(sampleClip(doc, doc.clips![0], 0.5)[0].mirror, true);
	assert.equal(sampleClip(doc, doc.clips![0], 1)[0].mirror, undefined);
});

test("curves: a bezier bends the fraction, and beats ease", () => {
	near(bezier([0, 0, 1, 1], 0.3), 0.3);
	near(bezier([0.42, 0, 0.58, 1], 0.5), 0.5);
	assert.ok(bezier([0.42, 0, 0.58, 1], 0.25) < 0.25); // ease-in-out starts slow
	assert.ok(bezier([0.34, 1.56, 0.64, 1], 0.7) > 1); // a back-out overshoots
	near(ease(0.25, "linear", [0.42, 0, 0.58, 1]), bezier([0.42, 0, 0.58, 1], 0.25));
	near(ease(0.25, "in"), 0.0625);
});

test("events fire when crossed, wrap on loops, and the wrap key stays quiet", () => {
	const clip = {
		name: "walk",
		loop: true,
		keys: [
			{ t: 0, state: "a", events: ["plant_l"] },
			{ t: 0.5, state: "b", events: ["plant_r"] },
			{ t: 1, state: "a", events: ["never"] },
		],
	};
	assert.deepEqual(clipEvents(clip, 0.1, 0.6), ["plant_r"]);
	assert.deepEqual(clipEvents(clip, 0.6, 0.1 + 1), ["plant_l"]); // across the wrap
	assert.deepEqual(clipEvents(clip, 0.6, 0.6), []);
	assert.deepEqual(clipEvents(clip, 0, 3).sort(), ["plant_l", "plant_r"]);
	const once = { ...clip, loop: false };
	assert.deepEqual(clipEvents(once, 0.9, 1.5), ["never"]); // no loop: the last key fires
});

test("blend tweens shared parts and takes membership from the heavier side", () => {
	const a: StatePart[] = [{ part: "body", rotate: 0 }, { part: "claw_r", rotate: 0 }];
	const b: StatePart[] = [{ part: "body", rotate: 1 }, { part: "claw_l", rotate: 0 }];
	const q = blendPoses(digger, a, b, 0.25);
	assert.deepEqual(q.map((p) => p.part), ["body", "claw_r"]);
	near(q[0].rotate!, 0.25);
	const h = blendPoses(digger, a, b, 0.75);
	assert.deepEqual(h.map((p) => p.part), ["body", "claw_l"]);
	near(h[0].rotate!, 0.75);
});

test("layer moves only the parts it names, base order stands", () => {
	const base: StatePart[] = [{ part: "body", rotate: 0 }, { part: "claw_r", rotate: 0.2 }];
	const over: StatePart[] = [{ part: "claw_r", rotate: 1.2 }, { part: "claw_l" }];
	const half = layerPoses(digger, base, over, 0.5);
	assert.deepEqual(half.map((p) => p.part), ["body", "claw_r", "claw_l"]);
	near(half[0].rotate!, 0);
	near(half[1].rotate!, 0.7);
	const low = layerPoses(digger, base, over, 0.2);
	assert.deepEqual(low.map((p) => p.part), ["body", "claw_r"]);
	near(low[1].rotate!, 0.4);
});

test("attach aligns positions and directions", () => {
	const host = { name: "hand", at: [10, 0] as [number, number], angle: Math.PI / 2 };
	const item = { name: "grip", at: [0, 3] as [number, number], angle: 0 };
	const A = attachXf([1, 0, 0, 1, 0, 0], host, item);
	nearV(xfApply(A, [0, 3]), [10, 0]); // the grip lands on the hand
	nearV(xfApply(A, [1, 3]), [10, 1]); // the item's x axis now points along the hand's angle
});

test("targets: a state's target solves, and clips tween it", () => {
	const doc: Doc = {
		version: 1,
		palette: [{ name: "c", rgb: [1, 1, 1, 255] }],
		parts: [
			{ name: "torso", pivot: [0, 0], shapes: [] },
			{ name: "upper", parent: "torso", pivot: [0, 0], shapes: [] },
			{ name: "fore", parent: "upper", pivot: [5, 0], shapes: [], anchors: [{ name: "hand", at: [10, 0] }] },
		],
		constraints: [{ name: "arm", chain: ["upper", "fore"], end: "fore/hand", bend: 1 }],
		states: [
			{ name: "a", parts: [{ part: "torso" }, { part: "upper" }, { part: "fore" }], targets: [{ chain: "arm", at: [0, 8] }] },
			{ name: "b", parts: [{ part: "torso" }, { part: "upper" }, { part: "fore" }], targets: [{ chain: "arm", at: [8, 0] }] },
		],
		clips: [{ name: "k", keys: [{ t: 0, state: "a" }, { t: 1, state: "b" }] }],
	};
	const poses = doc.states![0].parts.map((p) => ({ ...p }));
	solveTargets(doc, poses, doc.states![0].targets!);
	nearV(chainEndWorld(doc, poses, doc.constraints![0])!, [0, 8], 0.05);
	const mid = sampleTargets(doc, doc.clips![0], 0.5);
	nearV(mid[0].at, [4, 4]);
});

test("a mirrored ancestor: the solver still reaches", () => {
	const doc: Doc = {
		version: 1,
		palette: [{ name: "c", rgb: [1, 1, 1, 255] }],
		parts: [
			{ name: "torso", pivot: [0, 0], shapes: [] },
			{ name: "upper", parent: "torso", pivot: [0, 0], shapes: [] },
			{ name: "fore", parent: "upper", pivot: [5, 0], shapes: [], anchors: [{ name: "hand", at: [10, 0] }] },
		],
		constraints: [{ name: "arm", chain: ["upper", "fore"], end: "fore/hand" }],
	};
	const poses: StatePart[] = [{ part: "torso", mirror: true }, { part: "upper" }, { part: "fore" }];
	assert.ok(xfFlipped(worldTransforms(doc, poses).get("torso")!));
	const d = solveChain(doc, poses, doc.constraints![0], [-3, 7]);
	assert.ok(d < 0.05, `left ${d} away`);
});

test("the validator knows the 1.2 fields and refuses the wrong shapes of them", () => {
	const ok = validate({
		version: 1,
		palette: [{ name: "c", rgb: [1, 1, 1, 255], emissive: 2 }],
		parts: [{ name: "a", shapes: [], anchors: [{ name: "x", at: [0, 0], angle: 1 }] }],
		constraints: [],
		states: [{ name: "s", parts: [{ part: "a", mirror: true }], targets: [] }],
		clips: [{ name: "k", keys: [{ t: 0, state: "s", events: ["hit"], curve: [0.2, 0, 0.8, 1], targets: [] }] }],
	});
	assert.deepEqual(ok.errors, []);
	assert.deepEqual(ok.warnings, []);
	const bad = validate({ version: 1, parts: [{ name: "a" }, { name: "b", like: "a", anchors: [{ name: "x", at: [0, 0] }] }] });
	assert.ok(bad.errors.some((e) => e.code === "like"));
});
