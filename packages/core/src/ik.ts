// Inverse kinematics over a constraint's chain: cyclic coordinate descent
// on the parts' rotations. The joints are the parts' pivots, the last bone
// ends at the constraint's anchor, and every frame of the chain is a
// similarity (rotation and uniform scale), so a world-space turn about a
// pivot is the same turn in the part's own frame.

import type { Constraint, Doc, StatePart, Vec2 } from "./types.ts";
import { partOf, pivotOf, worldTransforms, xfApply } from "./geometry.ts";

export interface ChainEnd {
	part: string;
	anchor: string;
	at: Vec2;
}

/** The anchor a constraint reaches with, or null when the file is wrong. */
export function chainEnd(doc: Doc, c: Constraint): ChainEnd | null {
	const i = c.end.indexOf("/");
	if (i < 0) return null;
	const partName = c.end.slice(0, i);
	const anchorName = c.end.slice(i + 1);
	if (c.chain[c.chain.length - 1] !== partName) return null;
	const part = partOf(doc, partName);
	const anchor = part?.anchors?.find((a) => a.name === anchorName);
	if (!part || !anchor) return null;
	return { part: partName, anchor: anchorName, at: anchor.at };
}

/** Where a chain's end anchor sits in the world under a pose list. */
export function chainEndWorld(doc: Doc, poses: readonly StatePart[], c: Constraint): Vec2 | null {
	const end = chainEnd(doc, c);
	if (!end) return null;
	const W = worldTransforms(doc, poses);
	const xf = W.get(end.part);
	return xf ? xfApply(xf, end.at) : null;
}

function wrap(a: number): number {
	let r = a % (Math.PI * 2);
	if (r > Math.PI) r -= Math.PI * 2;
	if (r < -Math.PI) r += Math.PI * 2;
	return r;
}

/**
 * Turn the chain's parts so the end anchor reaches `target` (document
 * space), editing `poses` in place: entries are added for chain parts the
 * list lacks, and only `rotate` changes. Returns the remaining distance.
 */
export function solveChain(doc: Doc, poses: StatePart[], c: Constraint, target: Vec2, iterations = 16, tolerance = 0.01): number {
	const end = chainEnd(doc, c);
	if (!end) return Infinity;
	const entries: StatePart[] = [];
	for (const name of c.chain) {
		let sp = poses.find((p) => p.part === name);
		if (!sp) {
			sp = { part: name };
			poses.push(sp);
		}
		entries.push(sp);
	}
	// a nudge toward the preferred bend, so an elbow at full stretch
	// knows which way to fold
	if (c.bend && entries.length >= 2) {
		const mid = entries[entries.length - 1];
		if (!mid.rotate) mid.rotate = 0.02 * c.bend;
	}
	let dist = Infinity;
	for (let it = 0; it < iterations; it++) {
		for (let i = c.chain.length - 1; i >= 0; i--) {
			const W = worldTransforms(doc, poses);
			const endXf = W.get(end.part);
			const partXf = W.get(c.chain[i]);
			const part = partOf(doc, c.chain[i]);
			if (!endXf || !partXf || !part) continue;
			const e = xfApply(endXf, end.at);
			const j = xfApply(partXf, pivotOf(part));
			const a1 = Math.atan2(e[1] - j[1], e[0] - j[0]);
			const a2 = Math.atan2(target[1] - j[1], target[0] - j[0]);
			entries[i].rotate = wrap((entries[i].rotate ?? 0) + (a2 - a1));
		}
		const e = chainEndWorld(doc, poses, c);
		dist = e ? Math.hypot(e[0] - target[0], e[1] - target[1]) : Infinity;
		if (dist < tolerance) break;
	}
	return dist;
}
