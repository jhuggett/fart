// 3D (1.3): the same words with a third coordinate. Vectors, turns as
// quaternions (Euler [x, y, z] in the file, slerp between keys), the
// local and world maps, sampling clips, blending and layering, and the
// triangulation editors bake into a mesh's tris. The reference Odin
// loader (fastart3d.odin) does the same sums, so every reader agrees.

import type { Anchor3, Clip3, ClipKey3, Doc3, Part3, Shape3, State3, StatePart3, Target3, Vec3 } from "./types.ts";
import { ease } from "./clips.ts";
import { triangulate } from "./geometry.ts";
import type { Vec2 } from "./types.ts";

// ----------------------------------------------------------------- vectors

export function v3add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function v3sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function v3scale(a: Vec3, k: number): Vec3 {
	return [a[0] * k, a[1] * k, a[2] * k];
}
export function v3dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function v3cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function v3len(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2]);
}
export function v3norm(a: Vec3): Vec3 {
	const l = v3len(a);
	return l > 0 ? v3scale(a, 1 / l) : [0, 0, 0];
}
function lerp3(a: Vec3, b: Vec3, u: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

// ----------------------------------------------------------------- quaternions
// [x, y, z, w]. A turn about an axis is right-handed: about z, x goes toward y.

export type Quat = [number, number, number, number];
export const QUAT_ID: Quat = [0, 0, 0, 1];

export function quatMul(a: Quat, b: Quat): Quat {
	return [
		a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
		a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
		a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
		a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
	];
}

export function quatAxis(axis: Vec3, angle: number): Quat {
	const n = v3norm(axis);
	const s = Math.sin(angle / 2);
	return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

/** The file's turn: about x, then y, then z; q = qz · qy · qx. */
export function quatFromEuler(e: Vec3): Quat {
	const qx = quatAxis([1, 0, 0], e[0]);
	const qy = quatAxis([0, 1, 0], e[1]);
	const qz = quatAxis([0, 0, 1], e[2]);
	return quatMul(qz, quatMul(qy, qx));
}

/** Row-major 3×3 of a unit quaternion. */
export function quatToMat(q: Quat): number[] {
	const [x, y, z, w] = q;
	return [
		1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
		2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
		2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
	];
}

/** Back to the file's [x, y, z] (R = Rz · Ry · Rx). Gimbal lock puts the whole turn on z. */
export function matToEuler(m: number[]): Vec3 {
	const sy = -m[6];
	if (Math.abs(sy) > 1 - 1e-9) {
		return [0, Math.asin(Math.max(-1, Math.min(1, sy))), Math.atan2(-m[1], m[4])];
	}
	return [Math.atan2(m[7], m[8]), Math.asin(sy), Math.atan2(m[3], m[0])];
}

export function quatToEuler(q: Quat): Vec3 {
	return matToEuler(quatToMat(q));
}

/** The short way round: the spherical interpolation of a toward b by u. */
export function quatSlerp(a: Quat, b: Quat, u: number): Quat {
	let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	let bb: Quat = b;
	if (d < 0) {
		d = -d;
		bb = [-b[0], -b[1], -b[2], -b[3]];
	}
	let ka: number;
	let kb: number;
	if (d > 0.9995) {
		ka = 1 - u;
		kb = u;
	} else {
		const th = Math.acos(Math.min(1, d));
		const s = Math.sin(th);
		ka = Math.sin((1 - u) * th) / s;
		kb = Math.sin(u * th) / s;
	}
	const out: Quat = [a[0] * ka + bb[0] * kb, a[1] * ka + bb[1] * kb, a[2] * ka + bb[2] * kb, a[3] * ka + bb[3] * kb];
	const l = Math.hypot(...out) || 1;
	return [out[0] / l, out[1] / l, out[2] / l, out[3] / l];
}

/** Tween two file turns as rotations, the short way round. */
export function lerpEuler(a: Vec3, b: Vec3, u: number): Vec3 {
	return quatToEuler(quatSlerp(quatFromEuler(a), quatFromEuler(b), u));
}

// ----------------------------------------------------------------- transforms
// A 3D affine map: a row-major 3×3 linear part, then a translation.
// x' = m0 x + m1 y + m2 z + m9, y' = m3 x + m4 y + m5 z + m10, z' = m6 x + m7 y + m8 z + m11.

export type Xf3 = [number, number, number, number, number, number, number, number, number, number, number, number];
export const XF3_ID: Xf3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function xf3Apply(T: Xf3, p: Vec3): Vec3 {
	return [
		T[0] * p[0] + T[1] * p[1] + T[2] * p[2] + T[9],
		T[3] * p[0] + T[4] * p[1] + T[5] * p[2] + T[10],
		T[6] * p[0] + T[7] * p[1] + T[8] * p[2] + T[11],
	];
}

/** The linear part only: for directions. */
export function xf3ApplyDir(T: Xf3, v: Vec3): Vec3 {
	return [T[0] * v[0] + T[1] * v[1] + T[2] * v[2], T[3] * v[0] + T[4] * v[1] + T[5] * v[2], T[6] * v[0] + T[7] * v[1] + T[8] * v[2]];
}

/** (A ∘ B)(p) = A(B(p)). */
export function xf3Mul(A: Xf3, B: Xf3): Xf3 {
	const out = XF3_ID.slice() as Xf3;
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 3; c++) out[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
		out[9 + r] = A[r * 3] * B[9] + A[r * 3 + 1] * B[10] + A[r * 3 + 2] * B[11] + A[9 + r];
	}
	return out;
}

export function xf3Det(T: Xf3): number {
	return T[0] * (T[4] * T[8] - T[5] * T[7]) - T[1] * (T[3] * T[8] - T[5] * T[6]) + T[2] * (T[3] * T[7] - T[4] * T[6]);
}

export function xf3Invert(T: Xf3): Xf3 {
	const det = xf3Det(T) || 1e-12;
	const i = 1 / det;
	const L: number[] = [
		(T[4] * T[8] - T[5] * T[7]) * i, (T[2] * T[7] - T[1] * T[8]) * i, (T[1] * T[5] - T[2] * T[4]) * i,
		(T[5] * T[6] - T[3] * T[8]) * i, (T[0] * T[8] - T[2] * T[6]) * i, (T[2] * T[3] - T[0] * T[5]) * i,
		(T[3] * T[7] - T[4] * T[6]) * i, (T[1] * T[6] - T[0] * T[7]) * i, (T[0] * T[4] - T[1] * T[3]) * i,
	];
	const t = [T[9], T[10], T[11]];
	return [
		L[0], L[1], L[2], L[3], L[4], L[5], L[6], L[7], L[8],
		-(L[0] * t[0] + L[1] * t[1] + L[2] * t[2]),
		-(L[3] * t[0] + L[4] * t[1] + L[5] * t[2]),
		-(L[6] * t[0] + L[7] * t[1] + L[8] * t[2]),
	];
}

/** The uniform scale a map applies (a turn, a scale and maybe a mirror). */
export function xf3Scale(T: Xf3): number {
	return Math.cbrt(Math.abs(xf3Det(T)));
}

/** Does the map flip handedness (an odd number of mirrors)? */
export function xf3Flipped(T: Xf3): boolean {
	return xf3Det(T) < 0;
}

/** A pure turn as a map. */
export function turnXf3(e: Vec3): Xf3 {
	const m = quatToMat(quatFromEuler(e));
	return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], 0, 0, 0];
}

