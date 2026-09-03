// Geometry the format implies: the defaults, posing, extents, picking
// distance, and the ear-clipping triangulation editors bake into tris.
// The algorithms match the reference Odin loader, so every implementation
// agrees on what a file looks like.

import type { Doc, Part, Shape, State, StatePart, Vec2 } from "./types.ts";

export function pivotOf(part: Part): Vec2 {
	return part.pivot ?? [0, 0];
}

export interface Pose {
	offset: Vec2;
	rotate: number;
	scale: number;
}

/** A state entry with the spec's defaults filled in. */
export function poseOf(sp: StatePart, part: Part): Pose {
	return {
		offset: sp.offset ?? pivotOf(part),
		rotate: sp.rotate ?? 0,
		scale: sp.scale === undefined || sp.scale === 0 ? 1 : sp.scale,
	};
}

/** Rest space to posed space: scale and turn about the pivot, land it on offset. */
export function posePoint(p: Vec2, part: Part, sp: StatePart): Vec2 {
	const { offset, rotate, scale } = poseOf(sp, part);
	const pv = pivotOf(part);
	const lx = (p[0] - pv[0]) * scale;
	const ly = (p[1] - pv[1]) * scale;
	const ca = Math.cos(rotate);
	const sa = Math.sin(rotate);
	return [offset[0] + lx * ca - ly * sa, offset[1] + lx * sa + ly * ca];
}

/** Posed space back to rest space. */
export function unposePoint(m: Vec2, part: Part, sp: StatePart): Vec2 {
	const { offset, rotate, scale } = poseOf(sp, part);
	const pv = pivotOf(part);
	const ca = Math.cos(-rotate);
	const sa = Math.sin(-rotate);
	const dx = m[0] - offset[0];
	const dy = m[1] - offset[1];
	return [pv[0] + (dx * ca - dy * sa) / scale, pv[1] + (dx * sa + dy * ca) / scale];
}

export function partOf(doc: Doc, name: string): Part | undefined {
	return doc.parts?.find((p) => p.name === name);
}

export function stateOf(doc: Doc, name: string): State | undefined {
	return doc.states?.find((s) => s.name === name);
}

/**
 * What to draw, in order, for a state (or all parts in file order when the
 * state is unknown or absent). Each entry pairs a part with its pose.
 */
export function drawList(doc: Doc, stateName?: string): { part: Part; sp: StatePart }[] {
	const parts = doc.parts ?? [];
	const state = stateName === undefined ? undefined : stateOf(doc, stateName);
	if (!state) return parts.map((part) => ({ part, sp: { part: part.name } }));
	const out: { part: Part; sp: StatePart }[] = [];
	for (const sp of state.parts) {
		const part = partOf(doc, sp.part);
		if (part) out.push({ part, sp });
	}
	return out;
}

export function dist(a: Vec2, b: Vec2): number {
	return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Distance from p to the segment ab. */
export function distSeg(p: Vec2, a: Vec2, b: Vec2): number {
	const abx = b[0] - a[0];
	const aby = b[1] - a[1];
	const l2 = abx * abx + aby * aby;
	const t = l2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2)) : 0;
	return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}

export function pointInPoly(p: Vec2, pts: readonly Vec2[]): boolean {
	let inside = false;
	const n = pts.length;
	for (let i = 0; i < n; i++) {
		const q = pts[i];
		const r = pts[(i + 1) % n];
		if (q[1] > p[1] !== r[1] > p[1]) {
			const x = q[0] + ((p[1] - q[1]) / (r[1] - q[1])) * (r[0] - q[0]);
			if (x > p[0]) inside = !inside;
		}
	}
	return inside;
}

/** How far a point is from a shape's painted area; 0 when on it. */
export function shapeDistance(sh: Shape, p: Vec2): number {
	switch (sh.kind) {
		case "circle": {
			const d = dist(sh.at, p);
			return d < sh.r ? 0 : d - sh.r;
		}
		case "line":
			return Math.max(distSeg(p, sh.a, sh.b) - sh.w * 0.5, 0);
		case "poly": {
			const n = sh.points.length;
			if (n === 0) return Infinity;
			if (pointInPoly(p, sh.points)) return 0;
			let d = Infinity;
			for (let i = 0; i < n; i++) d = Math.min(d, distSeg(p, sh.points[i], sh.points[(i + 1) % n]));
			return d;
		}
	}
}

