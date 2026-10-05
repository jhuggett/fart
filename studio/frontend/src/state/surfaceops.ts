// What format 1.8 lays on a mesh, as pure arithmetic: which face wears
// which colour (`colors` and `paint`, kept minimal), how dark each corner
// sits in the folds of the model (`shades`), the handles that round a
// pipe's path, and the pointer's ray into a soup of triangles. Nothing
// here knows the studio; the model store lays the results into the
// document, and the Ask panel's tools call the same functions.
//
// No imports: this file runs under node --test as it is.

export type V3 = [number, number, number];

/** What a painted shape keeps: its own colour, the further ones, the index each face wears, and the modifiers that name indices too. */
export interface Painted {
	color?: string;
	colors?: string[];
	paint?: number[];
	mods?: { op?: string; inner?: number; rim?: number; [k: string]: unknown }[];
}

/**
 * Keep `colors` and `paint` minimal, in place: a face painted with the
 * shape's own colour is 0, a token no face (and no modifier) wears is
 * dropped and the indices close up, `paint` goes when every face is 0
 * and `colors` when nothing is left in it. `faces` is how many faces the
 * shape has (a sweep's: of the mesh it generates).
 */
export function tidyPaint(sh: Painted, faces: number): void {
	const colors = Array.isArray(sh.colors) ? sh.colors : [];
	let paint = Array.isArray(sh.paint) && sh.paint.length === faces ? sh.paint.map((p) => (Number.isInteger(p) && p > 0 && p <= colors.length ? p : 0)) : new Array<number>(faces).fill(0);
	// the token each index stands for, the shape's own colour being 0
	const token = (p: number) => (p > 0 ? colors[p - 1] : undefined);
	const used = new Set<string>();
	for (const p of paint) {
		const t = token(p);
		if (t !== undefined && t !== sh.color) used.add(t);
	}
	// a modifier's inner and rim are indices into the same list: what they name stays, whatever the faces wear
	for (const m of sh.mods ?? []) {
		for (const key of ["inner", "rim"] as const) {
			const t = typeof m[key] === "number" ? token(m[key]!) : undefined;
			if (t !== undefined) used.add(t);
		}
	}
	const next = colors.filter((t, i) => used.has(t) && colors.indexOf(t) === i);
	const index = (p: number): number => {
		const t = token(p);
		return t === undefined ? 0 : next.indexOf(t) + 1;
	};
	paint = paint.map((p) => (token(p) === sh.color ? 0 : index(p)));
	for (const m of sh.mods ?? []) {
		for (const key of ["inner", "rim"] as const) if (typeof m[key] === "number") m[key] = index(m[key]!);
	}
	if (next.length) sh.colors = next;
	else delete sh.colors;
	if (next.length && paint.some((p) => p !== 0)) sh.paint = paint;
	else delete sh.paint;
}

/** Paint faces with a palette token, in place, and tidy. Returns how many faces changed colour. */
export function paintFaces(sh: Painted, faces: number, list: readonly number[], token: string): number {
	const colors = Array.isArray(sh.colors) ? [...sh.colors] : [];
	const paint = Array.isArray(sh.paint) && sh.paint.length === faces ? [...sh.paint] : new Array<number>(faces).fill(0);
	let index = 0;
	if (token !== sh.color) {
		index = colors.indexOf(token) + 1;
		if (!index) {
			colors.push(token);
			index = colors.length;
		}
	}
	let changed = 0;
	for (const f of list) {
		if (!Number.isInteger(f) || f < 0 || f >= faces) continue;
		if (paint[f] !== index) changed++;
		paint[f] = index;
	}
	sh.colors = colors;
	sh.paint = paint;
	tidyPaint(sh, faces);
	return changed;
}

/** The token a face wears. */
export function tokenOfFace(sh: Painted, face: number): string | undefined {
	const p = sh.paint?.[face] ?? 0;
	return p > 0 ? (sh.colors?.[p - 1] ?? sh.color) : sh.color;
}

/** The paint index of a token on this shape, adding it to `colors` when it is new (0 for the shape's own colour). */
export function paintIndex(sh: Painted, token: string): number {
	if (token === sh.color) return 0;
	const colors = (sh.colors ??= []);
	let i = colors.indexOf(token);
	if (i < 0) {
		colors.push(token);
		i = colors.length - 1;
	}
	return i + 1;
}