export function pivotOf3(part: Part3): Vec3 {
	return part.pivot ?? [0, 0, 0];
}

export interface Pose3 {
	offset: Vec3;
	rotate: Vec3;
	scale: number;
	mirror: boolean;
}

export function poseOf3(sp: StatePart3, part: Part3): Pose3 {
	return {
		offset: sp.offset ?? pivotOf3(part),
		rotate: sp.rotate ?? [0, 0, 0],
		scale: sp.scale === undefined || sp.scale === 0 ? 1 : sp.scale,
		mirror: sp.mirror === true,
	};
}

/** translate(offset) · Rz · Ry · Rx · scale · mirror · translate(−pivot). */
export function localXf3(part: Part3, sp: StatePart3 | undefined): Xf3 {
	if (!sp) return XF3_ID;
	const pv = pivotOf3(part);
	const { offset, rotate, scale, mirror } = poseOf3(sp, part);
	const m = quatToMat(quatFromEuler(rotate));
	const mx = mirror ? -1 : 1;
	// linear = R · scale · mirror(x)
	const L: number[] = [m[0] * scale * mx, m[1] * scale, m[2] * scale, m[3] * scale * mx, m[4] * scale, m[5] * scale, m[6] * scale * mx, m[7] * scale, m[8] * scale];
	return [
		L[0], L[1], L[2], L[3], L[4], L[5], L[6], L[7], L[8],
		offset[0] - (L[0] * pv[0] + L[1] * pv[1] + L[2] * pv[2]),
		offset[1] - (L[3] * pv[0] + L[4] * pv[1] + L[5] * pv[2]),
		offset[2] - (L[6] * pv[0] + L[7] * pv[1] + L[8] * pv[2]),
	];
}