export interface Bounds {
	lo: Vec2;
	hi: Vec2;
}

/** Extents of one shape's paint, strokes and caps included. */
export function shapeBounds(sh: Shape): Bounds | null {
	switch (sh.kind) {
		case "circle":
			return { lo: [sh.at[0] - sh.r, sh.at[1] - sh.r], hi: [sh.at[0] + sh.r, sh.at[1] + sh.r] };
		case "line": {
			const hw = sh.w * 0.5;
			return {
				lo: [Math.min(sh.a[0], sh.b[0]) - hw, Math.min(sh.a[1], sh.b[1]) - hw],
				hi: [Math.max(sh.a[0], sh.b[0]) + hw, Math.max(sh.a[1], sh.b[1]) + hw],
			};
		}
		case "poly": {
			if (sh.points.length === 0) return null;
			const lo: Vec2 = [Infinity, Infinity];
			const hi: Vec2 = [-Infinity, -Infinity];
			for (const q of sh.points) {
				lo[0] = Math.min(lo[0], q[0]);
				lo[1] = Math.min(lo[1], q[1]);
				hi[0] = Math.max(hi[0], q[0]);
				hi[1] = Math.max(hi[1], q[1]);
			}
			return { lo, hi };
		}
	}
}

/** Rest-space extents of everything a document paints; null when it paints nothing. */
export function docBounds(doc: Doc): Bounds | null {
	let acc: Bounds | null = null;
	for (const part of doc.parts ?? []) {
		for (const sh of part.shapes ?? []) {
			const b = shapeBounds(sh);
			if (!b) continue;
			if (!acc) acc = { lo: [...b.lo], hi: [...b.hi] };
			else {
				acc.lo[0] = Math.min(acc.lo[0], b.lo[0]);
				acc.lo[1] = Math.min(acc.lo[1], b.lo[1]);
				acc.hi[0] = Math.max(acc.hi[0], b.hi[0]);
				acc.hi[1] = Math.max(acc.hi[1], b.hi[1]);
			}
		}
	}
	return acc;
}

/**
 * Ear clipping, O(n^2). Handles either winding and concave outlines;
 * returns index triples. Degenerate input yields what it can (a caller
 * may fan the rest). Identical to the reference loader's.
 */
export function triangulate(pts: readonly Vec2[]): number[] {
	const out: number[] = [];
	const n = pts.length;
	if (n < 3) return out;
	let area = 0;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
	}
	const idx: number[] = [];
	if (area < 0) for (let i = n - 1; i >= 0; i--) idx.push(i);
	else for (let i = 0; i < n; i++) idx.push(i);
	const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
	const inside = (a: Vec2, b: Vec2, c: Vec2, p: Vec2) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
	let guard = 0;
	while (idx.length > 3 && guard < 10000) {
		guard++;
		let clipped = false;
		const m = idx.length;
		for (let i = 0; i < m; i++) {
			const i0 = idx[(i + m - 1) % m];
			const i1 = idx[i];
			const i2 = idx[(i + 1) % m];
			const a = pts[i0];
			const b = pts[i1];
			const c = pts[i2];
			if (cross(a, b, c) <= 0) continue; // reflex
			let ear = true;
			for (let k = 0; k < m; k++) {
				const kk = idx[k];
				if (kk === i0 || kk === i1 || kk === i2) continue;
				if (inside(a, b, c, pts[kk])) {
					ear = false;
					break;
				}
			}
			if (!ear) continue;
			out.push(i0, i1, i2);
			idx.splice(i, 1);
			clipped = true;
			break;
		}
		if (!clipped) break;
	}
	if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
	return out;
}

/** Bake tris into every poly (parts and collision), the way an editor does on save. */
export function bakeTris(doc: Doc): void {
	const bake = (shapes?: Shape[]) => {
		for (const sh of shapes ?? []) if (sh.kind === "poly") sh.tris = triangulate(sh.points);
	};
	for (const part of doc.parts ?? []) bake(part.shapes);
	bake(doc.collision);
}