// ------------------------------------------------------------- rays

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
	const l = Math.hypot(a[0], a[1], a[2]);
	return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

/** Triangles as nine numbers each, and a tree of boxes over them. */
export interface Soup {
	tris: Float64Array;
	/** per node: lo x y z, hi x y z */
	box: Float64Array;
	/** per node: left child (or -1 - first triangle for a leaf), right child (or the leaf's count) */
	kids: Int32Array;
	order: Int32Array;
}

/** A tree of boxes over a triangle soup (nine numbers a triangle), split at the middle of the longest side. */
export function soupOf(tris: Float64Array): Soup {
	const n = Math.floor(tris.length / 9);
	const order = new Int32Array(n);
	const mid = new Float64Array(n * 3);
	for (let i = 0; i < n; i++) {
		order[i] = i;
		for (let k = 0; k < 3; k++) mid[i * 3 + k] = (tris[i * 9 + k] + tris[i * 9 + 3 + k] + tris[i * 9 + 6 + k]) / 3;
	}
	const box: number[] = [];
	const kids: number[] = [];
	const build = (lo: number, hi: number): number => {
		const node = kids.length / 2;
		kids.push(0, 0);
		const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
		for (let i = lo; i < hi; i++) {
			const t = order[i] * 9;
			for (let v = 0; v < 9; v++) {
				const k = v % 3;
				const x = tris[t + v];
				if (x < b[k]) b[k] = x;
				if (x > b[k + 3]) b[k + 3] = x;
			}
		}
		box.push(...b);
		if (hi - lo <= 6) {
			kids[node * 2] = -1 - lo;
			kids[node * 2 + 1] = hi - lo;
			return node;
		}
		// the longest side of the middles' box, cut at its middle (or in half, when they pile up)
		let axis = 0;
		let span = -1;
		let cut = 0;
		for (let k = 0; k < 3; k++) {
			let a = Infinity;
			let z = -Infinity;
			for (let i = lo; i < hi; i++) {
				const m = mid[order[i] * 3 + k];
				if (m < a) a = m;
				if (m > z) z = m;
			}
			if (z - a > span) {
				span = z - a;
				axis = k;
				cut = (a + z) / 2;
			}
		}
		let i = lo;
		let j = hi - 1;
		while (i <= j) {
			if (mid[order[i] * 3 + axis] < cut) i++;
			else {
				const t = order[i];
				order[i] = order[j];
				order[j] = t;
				j--;
			}
		}
		if (i === lo || i === hi) i = (lo + hi) >> 1;
		const left = build(lo, i);
		const right = build(i, hi);
		kids[node * 2] = left;
		kids[node * 2 + 1] = right;
		return node;
	};
	if (n) build(0, n);
	return { tris, box: new Float64Array(box), kids: new Int32Array(kids), order };
}

/**
 * The nearest triangle a ray meets, within `far`: how far along, and
 * which triangle. `front` takes only triangles that face the ray's
 * origin (wound so their normal opposes it). Null when it meets none.
 */
export function castRay(s: Soup, o: V3, d: V3, far = Infinity, front = false): { t: number; tri: number } | null {
	if (!s.kids.length) return null;
	const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
	let best = far;
	let hit = -1;
	const stack: number[] = [0];
	const T = s.tris;
	while (stack.length) {
		const node = stack.pop()!;
		// the slab test, against what is already the nearest
		let t0 = 0;
		let t1 = best;
		const b = node * 6;
		for (let k = 0; k < 3; k++) {
			let a = (s.box[b + k] - o[k]) * inv[k];
			let z = (s.box[b + k + 3] - o[k]) * inv[k];
			if (a > z) [a, z] = [z, a];
			// (a ray along a side of the box: 0 × ∞ is no number, and no reason to miss)
			if (a > t0) t0 = a;
			if (z < t1) t1 = z;
		}
		if (t0 > t1) continue;
		const l = s.kids[node * 2];
		if (l >= 0) {
			stack.push(l, s.kids[node * 2 + 1]);
			continue;
		}
		const first = -1 - l;
		const count = s.kids[node * 2 + 1];
		for (let i = first; i < first + count; i++) {
			const tri = s.order[i];
			const k = tri * 9;
			// Möller and Trumbore
			const e1x = T[k + 3] - T[k];
			const e1y = T[k + 4] - T[k + 1];
			const e1z = T[k + 5] - T[k + 2];
			const e2x = T[k + 6] - T[k];
			const e2y = T[k + 7] - T[k + 1];
			const e2z = T[k + 8] - T[k + 2];
			const px = d[1] * e2z - d[2] * e2y;
			const py = d[2] * e2x - d[0] * e2z;
			const pz = d[0] * e2y - d[1] * e2x;
			const det = e1x * px + e1y * py + e1z * pz;
			if (front ? det < 1e-12 : Math.abs(det) < 1e-12) continue;
			const f = 1 / det;
			const sx = o[0] - T[k];
			const sy = o[1] - T[k + 1];
			const sz = o[2] - T[k + 2];
			const u = (sx * px + sy * py + sz * pz) * f;
			if (u < -1e-9 || u > 1 + 1e-9) continue;
			const qx = sy * e1z - sz * e1y;
			const qy = sz * e1x - sx * e1z;
			const qz = sx * e1y - sy * e1x;
			const v = (d[0] * qx + d[1] * qy + d[2] * qz) * f;
			if (v < -1e-9 || u + v > 1 + 1e-9) continue;
			const t = (e2x * qx + e2y * qy + e2z * qz) * f;
			if (t > 1e-9 && t < best) {
				best = t;
				hit = tri;
			}
		}
	}
	return hit < 0 ? null : { t: best, tri: hit };
}