/** Every part's world map under a pose list: W = W(parent) · L. Parts the list leaves out contribute identity. */
export function worldTransforms3(doc: Doc3, poses?: readonly StatePart3[]): Map<string, Xf3> {
	const parts = doc.parts ?? [];
	const byName = new Map(parts.map((p) => [p.name, p]));
	const poseOfName = new Map((poses ?? []).map((sp) => [sp.part, sp]));
	const out = new Map<string, Xf3>();
	const visiting = new Set<string>();
	const world = (name: string): Xf3 => {
		const done = out.get(name);
		if (done) return done;
		const part = byName.get(name);
		if (!part) return XF3_ID;
		const local = localXf3(part, poseOfName.get(name));
		let W = local;
		if (part.parent && byName.has(part.parent) && !visiting.has(name)) {
			visiting.add(name);
			W = xf3Mul(world(part.parent), local);
			visiting.delete(name);
		}
		out.set(name, W);
		return W;
	};
	for (const p of parts) world(p.name);
	return out;
}

/**
 * Attaching (1.3): positions matched and, where both anchors have a
 * dir, the item turned by the shortest rotation taking its dir onto
 * the host's. Draw the item's rest space through hostXf · this.
 */
export function attachXf3(hostXf: Xf3, host: Anchor3, item: Anchor3): Xf3 {
	let R: Xf3 = XF3_ID;
	if (host.dir && item.dir) {
		const a = v3norm(item.dir);
		const b = v3norm(host.dir);
		const axis = v3cross(a, b);
		const d = Math.max(-1, Math.min(1, v3dot(a, b)));
		if (v3len(axis) > 1e-9) R = xf3FromQuat(quatAxis(axis, Math.acos(d)));
		else if (d < 0) {
			// opposite: half a turn about anything perpendicular
			const perp = Math.abs(a[0]) < 0.9 ? v3cross(a, [1, 0, 0]) : v3cross(a, [0, 1, 0]);
			R = xf3FromQuat(quatAxis(perp, Math.PI));
		}
	}
	const moved = xf3ApplyDir(R, item.at);
	const T: Xf3 = [...R.slice(0, 9), host.at[0] - moved[0], host.at[1] - moved[1], host.at[2] - moved[2]] as Xf3;
	return xf3Mul(hostXf, T);
}

function xf3FromQuat(q: Quat): Xf3 {
	const m = quatToMat(q);
	return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], 0, 0, 0];
}

// ----------------------------------------------------------------- lookups

export function partOf3(doc: Doc3, name: string): Part3 | undefined {
	return doc.parts?.find((p) => p.name === name);
}
export function stateOf3(doc: Doc3, name: string): State3 | undefined {
	return doc.states?.find((s) => s.name === name);
}
export function sourceOf3(doc: Doc3, part: Part3): Part3 {
	if (!part.like) return part;
	const src = partOf3(doc, part.like);
	return src && src !== part && !src.like ? src : part;
}
export function shapesOf3(doc: Doc3, part: Part3): Shape3[] {
	return sourceOf3(doc, part).shapes ?? [];
}
export function anchorsOf3(doc: Doc3, part: Part3): Anchor3[] {
	return sourceOf3(doc, part).anchors ?? [];
}

