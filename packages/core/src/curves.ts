// Curves (1.7): a path is a cubic polybézier; a reader flattens it to a
// polyline within a tolerance (an error bound, never a segment count),
// and editors bake that polyline so a reader that cannot flatten draws
// the bake as a poly. Recursive de Casteljau against the distance of the
// control points from the chord, the classic test.

import type { Doc, PathBake, PathShape, Vec2, Vec3 } from "./types.ts";
import { triangulate } from "./geometry.ts";

/** The flattening tolerance editors bake at, document units: half a pixel at the studio's default zoom. */
export const FLATNESS = 0.05;

interface Curvy {
	points: Vec2[];
	in?: Vec2[];
	out?: Vec2[];
	closed?: boolean;
}

function near0(v: Vec2 | undefined): boolean {
	return !v || (Math.abs(v[0]) < 1e-9 && Math.abs(v[1]) < 1e-9);
}

/** Does the path bend anywhere, or is it a polygon in disguise? */
export function pathHasCurves(sh: Curvy): boolean {
	return (sh.in ?? []).some((v) => !near0(v)) || (sh.out ?? []).some((v) => !near0(v));
}

/** One cubic, flattened to `out` (its end point included, its start not), within tol. */
export function flattenCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tol: number, out: Vec2[], depth = 0): void {
	// distance of the two inner control points from the chord
	const dx = p3[0] - p0[0];
	const dy = p3[1] - p0[1];
	const len = Math.hypot(dx, dy);
	let d1: number;
	let d2: number;
	if (len < 1e-12) {
		d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
		d2 = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
	} else {
		d1 = Math.abs((p1[0] - p0[0]) * dy - (p1[1] - p0[1]) * dx) / len;
		d2 = Math.abs((p2[0] - p0[0]) * dy - (p2[1] - p0[1]) * dx) / len;
	}
	if (depth >= 16 || Math.max(d1, d2) <= tol) {
		out.push(p3);
		return;
	}
	// de Casteljau at the midpoint
	const m = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	const p01 = m(p0, p1);
	const p12 = m(p1, p2);
	const p23 = m(p2, p3);
	const p012 = m(p01, p12);
	const p123 = m(p12, p23);
	const mid = m(p012, p123);
	flattenCubic(p0, p01, p012, mid, tol, out, depth + 1);
	flattenCubic(mid, p123, p23, p3, tol, out, depth + 1);
}

/**
 * The path as a polyline within `tol` of the curve: for a closed path
 * every segment including last-to-first (the first point is not
 * repeated), for an open one from the first point to the last.
 */
export function pathPoints(sh: Curvy, tol = FLATNESS): Vec2[] {
	const pts = sh.points;
	const n = pts.length;
	if (n === 0) return [];
	if (!pathHasCurves(sh)) return pts.map((p) => [p[0], p[1]] as Vec2);
	const out: Vec2[] = [[pts[0][0], pts[0][1]]];
	const segs = sh.closed ? n : n - 1;
	for (let i = 0; i < segs; i++) {
		const j = (i + 1) % n;
		const a = pts[i];
		const b = pts[j];
		const o = sh.out?.[i] ?? [0, 0];
		const inn = sh.in?.[j] ?? [0, 0];
		const c1: Vec2 = [a[0] + o[0], a[1] + o[1]];
		const c2: Vec2 = [b[0] + inn[0], b[1] + inn[1]];
		if (near0(o) && near0(inn)) out.push([b[0], b[1]]);
		else flattenCubic(a, c1, c2, b, tol, out);
	}
	if (sh.closed) out.pop(); // back at the start
	return out.map((p) => [Math.round(p[0] * 1000) / 1000 + 0, Math.round(p[1] * 1000) / 1000 + 0]);
}

/** The bake a save writes: the flattened polygon, triangulated when closed. */
export function bakePath(sh: PathShape, tol = FLATNESS): PathBake {
	const points = pathPoints(sh, tol);
	const bake: PathBake = { points };
	if (sh.closed && points.length >= 3) bake.tris = triangulate(points);
	return bake;
}