/** A triangle's unit normal, by its winding. */
export function triNormal(s: Soup, tri: number): V3 {
	const k = tri * 9;
	const T = s.tris;
	return unit(cross([T[k + 3] - T[k], T[k + 4] - T[k + 1], T[k + 5] - T[k + 2]], [T[k + 6] - T[k], T[k + 7] - T[k + 1], T[k + 8] - T[k + 2]]));
}

/** Faces as a triangle soup: a fan from each face's first corner. */
export function soupTris(points: readonly V3[], faces: readonly (readonly number[])[], into: number[] = []): number[] {
	for (const f of faces) {
		for (let i = 1; i + 1 < f.length; i++) {
			const a = points[f[0]];
			const b = points[f[i]];
			const c = points[f[i + 1]];
			if (a && b && c) into.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
		}
	}
	return into;
}

/**
 * The point of a triangle soup (nine numbers a triangle) nearest a
 * point: where, the unit normal of the triangle it is on, and how far.
 * Every triangle is measured: for a handful of points, not for a brush.
 */
export function nearestOnTris(tris: ArrayLike<number>, p: V3): { at: V3; n: V3; d: number } | null {
	let best: { at: V3; n: V3; d: number } | null = null;
	for (let k = 0; k + 8 < tris.length; k += 9) {
		const a: V3 = [tris[k], tris[k + 1], tris[k + 2]];
		const b: V3 = [tris[k + 3], tris[k + 4], tris[k + 5]];
		const c: V3 = [tris[k + 6], tris[k + 7], tris[k + 8]];
		const q = nearestOnTri(p, a, b, c);
		const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
		if (!best || d < best.d) best = { at: q, n: unit(cross(sub(b, a), sub(c, a))), d };
	}
	return best;
}
/** The point of a triangle nearest a point (Ericson's regions). */
function nearestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
	const d3 = (x: V3, y: V3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
	const ab = sub(b, a);
	const ac = sub(c, a);
	const ap = sub(p, a);
	const d1 = d3(ab, ap);
	const d2 = d3(ac, ap);
	if (d1 <= 0 && d2 <= 0) return a;
	const bp = sub(p, b);
	const d3_ = d3(ab, bp);
	const d4 = d3(ac, bp);
	if (d3_ >= 0 && d4 <= d3_) return b;
	const vc = d1 * d4 - d3_ * d2;
	if (vc <= 0 && d1 >= 0 && d3_ <= 0) {
		const v = d1 / (d1 - d3_);
		return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
	}
	const cp = sub(p, c);
	const d5 = d3(ab, cp);
	const d6 = d3(ac, cp);
	if (d6 >= 0 && d5 <= d6) return c;
	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
	}
	const va = d3_ * d6 - d5 * d4;
	if (va <= 0 && d4 - d3_ >= 0 && d5 - d6 >= 0) {
		const w = (d4 - d3_) / (d4 - d3_ + (d5 - d6));
		return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
	}
	const den = 1 / (va + vb + vc);
	const v = vb * den;
	const w = vc * den;
	return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

// ------------------------------------------------------------- shades

