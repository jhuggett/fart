// Chains in 3D (1.3): the same constraints as 2D with a third axis. The
// reference solver is cyclic coordinate descent: each joint, end first,
// turns about the axis that swings the end toward the target, in its
// parent's frame; an optional pole leans the elbow toward a point.

import type { Constraint, Doc3, StatePart3, Target3, Vec3 } from "./types.ts";
import { partOf3, anchorsOf3, worldTransforms3, xf3Apply, xf3ApplyDir, xf3Invert, xf3Det, pivotOf3, quatAxis, quatFromEuler, quatMul, quatToEuler, v3cross, v3dot, v3norm, v3sub, v3len, type Xf3 } from "./space3.ts";

/** The anchor a constraint reaches with: its part and rest-space point. */
export function chainEnd3(doc: Doc3, c: Constraint): { part: string; at: Vec3 } | null {
	const slash = c.end.indexOf("/");
	if (slash < 0 || !c.chain.length) return null;
	const pn = c.end.slice(0, slash);
	const an = c.end.slice(slash + 1);
	if (c.chain[c.chain.length - 1] !== pn) return null;
	const part = partOf3(doc, pn);
	if (!part) return null;
	const a = anchorsOf3(doc, part).find((x) => x.name === an);
	return a ? { part: pn, at: a.at } : null;
}

export function chainEndWorld3(doc: Doc3, poses: readonly StatePart3[], c: Constraint): Vec3 | null {
	const end = chainEnd3(doc, c);
	if (!end) return null;
	const W = worldTransforms3(doc, poses);
	return xf3Apply(W.get(end.part) ?? [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], end.at);
}

/** A turn of a pose about a world-space axis through its pivot, expressed in the parent's frame. */
function turnAbout(doc: Doc3, poses: StatePart3[], W: Map<string, Xf3>, name: string, axisWorld: Vec3, angle: number) {
	const part = partOf3(doc, name);
	const sp = poses.find((p) => p.part === name);
	if (!part || !sp || Math.abs(angle) < 1e-9) return;
	const parentW = part.parent ? W.get(part.parent) : undefined;
	let axis = axisWorld;
	let a = angle;
	if (parentW) {
		axis = v3norm(xf3ApplyDir(xf3Invert(parentW), axisWorld));
		if (xf3Det(parentW) < 0) a = -a; // a mirrored parent turns the other way
	}
	const q = quatMul(quatAxis(axis, a), quatFromEuler(sp.rotate ?? [0, 0, 0]));
	sp.rotate = quatToEuler(q).map((x) => Math.round(x * 1e5) / 1e5) as Vec3;
}

/**
 * Turn the chain's parts so the end anchor reaches `target` (document
 * space), editing `poses` in place: entries are added for chain parts
 * the list lacks, and only `rotate` changes. With a pole, the first
 * joint after the root is swung toward it about the root-to-end line.
 * Returns the distance left.
 */
export function solveChain3(doc: Doc3, poses: StatePart3[], c: Constraint, target: Vec3, iterations = 16, tolerance = 0.01): number {
	const end = chainEnd3(doc, c);
	if (!end) return Infinity;
	for (const name of c.chain) {
		if (!poses.some((p) => p.part === name)) {
			const part = partOf3(doc, name);
			poses.push({ part: name, offset: part ? pivotOf3(part) : [0, 0, 0] });
		}
	}
	let dist = Infinity;
	for (let it = 0; it < iterations; it++) {
		for (let i = c.chain.length - 1; i >= 0; i--) {
			const part = partOf3(doc, c.chain[i]);
			if (!part) continue;
			const W = worldTransforms3(doc, poses);
			const e = xf3Apply(W.get(end.part)!, end.at);
			const j = xf3Apply(W.get(part.name)!, pivotOf3(part));
			const ve = v3sub(e, j);
			const vt = v3sub(target, j);
			const le = v3len(ve);
			const lt = v3len(vt);
			if (le < 1e-9 || lt < 1e-9) continue;
			const axis = v3cross(ve, vt);
			if (v3len(axis) < 1e-9) continue;
			const angle = Math.acos(Math.max(-1, Math.min(1, v3dot(ve, vt) / (le * lt))));
			turnAbout(doc, poses, W, part.name, v3norm(axis), angle);
		}
		const e = chainEndWorld3(doc, poses, c)!;
		dist = v3len(v3sub(e, target));
		if (dist < tolerance) break;
	}
	if (c.pole && c.chain.length >= 2) swingToPole(doc, poses, c, c.pole);
	return dist;
}

/** Swing the chain about its root-to-end line so the first elbow leans toward the pole; the end stays put. */
function swingToPole(doc: Doc3, poses: StatePart3[], c: Constraint, pole: Vec3) {
	const end = chainEnd3(doc, c);
	if (!end) return;
	const W = worldTransforms3(doc, poses);
	const root = partOf3(doc, c.chain[0]);
	const elbow = partOf3(doc, c.chain[1]);
	if (!root || !elbow) return;
	const r = xf3Apply(W.get(root.name)!, pivotOf3(root));
	const e = xf3Apply(W.get(end.part)!, end.at);
	const m = xf3Apply(W.get(elbow.name)!, pivotOf3(elbow));
	const axis = v3norm(v3sub(e, r));
	if (v3len(v3sub(e, r)) < 1e-9) return;
	// the elbow and the pole, flattened onto the plane across the axis
	const flat = (p: Vec3): Vec3 => {
		const d = v3sub(p, r);
		const k = v3dot(d, axis);
		return [d[0] - axis[0] * k, d[1] - axis[1] * k, d[2] - axis[2] * k];
	};
	const a = flat(m);
	const b = flat(pole);
	if (v3len(a) < 1e-9 || v3len(b) < 1e-9) return;
	const cr = v3cross(a, b);
	const angle = Math.atan2(v3dot(cr, axis), v3dot(a, b));
	turnAbout(doc, poses, W, root.name, axis, angle);
}

/** Reach every target a pose carries, in place. */
export function solveTargets3(doc: Doc3, poses: StatePart3[], targets: readonly Target3[]) {
	for (const tg of targets) {
		const c = doc.constraints?.find((k) => k.name === tg.chain);
		if (c) solveChain3(doc, poses, c, tg.at);
	}
}