const cache = new WeakMap<object, { key: string; bake: PathBake }>();

/** The path's polygon: its bake when it has one, else flattened now (and remembered for this object). */
export function pathBake(sh: PathShape, tol = FLATNESS): PathBake {
	if (sh.bake && Array.isArray(sh.bake.points) && sh.bake.points.length) return sh.bake;
	const key = JSON.stringify([sh.points, sh.in, sh.out, sh.closed, tol]);
	const hit = cache.get(sh);
	if (hit && hit.key === key) return hit.bake;
	const bake = bakePath(sh, tol);
	cache.set(sh, { key, bake });
	return bake;
}

/** Write a fresh bake into every path (parts and collision), the way an editor does on save. */
export function bakePaths(doc: Doc, tol = FLATNESS): void {
	const bake = (shapes?: unknown[]) => {
		for (const sh of (shapes ?? []) as PathShape[]) if (sh.kind === "path") sh.bake = bakePath(sh, tol);
	};
	for (const part of doc.parts ?? []) bake(part.shapes);
	bake(doc.collision);
}

/**
 * A path with three coordinates (1.8, a pipe's spine) as a polyline
 * within `tol` of the curve, and where each of its points sits along the
 * path: `at[i]` is the segment's index plus the cubic's own parameter
 * there, so a value kept per path point (a radius) can be read between.
 */
export function pathPoints3(sh: { points: Vec3[]; in?: Vec3[]; out?: Vec3[] }, closed = false, tol = FLATNESS): { points: Vec3[]; at: number[] } {
	const pts = sh.points;
	const n = pts.length;
	const points: Vec3[] = [];
	const at: number[] = [];
	if (n === 0) return { points, at };
	const zero = (v: Vec3 | undefined) => !v || (Math.abs(v[0]) < 1e-9 && Math.abs(v[1]) < 1e-9 && Math.abs(v[2]) < 1e-9);
	const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
	// how far a control point stands off the chord
	const off = (p: Vec3, a: Vec3, b: Vec3): number => {
		const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
		const v: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
		const len = Math.hypot(d[0], d[1], d[2]);
		if (len < 1e-12) return Math.hypot(v[0], v[1], v[2]);
		return Math.hypot(v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]) / len;
	};
	const cubic = (p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t0: number, t1: number, depth: number): void => {
		if (depth >= 16 || Math.max(off(p1, p0, p3), off(p2, p0, p3)) <= tol) {
			points.push(p3);
			at.push(t1);
			return;
		}
		const p01 = mid(p0, p1);
		const p12 = mid(p1, p2);
		const p23 = mid(p2, p3);
		const p012 = mid(p01, p12);
		const p123 = mid(p12, p23);
		const m = mid(p012, p123);
		const tm = (t0 + t1) / 2;
		cubic(p0, p01, p012, m, t0, tm, depth + 1);
		cubic(m, p123, p23, p3, tm, t1, depth + 1);
	};
	points.push(pts[0]);
	at.push(0);
	const segs = closed ? n : n - 1;
	for (let i = 0; i < segs; i++) {
		const j = (i + 1) % n;
		const a = pts[i];
		const b = pts[j];
		const o = sh.out?.[i];
		const inn = sh.in?.[j];
		if (zero(o) && zero(inn)) {
			points.push(b);
			at.push(i + 1);
		} else cubic(a, [a[0] + (o?.[0] ?? 0), a[1] + (o?.[1] ?? 0), a[2] + (o?.[2] ?? 0)], [b[0] + (inn?.[0] ?? 0), b[1] + (inn?.[1] ?? 0), b[2] + (inn?.[2] ?? 0)], b, i, i + 1, 0);
	}
	if (closed) {
		points.pop(); // back at the start
		at.pop();
	}
	return { points: points.map((p) => [p[0], p[1], p[2]]), at };
}