/** A fixed set of directions over the upper hemisphere (z up), cosine weighted: the same every run, so a shade is repeatable. */
function hemisphere(n: number): V3[] {
	const out: V3[] = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < n; i++) {
		const r = Math.sqrt((i + 0.5) / n);
		const a = i * golden;
		out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(Math.max(0, 1 - r * r))]);
	}
	return out;
}

export interface ShadeOptions {
	/** 0…1: how dark a wholly hidden corner gets (its shade is 1 − strength) */
	strength?: number;
	/** how far a ray looks for something in its way, in the model's units */
	reach: number;
	/** rays per corner, 48 by default */
	rays?: number;
}

/**
 * A shade per corner, from how much of the sky each can see: from every
 * corner (lifted a hair off the surface along its normal) rays go out
 * over the hemisphere about the normal, cosine weighted, and each one
 * that meets the model within `reach` counts as shadow, nearer hits
 * counting more. The shade is 1 less `strength` times the shadowed
 * share, to two places. `normals` are unit, one per corner; a corner
 * with none (it belongs to no face) keeps 1.
 */
export function cornerShades(points: readonly V3[], normals: readonly V3[], soup: Soup, opts: ShadeOptions): number[] {
	const strength = Math.max(0, Math.min(1, opts.strength ?? 0.6));
	const reach = Math.max(1e-6, opts.reach);
	const dirs = hemisphere(Math.max(8, Math.round(opts.rays ?? 48)));
	const lift = reach * 0.004;
	return points.map((p, i) => {
		const n = normals[i];
		if (!n || (n[0] === 0 && n[1] === 0 && n[2] === 0)) return 1;
		// a frame about the normal
		const seed: V3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
		const u = unit(cross(n, seed));
		const v = cross(n, u);
		const o: V3 = [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift];
		let dark = 0;
		for (const h of dirs) {
			const d: V3 = [u[0] * h[0] + v[0] * h[1] + n[0] * h[2], u[1] * h[0] + v[1] * h[1] + n[1] * h[2], u[2] * h[0] + v[2] * h[1] + n[2] * h[2]];
			const hit = castRay(soup, o, d, reach);
			if (hit) dark += 1 - hit.t / reach;
		}
		const shade = 1 - strength * (dark / dirs.length);
		return Math.round(Math.max(0, Math.min(1, shade)) * 100) / 100;
	});
}

/** A unit normal per point: the unit normals of the faces that use it, summed and made unit (zero for a point no face uses). */
export function pointNormals(points: readonly V3[], faces: readonly (readonly number[])[]): V3[] {
	const acc: V3[] = points.map(() => [0, 0, 0]);
	for (const f of faces) {
		const n: V3 = [0, 0, 0];
		for (let i = 0; i < f.length; i++) {
			const a = points[f[i]];
			const b = points[f[(i + 1) % f.length]];
			if (!a || !b) continue;
			n[0] += (a[1] - b[1]) * (a[2] + b[2]);
			n[1] += (a[2] - b[2]) * (a[0] + b[0]);
			n[2] += (a[0] - b[0]) * (a[1] + b[1]);
		}
		const un = unit(n);
		for (const i of f) if (acc[i]) acc[i] = [acc[i][0] + un[0], acc[i][1] + un[1], acc[i][2] + un[2]];
	}
	return acc.map(unit);
}

// ------------------------------------------------------------- pipes

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;

/**
 * The handles that round a path through its points: at each point the
 * tangent runs from the point before to the point after, a sixth of
 * that either way (Catmull and Rom's curve as a cubic). An open path's
 * ends have none. Relative to their points, as the format keeps them.
 */
export function roundHandles(points: readonly V3[], closed = false): { in: V3[]; out: V3[] } {
	const n = points.length;
	const ins: V3[] = [];
	const outs: V3[] = [];
	for (let i = 0; i < n; i++) {
		const prev = points[i - 1] ?? (closed ? points[n - 1] : undefined);
		const next = points[i + 1] ?? (closed ? points[0] : undefined);
		if (!prev || !next || n < 3) {
			ins.push([0, 0, 0]);
			outs.push([0, 0, 0]);
			continue;
		}
		const t = sub(next, prev);
		outs.push([r3(t[0] / 6), r3(t[1] / 6), r3(t[2] / 6)]);
		ins.push([r3(-t[0] / 6), r3(-t[1] / 6), r3(-t[2] / 6)]);
	}
	return { in: ins, out: outs };
}