// ----------------------------------------------------------------- clips

export function keyPoses3(doc: Doc3, key: ClipKey3): StatePart3[] {
	if (key.parts) return key.parts;
	if (key.state !== undefined) return stateOf3(doc, key.state)?.parts ?? [];
	return [];
}

export function clipDuration3(clip: Clip3): number {
	return clip.keys.length ? clip.keys[clip.keys.length - 1].t : 0;
}

function copy3(sp: StatePart3): StatePart3 {
	const out: StatePart3 = { ...sp };
	if (sp.offset) out.offset = [...sp.offset] as Vec3;
	if (sp.rotate) out.rotate = [...sp.rotate] as Vec3;
	return out;
}

function mix3(doc: Doc3, a: StatePart3, b: StatePart3, u: number, mirror: boolean | undefined): StatePart3 {
	const part = partOf3(doc, a.part);
	const pv: Vec3 = part ? pivotOf3(part) : [0, 0, 0];
	const sa = a.scale === undefined || a.scale === 0 ? 1 : a.scale;
	const sb = b.scale === undefined || b.scale === 0 ? 1 : b.scale;
	const out: StatePart3 = {
		part: a.part,
		offset: lerp3(a.offset ?? pv, b.offset ?? pv, u),
		rotate: lerpEuler(a.rotate ?? [0, 0, 0], b.rotate ?? [0, 0, 0], u),
		scale: sa + (sb - sa) * u,
	};
	if (mirror) out.mirror = true;
	return out;
}

/** The frame at time t: membership and order from the outgoing key, poses tweened toward the incoming one. */
export function sampleClip3(doc: Doc3, clip: Clip3, t: number): StatePart3[] {
	const keys = clip.keys;
	if (!keys.length) return [];
	const dur = clipDuration3(clip);
	let time = t;
	if (clip.loop && dur > 0) time = ((t % dur) + dur) % dur;
	if (time <= keys[0].t) return keyPoses3(doc, keys[0]).map(copy3);
	const last = keys[keys.length - 1];
	if (time >= last.t) return keyPoses3(doc, last).map(copy3);
	let i = 0;
	while (i + 1 < keys.length && keys[i + 1].t <= time) i++;
	const A = keys[i];
	const B = keys[i + 1];
	const span = B.t - A.t;
	const u = ease(span > 0 ? (time - A.t) / span : 1, B.ease, B.curve);
	const to = new Map(keyPoses3(doc, B).map((sp) => [sp.part, sp]));
	return keyPoses3(doc, A).map((a) => {
		const b = to.get(a.part);
		return b ? mix3(doc, a, b, u, a.mirror) : copy3(a);
	});
}

/** The targets a key carries: its own, else its state's. */
export function keyTargets3(doc: Doc3, key: ClipKey3): Target3[] {
	if (key.targets) return key.targets;
	if (key.state !== undefined) return stateOf3(doc, key.state)?.targets ?? [];
	return [];
}

/** Where the chains should reach at time t: tweened where both keys name a chain, else the outgoing key's. */
export function sampleTargets3(doc: Doc3, clip: Clip3, t: number): Target3[] {
	const keys = clip.keys;
	if (!keys.length) return [];
	const dur = clipDuration3(clip);
	let time = t;
	if (clip.loop && dur > 0) time = ((t % dur) + dur) % dur;
	const copy = (tg: Target3): Target3 => ({ ...tg, at: [...tg.at] as Vec3 });
	if (time <= keys[0].t) return keyTargets3(doc, keys[0]).map(copy);
	const last = keys[keys.length - 1];
	if (time >= last.t) return keyTargets3(doc, last).map(copy);
	let i = 0;
	while (i + 1 < keys.length && keys[i + 1].t <= time) i++;
	const A = keys[i];
	const B = keys[i + 1];
	const span = B.t - A.t;
	const u = ease(span > 0 ? (time - A.t) / span : 1, B.ease, B.curve);
	const to = new Map(keyTargets3(doc, B).map((tg) => [tg.chain, tg]));
	return keyTargets3(doc, A).map((a) => {
		const b = to.get(a.chain);
		return b ? { chain: a.chain, at: lerp3(a.at, b.at, u) } : copy(a);
	});
}

