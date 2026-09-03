import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	loadDoc,
	drawList,
	worldTransforms,
	xfApply,
	sampleClip,
	clipDuration,
	solveChain,
	chainEndWorld,
	ease,
	type Vec2,
} from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const hero = loadDoc(await readFile(resolve(here, "../../../spec/examples/valid/hero.fart"), "utf8"));
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: Vec2, b: Vec2, eps = 1e-6) => {
	near(a[0], b[0], eps);
	near(a[1], b[1], eps);
};

test("at rest, parents change nothing", () => {
	for (const e of drawList(hero, "idle")) {
		nearV(xfApply(e.xf, [1, 2]), [1, 2]);
		near(e.scale, 1);
	}
});

test("a child rides its parent", () => {
	// turn the torso a quarter turn about its pivot at the origin: the
	// head's pivot (0,-8) must land at (8,0) even though the head's own
	// entry says nothing
	const poses = [{ part: "torso", rotate: Math.PI / 2 }, { part: "head" }];
	const W = worldTransforms(hero, poses);
	nearV(xfApply(W.get("head")!, [0, -8]), [8, 0]);
	// and the forearm follows the upper arm which follows the torso
	const hand = xfApply(W.get("fore_l")!, [12, 1]);
	nearV(hand, [-1, 12]);
});

test("a parent left out of the pose list contributes identity", () => {
	const W = worldTransforms(hero, [{ part: "head", rotate: 0 }]);
	nearV(xfApply(W.get("head")!, [0, -11]), [0, -11]);
});

test("easing curves hit their ends", () => {
	for (const k of ["linear", "in", "out", "in-out", "step"] as const) {
		near(ease(0, k), 0);
		near(ease(1, k), 1);
	}
	near(ease(0.5, "step"), 0);
	near(ease(0.5, "linear"), 0.5);
});

test("a clip holds outside its keys and tweens between them", () => {
	const wave = hero.clips!.find((c) => c.name === "wave")!;
	near(clipDuration(wave), 0.6);
	const at = (t: number, part: string) => sampleClip(hero, wave, t).find((sp) => sp.part === part)!;
	near(at(0, "upper_l").rotate ?? 0, 0);
	near(at(0.3, "upper_l").rotate!, -1.9);
	// halfway with in-out easing is exactly halfway
	near(at(0.15, "upper_l").rotate!, -0.95);
	// the loop wraps: t = 0.6 is t = 0
	near(at(0.6, "upper_l").rotate ?? 0, 0);
	near(at(0.75, "upper_l").rotate!, -0.95);
});

test("membership and order switch at keys; inline keys work; step holds", () => {
	const nod = hero.clips!.find((c) => c.name === "nod")!;
	// no loop: before the first key the first holds, after the last the last
	near(sampleClip(hero, nod, -1).find((sp) => sp.part === "head")!.rotate ?? 0, 0);
	near(sampleClip(hero, nod, 9).find((sp) => sp.part === "head")!.rotate ?? 0, 0);
	const mid = sampleClip(hero, nod, 0.1);
	assert.deepEqual(mid.map((sp) => sp.part), ["torso", "head", "upper_l", "fore_l"]);
	near(mid.find((sp) => sp.part === "head")!.rotate!, 0.4 * ease(0.5, "out"));
	// the step key: right up to 0.5 the outgoing key holds
	near(sampleClip(hero, nod, 0.49).find((sp) => sp.part === "head")!.rotate!, 0.4);
	near(sampleClip(hero, nod, 0.5).find((sp) => sp.part === "head")!.rotate ?? 0, 0);
});

test("the arm reaches for a target", () => {
	const c = hero.constraints![0];
	const poses = hero.states!.find((s) => s.name === "idle")!.parts.map((sp) => ({ ...sp }));
	const target: Vec2 = [10, -9];
	const left = solveChain(hero, poses, c, target);
	assert.ok(left < 0.05, `still ${left} away`);
	nearV(chainEndWorld(hero, poses, c)!, target, 0.05);
	// only rotations moved
	for (const sp of poses) assert.equal(sp.offset, undefined);
});

test("an unreachable target gets the closest stretch", () => {
	const c = hero.constraints![0];
	const poses = [{ part: "upper_l" }, { part: "fore_l" }];
	const left = solveChain(hero, poses, c, [100, 0]);
	// arm length: |(4,-6)->(9,-3)| + |(9,-3)->(12,1)| = 5.83 + 5 = 10.83
	near(left, 100 - 4 - 10.83, 0.2);
});
