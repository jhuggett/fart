// Clips: states in time. Sampling a clip at a time yields a pose list
// shaped like a state's parts, so anything that draws a state draws a
// frame. Between keys, offset and scale interpolate linearly, rotation
// the short way round, and the incoming key's ease bends the fraction.

import type { Clip, ClipKey, Doc, Ease, StatePart, Vec2 } from "./types.ts";
import { partOf, pivotOf, stateOf } from "./geometry.ts";

export function ease(u: number, kind: Ease = "linear"): number {
	const x = Math.min(1, Math.max(0, u));
	switch (kind) {
		case "in":
			return x * x;
		case "out":
			return 1 - (1 - x) * (1 - x);
		case "in-out":
			return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
		case "step":
			return x >= 1 ? 1 : 0;
		default:
			return x;
	}
}

/** The last key's time; a clip with one key is a still. */
export function clipDuration(clip: Clip): number {
	return clip.keys.length ? clip.keys[clip.keys.length - 1].t : 0;
}

/** The pose list a key stands for. */
export function keyPoses(doc: Doc, key: ClipKey): StatePart[] {
	if (key.parts) return key.parts;
	if (key.state !== undefined) return stateOf(doc, key.state)?.parts ?? [];
	return [];
}

/** The shortest turn from a to b, applied a fraction u. */
export function lerpAngle(a: number, b: number, u: number): number {
	let d = (b - a) % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return a + d * u;
}

function lerp(a: number, b: number, u: number): number {
	return a + (b - a) * u;
}

/**
 * The frame at time t (seconds). Membership and paint order come from the
 * outgoing key; parts the incoming key also has tween toward it, the rest
 * hold. Loops wrap at the last key.
 */
export function sampleClip(doc: Doc, clip: Clip, t: number): StatePart[] {
	const keys = clip.keys;
	if (!keys.length) return [];
	const dur = clipDuration(clip);
	let time = t;
	if (clip.loop && dur > 0) time = ((t % dur) + dur) % dur;
	if (time <= keys[0].t) return keyPoses(doc, keys[0]).map(copy);
	const last = keys[keys.length - 1];
	if (time >= last.t) return keyPoses(doc, last).map(copy);
	let i = 0;
	while (i + 1 < keys.length && keys[i + 1].t <= time) i++;
	const A = keys[i];
	const B = keys[i + 1];
	const span = B.t - A.t;
	const u = ease(span > 0 ? (time - A.t) / span : 1, B.ease);
	const from = keyPoses(doc, A);
	const to = new Map(keyPoses(doc, B).map((sp) => [sp.part, sp]));
	return from.map((a) => {
		const b = to.get(a.part);
		if (!b) return copy(a);
		const part = partOf(doc, a.part);
		const pv: Vec2 = part ? pivotOf(part) : [0, 0];
		const oa = a.offset ?? pv;
		const ob = b.offset ?? pv;
		const sa = a.scale === undefined || a.scale === 0 ? 1 : a.scale;
		const sb = b.scale === undefined || b.scale === 0 ? 1 : b.scale;
		const out: StatePart = {
			part: a.part,
			offset: [lerp(oa[0], ob[0], u), lerp(oa[1], ob[1], u)],
			rotate: lerpAngle(a.rotate ?? 0, b.rotate ?? 0, u),
			scale: lerp(sa, sb, u),
		};
		return out;
	});
}

function copy(sp: StatePart): StatePart {
	return { ...sp, offset: sp.offset ? [sp.offset[0], sp.offset[1]] : undefined };
}