/** Two poses at once: see FORMAT.md, Blending and layering; turns slerp. */
export function blendPoses3(doc: Doc3, a: readonly StatePart3[], b: readonly StatePart3[], w: number): StatePart3[] {
	const u = Math.min(1, Math.max(0, w));
	const lead = u < 0.5 ? a : b;
	const other = new Map((u < 0.5 ? b : a).map((sp) => [sp.part, sp]));
	return lead.map((sp) => {
		const o = other.get(sp.part);
		if (!o) return copy3(sp);
		return u < 0.5 ? mix3(doc, sp, o, u, sp.mirror) : mix3(doc, o, sp, u, sp.mirror);
	});
}

export function layerPoses3(doc: Doc3, base: readonly StatePart3[], over: readonly StatePart3[], w: number): StatePart3[] {
	const u = Math.min(1, Math.max(0, w));
	const top = new Map(over.map((sp) => [sp.part, sp]));
	const out = base.map((sp) => {
		const o = top.get(sp.part);
		return o ? mix3(doc, sp, o, u, u < 0.5 ? sp.mirror : o.mirror) : copy3(sp);
	});
	if (u >= 0.5) {
		const have = new Set(base.map((sp) => sp.part));
		for (const sp of over) if (!have.has(sp.part)) out.push(copy3(sp));
	}
	return out;
}

// ----------------------------------------------------------------- meshes

/** A face's outward normal, unnormalised: (p1 − p0) × (p2 − p0), the winding the format promises. */
export function faceNormal(points: readonly Vec3[], face: readonly number[]): Vec3 {
	if (face.length < 3) return [0, 0, 0];
	// Newell's method: robust for concave and slightly bent loops
	const n: Vec3 = [0, 0, 0];
	for (let i = 0; i < face.length; i++) {
		const a = points[face[i]];
		const b = points[face[(i + 1) % face.length]];
		if (!a || !b) return [0, 0, 0];
		n[0] += (a[1] - b[1]) * (a[2] + b[2]);
		n[1] += (a[2] - b[2]) * (a[0] + b[0]);
		n[2] += (a[0] - b[0]) * (a[1] + b[1]);
	}
	return n;
}

/** Triangles for one face: ear clipping in the face's own plane, as index triples into points. */
export function triangulateFace(points: readonly Vec3[], face: readonly number[]): number[] {
	if (face.length < 3) return [];
	if (face.length === 3) return [face[0], face[1], face[2]];
	const n = faceNormal(points, face);
	const ax = Math.abs(n[0]);
	const ay = Math.abs(n[1]);
	const az = Math.abs(n[2]);
	// drop the dominant axis, keeping a right-handed pair so the winding survives
	const flat: Vec2[] = face.map((i) => {
		const p = points[i];
		if (ax >= ay && ax >= az) return n[0] > 0 ? [p[1], p[2]] : [p[2], p[1]];
		if (ay >= az) return n[1] > 0 ? [p[2], p[0]] : [p[0], p[2]];
		return n[2] > 0 ? [p[0], p[1]] : [p[1], p[0]];
	});
	const tris = triangulate(flat);
	if (tris.length === 0) {
		const out: number[] = [];
		for (let i = 1; i + 1 < face.length; i++) out.push(face[0], face[i], face[i + 1]);
		return out;
	}
	return tris.map((i) => face[i]);
}

/** Bake tris into every mesh (parts and collision), the way an editor does on save. */
export function bakeTris3(doc: Doc3): void {
	const bake = (shapes?: Shape3[]) => {
		for (const sh of shapes ?? []) {
			if (sh.kind !== "mesh") continue;
			const tris: number[] = [];
			for (const f of sh.faces) tris.push(...triangulateFace(sh.points, f));
			sh.tris = tris;
		}
	};
	for (const part of doc.parts ?? []) bake(part.shapes);
	bake(doc.collision);
}
