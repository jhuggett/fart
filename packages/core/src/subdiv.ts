// Smooth surfaces (1.7): Catmull-Clark subdivision of a cage with
// semi-sharp creases, the OpenSubdiv rules so any renderer that has them
// conforms; and vertex normals for smooth shading that stop at sharp
// edges. The cage is the file; this is a refinement a reader may apply.

import type { MeshShape, Vec2, Vec3 } from "./types.ts";
import { v3add, v3cross, v3dot, v3norm, v3scale, v3sub } from "./space3.ts";

/** A crease in 0–1 as OpenSubdiv sharpness: 1 is infinitely sharp, below it c × 10. */
export function sharpnessOf(c: number): number {
	return c >= 1 ? Infinity : Math.max(0, c) * 10;
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

interface Edge {
	a: number;
	b: number;
	faces: number[];
	sharp: number;
}

export interface Cage {
	points: Vec3[];
	faces: number[][];
	/** [a, b, c] edges and [a, c] corners, c in 0–1 */
	creases?: number[][];
	/** 1.5 pattern coordinates, one list per face, one pair per corner; subdivided within their face */
	uvs?: Vec2[][];
	/** 1.8: a paint index per face; a face's children wear their parent's */
	paint?: number[];
	/** 1.8: a shade per point; refined as a fourth coordinate, by the weights that refine positions */
	shades?: number[];
}

/** Explicit pattern coordinates that fit the faces: one list per face, one pair per corner. */
function fitting(uvs: Vec2[][] | undefined, faces: number[][]): Vec2[][] | undefined {
	if (!uvs || uvs.length !== faces.length) return undefined;
	return uvs.every((f, i) => Array.isArray(f) && f.length === faces[i].length) ? uvs : undefined;
}

/** The edges of a mesh with their faces and sharpness, and each vertex's corner sharpness. */
function topology(cage: Cage): { edges: Map<string, Edge>; corner: Float64Array; around: number[][] } {
	const edges = new Map<string, Edge>();
	const n = cage.points.length;
	const corner = new Float64Array(n);
	const around: number[][] = Array.from({ length: n }, () => []);
	cage.faces.forEach((f, fi) => {
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			if (a >= n || b >= n || a === b) continue;
			const k = key(a, b);
			let e = edges.get(k);
			if (!e) {
				e = { a: Math.min(a, b), b: Math.max(a, b), faces: [], sharp: 0 };
				edges.set(k, e);
				around[e.a].push(e.b);
				around[e.b].push(e.a);
			}
			if (!e.faces.includes(fi)) e.faces.push(fi);
		}
	});
	for (const c of cage.creases ?? []) {
		if (c.length >= 3) {
			const e = edges.get(key(c[0], c[1]));
			if (e) e.sharp = Math.max(e.sharp, sharpnessOf(c[2]));
		} else if (c.length === 2 && c[0] < n) corner[c[0]] = Math.max(corner[c[0]], sharpnessOf(c[1]));
	}
	// a boundary edge is infinitely sharp: the surface interpolates the boundary (EDGE_AND_CORNER)
	for (const e of edges.values()) if (e.faces.length < 2) e.sharp = Infinity;
	return { edges, corner, around };
}

/** One level of Catmull-Clark with semi-sharp creases; child creases carry sharpness − 1. */
export function subdivideOnce(cage: Cage): Cage {
	const { parents, ...out } = refine(cage, cage.points);
	if (Array.isArray(cage.paint) && cage.paint.length === cage.faces.length) out.paint = parents.map((fi) => cage.paint![fi]);
	if (Array.isArray(cage.shades) && cage.shades.length === cage.points.length) {
		// the same masks on the shade alone: every rule that places a point weighs its shade alike
		const s = refine({ points: cage.points, faces: cage.faces, creases: cage.creases }, cage.shades.map((v): Vec3 => [v, 0, 0]));
		out.shades = s.points.map((p) => Math.max(0, p[0]));
	}
	return out;
}

