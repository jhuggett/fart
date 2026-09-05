// Clips: states in time. Sampling a clip at a time yields a pose list
// shaped like a state's parts, so anything that draws a state draws a
// frame. Between keys, offset and scale interpolate linearly, rotation
// the short way round, and the incoming key's ease bends the fraction.

import type { Clip, ClipKey, Curve, Doc, Ease, StatePart, Target, Vec2 } from "./types.ts";
import { partOf, pivotOf, stateOf } from "./geometry.ts";

/** A CSS-style cubic bezier from (0,0) to (1,1): y at time x, by Newton on x. */
export function bezier(curve: Curve, x: number): number {
	const [x1, y1, x2, y2] = curve;
	if (x <= 0) return 0;
	if (x >= 1) return 1;
	const cx = 3 * x1;
	const bx = 3 * (x2 - x1) - cx;
	const ax = 1 - cx - bx;
	const cy = 3 * y1;
	const by = 3 * (y2 - y1) - cy;
	const ay = 1 - cy - by;
	const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
	const sy = (t: number) => ((ay * t + by) * t + cy) * t;
	let t = x;
	for (let i = 0; i < 8; i++) {
		const d = (3 * ax * t + 2 * bx) * t + cx;
		if (Math.abs(d) < 1e-6) break;
		const e = sx(t) - x;
		if (Math.abs(e) < 1e-6) break;
		t -= e / d;
	}
	// a bisection guard for the flat spots Newton skids on
	if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 24; i++) {
			t = (lo + hi) / 2;
			if (sx(t) < x) lo = t;
			else hi = t;
		}
	}
	return sy(t);
}

/** The eased fraction: a curve (1.2) wins over a named ease. */
export function ease(u: number, kind: Ease = "linear", curve?: Curve): number {
	const x = Math.min(1, Math.max(0, u));
	if (curve && curve.length === 4) return bezier(curve, x);
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
	const u = ease(span > 0 ? (time - A.t) / span : 1, B.ease, B.curve);
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
		if (a.mirror) out.mirror = true; // a flip does not tween: the outgoing key's
		return out;
	});
}

function copy(sp: StatePart): StatePart {
	return { ...sp, offset: sp.offset ? [sp.offset[0], sp.offset[1]] : undefined };
}

// ------------------------------------------------------------- 1.2

/** The targets a key carries: its own, else its state's. */
export function keyTargets(doc: Doc, key: ClipKey): Target[] {
	if (key.targets) return key.targets;
	if (key.state !== undefined) return stateOf(doc, key.state)?.targets ?? [];
	return [];
}

/** Where the chains should reach at time t: tweened where both keys name a chain, else the outgoing key's. */
export function sampleTargets(doc: Doc, clip: Clip, t: number): Target[] {
	const keys = clip.keys;
	if (!keys.length) return [];
	const dur = clipDuration(clip);
	let time = t;
	if (clip.loop && dur > 0) time = ((t % dur) + dur) % dur;
	if (time <= keys[0].t) return keyTargets(doc, keys[0]).map(copyTarget);
	const last = keys[keys.length - 1];
	if (time >= last.t) return keyTargets(doc, last).map(copyTarget);
	let i = 0;
	while (i + 1 < keys.length && keys[i + 1].t <= time) i++;
	const A = keys[i];
	const B = keys[i + 1];
	const span = B.t - A.t;
	const u = ease(span > 0 ? (time - A.t) / span : 1, B.ease, B.curve);
	const to = new Map(keyTargets(doc, B).map((tg) => [tg.chain, tg]));
	return keyTargets(doc, A).map((a) => {
		const b = to.get(a.chain);
		if (!b) return copyTarget(a);
		return { chain: a.chain, at: [lerp(a.at[0], b.at[0], u), lerp(a.at[1], b.at[1], u)] };
	});
}

function copyTarget(tg: Target): Target {
	return { ...tg, at: [tg.at[0], tg.at[1]] };
}

/**
 * The events the playhead crossed going from t0 to t1: keys with a time
 * in (t0, t1]. On a loop the interval may wrap; the wrap key itself (the
 * last one) never fires, since the first key at 0 stands for it.
 */
export function clipEvents(clip: Clip, t0: number, t1: number): string[] {
	const out: string[] = [];
	const keys = clip.keys;
	const dur = clipDuration(clip);
	if (!keys.length) return out;
	const fire = (lo: number, hi: number, wrapEnd: boolean) => {
		for (const k of keys) {
			if (!k.events?.length) continue;
			if (k.t > lo && (wrapEnd ? k.t < hi : k.t <= hi)) out.push(...k.events);
		}
	};
	if (!clip.loop || dur <= 0) {
		fire(t0, t1, false);
		return out;
	}
	const wrap = (t: number) => ((t % dur) + dur) % dur;
	const a = wrap(t0);
	const b = wrap(t1);
	if (t1 - t0 >= dur) {
		// a whole loop or more went by: everything, once
		fire(-Infinity, dur, true);
		return out;
	}
	if (b >= a) fire(a, b, false);
	else {
		fire(a, dur, true);
		fire(-1, b, false); // includes the first key at 0
	}
	return out;
}

/**
 * Two poses at once (1.2): every part in both lists tweens by w, and
 * membership and paint order come from the heavier side (b once w
 * reaches 0.5). A crossfade is this with a ramping w.
 */
export function blendPoses(doc: Doc, a: readonly StatePart[], b: readonly StatePart[], w: number): StatePart[] {
	const u = Math.min(1, Math.max(0, w));
	const lead = u < 0.5 ? a : b;
	const other = new Map((u < 0.5 ? b : a).map((sp) => [sp.part, sp]));
	return lead.map((sp) => {
		const o = other.get(sp.part);
		if (!o) return copy(sp);
		// tween from the a-side pose to the b-side pose, whichever list leads
		const from = u < 0.5 ? sp : o;
		const to = u < 0.5 ? o : sp;
		return mix(doc, from, to, u, sp.mirror);
	});
}

/**
 * A layer over a base (1.2): parts the layer names tween toward it by w,
 * the rest keep the base pose; the base's order stands, and a part only
 * the layer has joins the end once w reaches 0.5. A head turn over a
 * gait, a flinch with a weight that rises and falls.
 */
export function layerPoses(doc: Doc, base: readonly StatePart[], over: readonly StatePart[], w: number): StatePart[] {
	const u = Math.min(1, Math.max(0, w));
	const top = new Map(over.map((sp) => [sp.part, sp]));
	const out = base.map((sp) => {
		const o = top.get(sp.part);
		return o ? mix(doc, sp, o, u, u < 0.5 ? sp.mirror : o.mirror) : copy(sp);
	});
	if (u >= 0.5) {
		const have = new Set(base.map((sp) => sp.part));
		for (const sp of over) if (!have.has(sp.part)) out.push(copy(sp));
	}
	return out;
}

function mix(doc: Doc, a: StatePart, b: StatePart, u: number, mirror: boolean | undefined): StatePart {
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
	if (mirror) out.mirror = true;
	return out;
}