/** The refinement itself over the cage's topology, with `P` standing in for its points; `parents` names each child's face. */
function refine(cage: Cage, P: Vec3[]): Cage & { parents: number[] } {
	const F = cage.faces;
	const { edges, corner, around } = topology(cage);
	const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
	// face points
	const facePt: Vec3[] = F.map((f) => {
		let acc: Vec3 = [0, 0, 0];
		for (const i of f) acc = v3add(acc, P[i]);
		return v3scale(acc, 1 / f.length);
	});
	// edge points: smooth (ends and the two face points averaged), sharp (the midpoint), or a blend between
	const edgePt = new Map<string, Vec3>();
	for (const [k, e] of edges) {
		const m = mid(P[e.a], P[e.b]);
		let pt = m;
		if (e.faces.length === 2) {
			let smooth: Vec3 = v3add(v3add(P[e.a], P[e.b]), v3add(facePt[e.faces[0]], facePt[e.faces[1]]));
			smooth = v3scale(smooth, 0.25);
			const s = e.sharp;
			pt = s >= 1 ? m : s <= 0 ? smooth : v3add(v3scale(smooth, 1 - s), v3scale(m, s));
		}
		edgePt.set(k, pt);
	}
	// vertex points
	const vertPt: Vec3[] = P.map((v, vi) => {
		const nb = around[vi];
		const n = nb.length;
		if (n === 0) return v;
		const inc = nb.map((o) => edges.get(key(vi, o))!);
		const sharpEdges = inc.filter((e) => e.sharp > 0).sort((p, q) => q.sharp - p.sharp);
		// the corner rule: three or more sharp edges, or a sharp corner, or a two-edge boundary corner
		const sharpCount = inc.filter((e) => e.sharp >= 1).length;
		if (sharpCount >= 3 || corner[vi] >= 1 || (n === 2 && sharpCount === 2)) return v;
		// the smooth rule
		const faces = new Set<number>();
		for (const e of inc) for (const f of e.faces) faces.add(f);
		let Q: Vec3 = [0, 0, 0];
		for (const f of faces) Q = v3add(Q, facePt[f]);
		Q = v3scale(Q, 1 / Math.max(1, faces.size));
		let R: Vec3 = [0, 0, 0];
		for (const o of nb) R = v3add(R, mid(v, P[o]));
		R = v3scale(R, 1 / n);
		const smooth: Vec3 = v3scale(v3add(v3add(Q, v3scale(R, 2)), v3scale(v, n - 3)), 1 / n);
		// the crease rule along the two sharpest edges, blended in by their sharpness
		let out = smooth;
		if (sharpEdges.length >= 2) {
			const [e1, e2] = sharpEdges;
			const o1 = e1.a === vi ? e1.b : e1.a;
			const o2 = e2.a === vi ? e2.b : e2.a;
			const crease: Vec3 = v3scale(v3add(v3add(P[o1], P[o2]), v3scale(v, 6)), 1 / 8);
			const s = Math.min(1, (Math.min(e1.sharp, 1) + Math.min(e2.sharp, 1)) / 2);
			out = s >= 1 ? crease : v3add(v3scale(smooth, 1 - s), v3scale(crease, s));
		}
		// a semi-sharp corner pins the vertex by its sharpness
		const cs = Math.min(1, corner[vi]);
		if (cs > 0) out = v3add(v3scale(out, 1 - cs), v3scale(v, cs));
		return out;
	});
	// assemble: original vertices keep their indices, then face points, then edge points
	const points: Vec3[] = [...vertPt, ...facePt];
	const edgeIndex = new Map<string, number>();
	for (const [k, pt] of edgePt) {
		edgeIndex.set(k, points.length);
		points.push(pt);
	}
	// Pattern coordinates stay within their face: a child's corners are the
	// parent's corner, the middles of its two edges there, and the face's middle.
	const faces: number[][] = [];
	const parents: number[] = [];
	const parentUV = fitting(cage.uvs, F);
	const uvs: Vec2[][] = [];
	const mid2 = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
	F.forEach((f, fi) => {
		const fp = P.length + fi;
		const m = f.length;
		const fuv = parentUV?.[fi];
		const centre: Vec2 | undefined = fuv && [fuv.reduce((s, uv) => s + uv[0], 0) / m, fuv.reduce((s, uv) => s + uv[1], 0) / m];
		for (let i = 0; i < m; i++) {
			const v = f[i];
			const eNext = edgeIndex.get(key(v, f[(i + 1) % m]));
			const ePrev = edgeIndex.get(key(f[(i + m - 1) % m], v));
			if (eNext === undefined || ePrev === undefined) continue;
			faces.push([v, eNext, fp, ePrev]);
			parents.push(fi);
			if (fuv && centre) uvs.push([fuv[i], mid2(fuv[i], fuv[(i + 1) % m]), centre, mid2(fuv[(i + m - 1) % m], fuv[i])].map((uv) => [r4(uv[0]), r4(uv[1])] as Vec2));
		}
	});
	// child creases: each half of a creased edge, one sharper step softer; corners likewise
	const creases: number[][] = [];
	for (const [k, e] of edges) {
		if (e.sharp <= 0 || e.faces.length < 2) continue; // boundaries are sharp by being boundaries
		const child = e.sharp === Infinity ? 1 : Math.max(0, e.sharp - 1) / 10;
		if (child <= 0) continue;
		const ei = edgeIndex.get(k)!;
		creases.push([e.a, ei, child], [e.b, ei, child]);
	}
	corner.forEach((c, vi) => {
		if (c <= 0) return;
		const child = c === Infinity ? 1 : Math.max(0, c - 1) / 10;
		if (child > 0) creases.push([vi, child]);
	});
	return { points: points.map((p) => [r4(p[0]), r4(p[1]), r4(p[2])]), faces, creases, parents, ...(parentUV ? { uvs } : {}) };
}

const r4 = (x: number) => Math.round(x * 10000) / 10000 + 0;

/** The cage subdivided `levels` times. Zero levels is the cage itself. */
export function subdivide(cage: Cage, levels: number): Cage {
	let out: Cage = cage;
	for (let i = 0; i < Math.max(0, Math.floor(levels)); i++) out = subdivideOnce(out);
	return out;
}

const surfaces = new Map<string, MeshShape>();

/**
 * A short hash of the cage, for `bake.of` and the cache: FNV-1a over the
 * JSON of [points, faces, creases, smooth], and for a shape with any of
 * `mods`, `paint` or `shades` (1.8) those three after them, so a bake is
 * dropped when what it was made from changes.
 */
export function cageHash(sh: { points: Vec3[]; faces: number[][]; creases?: number[][]; smooth?: number; mods?: unknown[]; paint?: number[]; shades?: number[] }): string {
	const of: unknown[] = [sh.points, sh.faces, sh.creases ?? null, sh.smooth ?? 0];
	if (sh.mods?.length || sh.paint || sh.shades) of.push(sh.mods?.length ? sh.mods : null, sh.paint ?? null, sh.shades ?? null);
	const s = JSON.stringify(of);
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** A cage's mapping on its subdivided surface: explicit pattern coordinates are the surface's own, one list per face of it. */
function mappingOn(sh: MeshShape, uvs: Vec2[][] | undefined): MeshShape["mapping"] {
	if (!sh.mapping || !sh.mapping.uvs) return sh.mapping;
	if (uvs) return { ...sh.mapping, uvs };
	// (coordinates that never fitted the cage's faces fit the surface's no better: box mapping takes over, as on the cage)
	const { uvs: _u, ...rest } = sh.mapping;
	void _u;
	return rest;
}

/**
 * What a mesh draws: itself when it is not smoothed; else its subdivided
 * surface (its bake when that matches the cage, else subdivided now and
 * remembered). Colour, shade and texture are the cage's; explicit
 * pattern coordinates are subdivided with the faces they belong to.
 */
export function surfaceOf(sh: MeshShape): MeshShape {
	const levels = sh.smooth ?? 0;
	if (!(levels > 0)) return sh;
	const h = cageHash(sh);
	const cageUV = fitting(sh.mapping?.uvs, sh.faces);
	const baked = bakedSurface(sh, h);
	if (baked) return baked;
	const k = cageUV ? `${h}:${uvHash(cageUV)}` : h;
	let out = surfaces.get(k);
	if (!out) {
		const sub = subdivide({ points: sh.points, faces: sh.faces, creases: sh.creases, uvs: cageUV, paint: sh.paint, shades: sh.shades }, levels);
		out = { ...strip(sh), points: sub.points, faces: sub.faces, mapping: mappingOn(sh, sub.uvs) };
		if (sub.paint) out.paint = sub.paint;
		if (sub.shades) out.shades = sub.shades;
		if (surfaces.size > 128) surfaces.clear();
		surfaces.set(k, out);
	}
	const drawn = { ...out, color: sh.color, shade: sh.shade, texture: sh.texture, mapping: mappingOn(sh, out.mapping?.uvs) } as MeshShape;
	if (sh.colors) drawn.colors = sh.colors;
	else delete drawn.colors;
	return drawn;
}

/**
 * The shape's bake as the mesh it draws, when the bake is this cage's:
 * `of` matches `h`, a cage with explicit pattern coordinates finds its
 * own in the bake, and a painted or shaded one (1.8) finds paint for the
 * bake's faces and shades for its points. Null otherwise.
 */
export function bakedSurface(sh: MeshShape, h: string): MeshShape | null {
	const b = sh.bake;
	if (!b || b.of !== h || !Array.isArray(b.points) || !Array.isArray(b.faces)) return null;
	const cageUV = fitting(sh.mapping?.uvs, sh.faces);
	const bakedUV = fitting(b.uvs as Vec2[][] | undefined, b.faces);
	// (a bake written before uvs were carried, or for other coordinates, has none to offer: subdivide now)
	if (cageUV && !(bakedUV && b.uvOf === uvHash(cageUV))) return null;
	const paint = Array.isArray(b.paint) && b.paint.length === b.faces.length ? b.paint : undefined;
	const shades = Array.isArray(b.shades) && b.shades.length === b.points.length ? b.shades : undefined;
	const painted = !!sh.paint || (sh.mods ?? []).some((m) => m && (m.inner !== undefined || m.rim !== undefined));
	if ((painted && !paint) || (sh.shades && !shades)) return null;
	const out: MeshShape = { ...strip(sh), points: b.points, faces: b.faces, tris: b.tris, mapping: mappingOn(sh, bakedUV) };
	if (paint) out.paint = paint;
	if (shades) out.shades = shades;
	return out;
}

/** A short hash of pattern coordinates, for `bake.uvOf`: a bake's uvs are its cage's, as its points are. */
export function uvHash(uvs: Vec2[][]): string {
	const s = JSON.stringify(uvs);
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

function strip(sh: MeshShape): MeshShape {
	const { bake: _b, tris: _t, creases: _c, smooth: _s, mods: _m, paint: _p, shades: _h, ...rest } = sh;
	void _b;
	void _t;
	void _c;
	void _s;
	void _m;
	void _p;
	void _h;
	return rest as MeshShape;
}

/** Write the subdivided surface of every smooth mesh and sweep into its bake (1.7), with the cage's hash in `of`. */
export function bakeSmooth(doc: { parts?: { shapes?: unknown[] }[] }): number {
	let n = 0;
	for (const part of doc.parts ?? []) {
		for (const sh of (part.shapes ?? []) as (MeshShape & { kind: string })[]) {
			if ((sh.kind !== "mesh" && sh.kind !== "sweep") || !(sh.smooth && sh.smooth > 0)) continue;
			const cage = sh.kind === "mesh" ? sh : null;
			if (!cage || cage.mods?.length) continue; // a sweep's cage and a mesh's mods need solids.ts: bakeSurfaces covers them
			const cageUV = fitting(cage.mapping?.uvs, cage.faces);
			const sub = subdivide({ points: cage.points, faces: cage.faces, creases: cage.creases, uvs: cageUV, paint: cage.paint, shades: cage.shades }, cage.smooth!);
			const tris: number[] = [];
			for (const f of sub.faces) for (let i = 1; i + 1 < f.length; i++) tris.push(f[0], f[i], f[i + 1]);
			cage.bake = { points: sub.points, faces: sub.faces, tris, of: cageHash(cage), ...(cageUV && sub.uvs ? { uvs: sub.uvs, uvOf: uvHash(cageUV) } : {}), ...(sub.paint ? { paint: sub.paint } : {}), ...(sub.shades ? { shades: sub.shades } : {}) };
			n++;
		}
	}
	return n;
}

/** Does this mesh want vertex normals: asked for, or smoothed and not told flat. */
export function smoothNormals(sh: { normals?: string; smooth?: number }): boolean {
	return sh.normals === "smooth" || (sh.normals !== "flat" && (sh.smooth ?? 0) > 0);
}

/**
 * A normal per face corner for smooth shading: the average of the faces
 * reachable around the corner's vertex without crossing a sharp edge (a
 * crease of 1, a boundary) or an edge whose faces meet at more than
 * `angle` degrees. Flat faces keep their own normal where that leaves one.
 */
export function cornerNormals(points: readonly Vec3[], faces: readonly number[][], opts: { angle?: number; creases?: number[][] } = {}): Vec3[][] {
	const fn: Vec3[] = faces.map((f) => {
		let n: Vec3 = [0, 0, 0];
		for (let i = 0; i < f.length; i++) {
			const a = points[f[i]];
			const b = points[f[(i + 1) % f.length]];
			if (!a || !b) continue;
			n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
		}
		return v3norm(n);
	});
	const hard = new Set<string>();
	for (const c of opts.creases ?? []) if (c.length >= 3 && c[2] >= 1) hard.add(key(c[0], c[1]));
	const cosLimit = opts.angle === undefined ? -1 : Math.cos((Math.max(0, Math.min(180, opts.angle)) * Math.PI) / 180);
	// faces around each vertex, and the edge each pair shares
	const facesAt: number[][] = Array.from({ length: points.length }, () => []);
	faces.forEach((f, fi) => f.forEach((v) => facesAt[v].push(fi)));
	const edgesOf = (fi: number, v: number): [number, number] => {
		const f = faces[fi];
		const i = f.indexOf(v);
		return [f[(i + 1) % f.length], f[(i + f.length - 1) % f.length]];
	};
	return faces.map((f, fi) =>
		f.map((v) => {
			// walk the fan: faces sharing an edge at v, not hard, within the angle
			const seen = new Set<number>([fi]);
			const stack = [fi];
			let acc: Vec3 = [0, 0, 0];
			while (stack.length) {
				const g = stack.pop()!;
				acc = v3add(acc, fn[g]);
				const [o1, o2] = edgesOf(g, v);
				for (const h of facesAt[v]) {
					if (seen.has(h)) continue;
					const [p1, p2] = edgesOf(h, v);
					const shared = [o1, o2].find((o) => o === p1 || o === p2);
					if (shared === undefined) continue;
					if (hard.has(key(v, shared))) continue;
					if (v3dot(fn[g], fn[h]) < cosLimit) continue;
					seen.add(h);
					stack.push(h);
				}
			}
			return v3norm(acc);
		}),
	);
}

/** The edge keys of a mesh (a:b with a < b), for tools. */
export function meshEdges(faces: readonly number[][]): [number, number][] {
	const out = new Map<string, [number, number]>();
	for (const f of faces) for (let i = 0; i < f.length; i++) {
		const a = f[i];
		const b = f[(i + 1) % f.length];
		if (a !== b) out.set(key(a, b), [Math.min(a, b), Math.max(a, b)]);
	}
	return [...out.values()];
}
void v3cross;
void v3sub;
