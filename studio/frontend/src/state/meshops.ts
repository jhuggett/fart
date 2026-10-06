// Mesh editing, as pure geometry: each operation takes a cage (the
// points and faces of a `mesh` shape, with its creases and explicit
// pattern coordinates) and returns a new one. Nothing here knows the
// studio; the model store lays the result into the document as one undo
// step, and the Ask panel's tools call the same functions.
//
// Conventions are the format's: a face is a loop of point indices wound
// so that (p1 - p0) x (p2 - p0) points outward; `creases` holds [a, b, c]
// for an edge and [a, c] for a corner; `uvs` is one list per face, one
// pair per corner. Every operation keeps the three in step, and says
// where each point of the result came from (`src`), so a morph's points
// can be carried through it.
//
// No imports: this file runs under node --test as it is, and can move to
// core unchanged.

export type V3 = [number, number, number];
export type V2 = [number, number];

export interface Cage {
	points: V3[];
	faces: number[][];
	creases?: number[][];
	uvs?: V2[][];
}

/** Where a point of the result came from: between old points a and b, t of the way (a copy is [a, a, 0]). */
export type Src = [number, number, number];

export interface OpResult {
	cage: Cage;
	src: Src[];
	/** for each face of the result, the old face it is or was made from (a half of a cut, a wall of an extrude); -1 for one made of nothing */
	faceFrom: number[];
	/** what the operation leaves chosen */
	faces?: number[];
	edges?: [number, number][];
	verts?: number[];
	/** a line for the person: what happened */
	note: string;
}

/** An operation that cannot be done, with the reason in plain words. */
export class MeshError extends Error {}

// ------------------------------------------------------------- vectors

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => {
	const l = len(a);
	return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const round = (p: V3): V3 => [r4(p[0]), r4(p[1]), r4(p[2])];

/** A face's normal by Newell's method: outward for a face wound the format's way. Not unit length (its length is twice the area). */
export function faceNormal(points: readonly V3[], f: readonly number[]): V3 {
	const n: V3 = [0, 0, 0];
	for (let i = 0; i < f.length; i++) {
		const a = points[f[i]];
		const b = points[f[(i + 1) % f.length]];
		n[0] += (a[1] - b[1]) * (a[2] + b[2]);
		n[1] += (a[2] - b[2]) * (a[0] + b[0]);
		n[2] += (a[0] - b[0]) * (a[1] + b[1]);
	}
	return n;
}

/** The volume a mesh encloses, positive when its faces wind outward. */
export function signedVolume(points: readonly V3[], faces: readonly number[][], about: V3 = [0, 0, 0]): number {
	let v = 0;
	for (const f of faces) {
		const p0 = sub(points[f[0]], about);
		for (let i = 1; i + 1 < f.length; i++) v += dot(p0, cross(sub(points[f[i]], about), sub(points[f[i + 1]], about)));
	}
	return v / 6;
}

// ------------------------------------------------------------- topology

const ekey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const dkey = (a: number, b: number) => `${a}>${b}`;

interface Topo {
	/** undirected edge to the faces on it */
	und: Map<string, { a: number; b: number; faces: number[] }>;
	/** directed edge (as a face runs it) to the faces that run it that way */
	dir: Map<string, number[]>;
}
function topo(faces: readonly number[][]): Topo {
	const und: Topo["und"] = new Map();
	const dir: Topo["dir"] = new Map();
	faces.forEach((f, fi) => {
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			const k = ekey(a, b);
			const u = und.get(k);
			if (u) u.faces.push(fi);
			else und.set(k, { a: Math.min(a, b), b: Math.max(a, b), faces: [fi] });
			const d = dkey(a, b);
			const l = dir.get(d);
			if (l) l.push(fi);
			else dir.set(d, [fi]);
		}
	});
	return { und, dir };
}

export interface MeshReport {
	points: number;
	faces: number;
	edges: number;
	/** edges with one face: the rims of an open mesh */
	open: number;
	/** edges with more than two faces */
	crowded: number;
	/** edges two faces run the same way: their windings disagree */
	disagree: number;
	/** every edge has one or two faces, and neighbours wind alike */
	manifold: boolean;
	/** manifold with no open edge */
	closed: boolean;
	volume: number;
	rims: number[][];
}

/** What a cage is: its counts, whether it is manifold and closed, the volume it winds around, its rims. */
export function inspect(c: Cage): MeshReport {
	const t = topo(c.faces);
	let open = 0;
	let crowded = 0;
	let disagree = 0;
	for (const e of t.und.values()) {
		if (e.faces.length === 1) open++;
		else if (e.faces.length > 2) crowded++;
	}
	for (const l of t.dir.values()) if (l.length > 1) disagree++;
	const manifold = crowded === 0 && disagree === 0;
	return { points: c.points.length, faces: c.faces.length, edges: t.und.size, open, crowded, disagree, manifold, closed: manifold && open === 0, volume: signedVolume(c.points, c.faces), rims: rims(c) };
}

/** Is a–b an edge of some face? */
export function hasEdge(c: Cage, a: number, b: number): boolean {
	return c.faces.some((f) => f.some((v, i) => (v === a && f[(i + 1) % f.length] === b) || (v === b && f[(i + 1) % f.length] === a)));
}

/** The open edges, each as its one face runs it. */
function openEdges(faces: readonly number[][]): [number, number][] {
	const t = topo(faces);
	const out: [number, number][] = [];
	faces.forEach((f) => {
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			if (t.und.get(ekey(a, b))!.faces.length === 1) out.push([a, b]);
		}
	});
	return out;
}

/** Every rim: a loop of open edges, as corner indices in the order its faces run. */
export function rims(c: Cage): number[][] {
	const next = new Map<number, number[]>();
	for (const [a, b] of openEdges(c.faces)) next.set(a, [...(next.get(a) ?? []), b]);
	const out: number[][] = [];
	const used = new Set<string>();
	for (const [start, outs] of next) {
		for (const first of outs) {
			if (used.has(dkey(start, first))) continue;
			const loop = [start];
			let a = start;
			let b = first;
			let guard = 0;
			while (guard++ < 100000) {
				used.add(dkey(a, b));
				if (b === start) break;
				loop.push(b);
				const cand = (next.get(b) ?? []).find((x) => !used.has(dkey(b, x)));
				if (cand === undefined) break;
				a = b;
				b = cand;
			}
			if (b === start && loop.length >= 3) out.push(loop);
		}
	}
	return out;
}

/** The rim an open edge (or a corner on one) belongs to. */
export function rimThrough(c: Cage, a: number, b?: number): number[] | null {
	for (const loop of rims(c)) {
		const i = loop.indexOf(a);
		if (i < 0) continue;
		if (b === undefined) return loop;
		const n = loop.length;
		if (loop[(i + 1) % n] === b || loop[(i + n - 1) % n] === b) return loop;
	}
	return null;
}

function checkFaces(c: Cage, faces: readonly number[], what = "face"): number[] {
	const out = [...new Set(faces)];
	if (!out.length) throw new MeshError(`Choose a ${what} first.`);
	for (const f of out) if (!Number.isInteger(f) || f < 0 || f >= c.faces.length) throw new MeshError(`There is no face ${f}: the mesh has ${c.faces.length}.`);
	return out;
}
function checkPoint(c: Cage, i: number) {
	if (!Number.isInteger(i) || i < 0 || i >= c.points.length) throw new MeshError(`There is no corner ${i}: the mesh has ${c.points.length}.`);
}

// ------------------------------------------------------------- putting a result together

interface Draft {
	points: V3[];
	src: Src[];
	faces: number[][];
	/** the old face each new face is, or was cut from; -1 for one made new */
	from: number[];
	/** old points that now live in another (merged corners), by old index */
	alias?: Map<number, number>;
}
const draftOf = (c: Cage): Draft => ({ points: c.points.map((p) => [...p] as V3), src: c.points.map((_, i) => [i, i, 0] as Src), faces: c.faces.map((f) => [...f]), from: c.faces.map((_, i) => i) });

/**
 * Close a draft into a cage: points no face uses are dropped, the
 * creases follow their edges (onto copies, and onto both halves of an
 * edge that was cut), and explicit pattern coordinates are kept where a
 * face kept its corners and interpolated where it did not.
 */
function finish(old: Cage, d: Draft, sel: { faces?: number[]; edges?: [number, number][]; verts?: number[] }, note: string): OpResult {
	const used = new Array<boolean>(d.points.length).fill(false);
	for (const f of d.faces) for (const i of f) used[i] = true;
	const remap = new Array<number>(d.points.length).fill(-1);
	const points: V3[] = [];
	const src: Src[] = [];
	d.points.forEach((p, i) => {
		if (!used[i]) return;
		remap[i] = points.length;
		const s = d.src[i];
		const same = s[2] === 0 && s[0] === s[1] && old.points[s[0]] && p.every((x, k) => x === old.points[s[0]][k]);
		points.push(same ? ([...p] as V3) : round(p));
		src.push(s);
	});
	const faces = d.faces.map((f) => f.map((i) => remap[i]));
	const cage: Cage = { points, faces };

	// creases: an edge's crease lands on every surviving edge between copies of its ends, and on the halves of a cut
	if (old.creases?.length) {
		const copies = new Map<number, number[]>();
		const cuts = new Map<string, number[]>();
		src.forEach((s, k) => {
			if (s[0] === s[1] || s[2] === 0) copies.set(s[0], [...(copies.get(s[0]) ?? []), k]);
			else if (s[2] === 1) copies.set(s[1], [...(copies.get(s[1]) ?? []), k]);
			else cuts.set(ekey(s[0], s[1]), [...(cuts.get(ekey(s[0], s[1])) ?? []), k]);
		});
		for (const [was, now] of d.alias ?? []) if (remap[now] >= 0) copies.set(was, [...(copies.get(was) ?? []), remap[now]]);
		const t = topo(faces);
		const out = new Map<string, number[]>();
		for (const cr of old.creases) {
			if (cr.length === 2) {
				for (const k of copies.get(cr[0]) ?? []) out.set(`v${k}`, [k, cr[1]]);
				continue;
			}
			if (cr.length !== 3) continue;
			const as = copies.get(cr[0]) ?? [];
			const bs = copies.get(cr[1]) ?? [];
			for (const a of as) for (const b of bs) if (a !== b && t.und.has(ekey(a, b))) out.set(ekey(a, b), [Math.min(a, b), Math.max(a, b), cr[2]]);
			for (const m of cuts.get(ekey(cr[0], cr[1])) ?? []) {
				for (const e of [...as, ...bs]) if (t.und.has(ekey(e, m))) out.set(ekey(e, m), [Math.min(e, m), Math.max(e, m), cr[2]]);
			}
		}
		if (out.size) cage.creases = [...out.values()];
	}

	// pattern coordinates: a corner keeps the pair it had in the face it came from; a new corner is interpolated
	if (old.uvs && old.uvs.length === old.faces.length) {
		const any = new Map<number, V2>();
		old.faces.forEach((f, fi) => f.forEach((v, k) => {
			const uv = old.uvs![fi]?.[k];
			if (uv && !any.has(v)) any.set(v, uv);
		}));
		const mix = (a: V2 | undefined, b: V2 | undefined, t: number): V2 => {
			const p = a ?? b ?? [0, 0];
			const q = b ?? a ?? [0, 0];
			return [r4(p[0] + (q[0] - p[0]) * t), r4(p[1] + (q[1] - p[1]) * t)];
		};
		cage.uvs = faces.map((f, fi) => {
			const of = d.from[fi];
			const oldFace = of >= 0 ? old.faces[of] : undefined;
			const inFace = (v: number): V2 | undefined => {
				const k = oldFace ? oldFace.indexOf(v) : -1;
				return k >= 0 ? old.uvs![of]?.[k] : undefined;
			};
			return f.map((k) => {
				const s = src[k];
				return mix(inFace(s[0]) ?? any.get(s[0]), inFace(s[1]) ?? any.get(s[1]), s[0] === s[1] ? 0 : s[2]);
			});
		});
	}
	return {
		cage,
		src,
		faceFrom: d.from,
		faces: sel.faces,
		edges: sel.edges?.map(([a, b]) => [remap[a], remap[b]] as [number, number]).filter(([a, b]) => a >= 0 && b >= 0),
		verts: sel.verts?.map((v) => remap[v]).filter((v) => v >= 0),
		note,
	};
}

/**
 * Carry another list of the same points (a morph's) through an
 * operation: each new point sits where the operation put it, measured
 * from where it came from.
 */
export function carryPoints(oldBase: readonly V3[], newBase: readonly V3[], src: readonly Src[], other: readonly V3[]): V3[] {
	return src.map((s, k) => {
		const was = lerp(oldBase[s[0]], oldBase[s[1]], s[2]);
		const from = lerp(other[s[0]], other[s[1]], s[2]);
		return round(add(from, sub(newBase[k], was)));
	});
}

// ------------------------------------------------------------- extrude and inset

/** The chosen faces as a region: its border edges (as the region runs them) and each corner's averaged normal. */
function region(c: Cage, faces: readonly number[]) {
	const sel = new Set(faces);
	const dirs = new Set<string>();
	for (const fi of sel) {
		const f = c.faces[fi];
		for (let i = 0; i < f.length; i++) dirs.add(dkey(f[i], f[(i + 1) % f.length]));
	}
	const border: { a: number; b: number; f: number }[] = [];
	const normals = new Map<number, V3[]>();
	for (const fi of sel) {
		const f = c.faces[fi];
		const n = unit(faceNormal(c.points, f));
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			normals.set(a, [...(normals.get(a) ?? []), n]);
			if (!dirs.has(dkey(b, a))) border.push({ a, b, f: fi });
		}
	}
	/** a direction that moves every face around the corner out by one unit (an even thickness), within reason */
	const even = (list: V3[]): V3 => {
		const n = unit(list.reduce(add, [0, 0, 0] as V3));
		const k = list.reduce((s, x) => s + dot(n, x), 0) / list.length;
		return mul(n, 1 / Math.max(0.34, k));
	};
	const out = new Map<number, V3>();
	for (const [v, list] of normals) out.set(v, even(list));
	return { sel, border, normal: out, even };
}

/** Move a region of faces, walling its border: the heart of extrude and inset. */
function offsetRegion(c: Cage, faces: readonly number[], move: (v: number, onBorder: boolean) => V3): Draft {
	const r = region(c, faces);
	const d = draftOf(c);
	const onBorder = new Set<number>();
	for (const e of r.border) {
		onBorder.add(e.a);
		onBorder.add(e.b);
	}
	const twin = new Map<number, number>();
	for (const v of r.normal.keys()) {
		const p = add(c.points[v], move(v, onBorder.has(v)));
		if (onBorder.has(v)) {
			twin.set(v, d.points.length);
			d.points.push(p);
			d.src.push([v, v, 0]);
		} else d.points[v] = p;
	}
	for (const fi of r.sel) d.faces[fi] = c.faces[fi].map((v) => twin.get(v) ?? v);
	for (const e of r.border) {
		d.faces.push([e.a, e.b, twin.get(e.b)!, twin.get(e.a)!]);
		d.from.push(e.f);
	}
	return d;
}

/** Extrude the chosen faces along their normal by an amount; the border is walled with quads. */
export function extrudeFaces(c: Cage, faces: readonly number[], amount: number): OpResult {
	const list = checkFaces(c, faces);
	if (!Number.isFinite(amount)) throw new MeshError("The amount must be a number.");
	const r = region(c, list);
	const d = offsetRegion(c, list, (v) => mul(r.normal.get(v)!, amount));
	return finish(c, d, { faces: list }, `Extruded ${list.length} face${list.length === 1 ? "" : "s"} by ${r4(amount)}`);
}

/** Inset the chosen faces by an amount: a border ring of quads, the inner faces kept, raised along the normal if asked. */
export function insetFaces(c: Cage, faces: readonly number[], amount: number, raise = 0): OpResult {
	const list = checkFaces(c, faces);
	if (!Number.isFinite(amount) || !Number.isFinite(raise)) throw new MeshError("The amount must be a number.");
	const r = region(c, list);
	if (!r.border.length) throw new MeshError("The chosen faces have no border to inset from: they are the whole of a closed mesh.");
	// each border corner moves inward: across its border edges, in the plane of their faces
	const inward = new Map<number, V3[]>();
	for (const e of r.border) {
		const n = unit(faceNormal(c.points, c.faces[e.f]));
		const dir = unit(cross(n, sub(c.points[e.b], c.points[e.a])));
		inward.set(e.a, [...(inward.get(e.a) ?? []), dir]);
		inward.set(e.b, [...(inward.get(e.b) ?? []), dir]);
	}
	const d = offsetRegion(c, list, (v, on) => {
		const up = mul(r.normal.get(v)!, raise);
		return on ? add(mul(r.even(inward.get(v)!), amount), up) : up;
	});
	return finish(c, d, { faces: list }, `Inset ${list.length} face${list.length === 1 ? "" : "s"} by ${r4(amount)}${raise ? `, raised ${r4(raise)}` : ""}`);
}

/**
 * Extrude open edges: each grows a quad, outward in the plane of its
 * face by `amount`, or along `dir` when one is given.
 */
export function extrudeEdges(c: Cage, edges: readonly (readonly [number, number])[], how: { amount?: number; dir?: V3 }): OpResult {
	if (!edges.length) throw new MeshError("Choose an open edge first.");
	const t = topo(c.faces);
	const run: { a: number; b: number; f: number }[] = [];
	const seen = new Set<string>();
	for (const [p, q] of edges) {
		checkPoint(c, p);
		checkPoint(c, q);
		const e = t.und.get(ekey(p, q));
		if (!e) throw new MeshError(`${p}–${q} is not an edge of the mesh.`);
		if (e.faces.length !== 1) throw new MeshError(`Edge ${p}–${q} has a face on both sides; only an open edge (one on a rim) can be extruded.`);
		if (seen.has(ekey(p, q))) continue;
		seen.add(ekey(p, q));
		const forward = (t.dir.get(dkey(p, q)) ?? []).length > 0;
		run.push({ a: forward ? p : q, b: forward ? q : p, f: e.faces[0] });
	}
	const dir = how.dir;
	const amount = how.amount ?? 1;
	if (dir && !dir.every(Number.isFinite)) throw new MeshError("The direction must be three numbers.");
	if (!dir && !Number.isFinite(amount)) throw new MeshError("The amount must be a number.");
	const out = new Map<number, V3[]>();
	for (const e of run) {
		const n = unit(faceNormal(c.points, c.faces[e.f]));
		const o = unit(cross(sub(c.points[e.b], c.points[e.a]), n));
		out.set(e.a, [...(out.get(e.a) ?? []), o]);
		out.set(e.b, [...(out.get(e.b) ?? []), o]);
	}
	const d = draftOf(c);
	const twin = new Map<number, number>();
	for (const [v, list] of out) {
		const n = unit(list.reduce(add, [0, 0, 0] as V3));
		const k = list.reduce((s, x) => s + dot(n, x), 0) / list.length;
		twin.set(v, d.points.length);
		d.points.push(add(c.points[v], dir ?? mul(n, amount / Math.max(0.34, k))));
		d.src.push([v, v, 0]);
	}
	const made: [number, number][] = [];
	for (const e of run) {
		d.faces.push([e.b, e.a, twin.get(e.a)!, twin.get(e.b)!]);
		d.from.push(e.f);
		made.push([twin.get(e.a)!, twin.get(e.b)!]);
	}
	return finish(c, d, { edges: made }, `Extruded ${run.length} edge${run.length === 1 ? "" : "s"}`);
}

// ------------------------------------------------------------- loop cut

/** The ring of edges a loop cut through a–b would cross, each turned the same way as a–b. Empty when no quad carries it on. */
export function edgeRing(c: Cage, a: number, b: number): [number, number][] {
	const t = topo(c.faces);
	if (!t.und.has(ekey(a, b))) return [];
	const ring: [number, number][] = [[a, b]];
	const seen = new Set([ekey(a, b)]);
	const start = t.und.get(ekey(a, b))!.faces;
	start.forEach((f0, side) => {
		let p = a;
		let q = b;
		let fi: number | undefined = f0;
		let guard = 0;
		while (fi !== undefined && guard++ < 100000) {
			const f: number[] = c.faces[fi];
			if (f.length !== 4) break;
			const ip = f.indexOf(p);
			const iq = f.indexOf(q);
			// the corner next to p that is not q, and the one next to q that is not p
			const s: number = f[(ip + 1) % 4] === q ? f[(ip + 3) % 4] : f[(ip + 1) % 4];
			const r: number = f[(iq + 1) % 4] === p ? f[(iq + 3) % 4] : f[(iq + 1) % 4];
			if (seen.has(ekey(s, r))) break;
			seen.add(ekey(s, r));
			if (side === 0) ring.push([s, r]);
			else ring.unshift([s, r]);
			const cur: number = fi;
			fi = t.und.get(ekey(s, r))!.faces.find((x) => x !== cur);
			p = s;
			q = r;
		}
	});
	return ring;
}

/** A loop cut: a new edge loop across the ring of quads through edge a–b, at fraction t from a toward b. */
export function loopCut(c: Cage, a: number, b: number, t = 0.5): OpResult {
	checkPoint(c, a);
	checkPoint(c, b);
	if (!hasEdge(c, a, b)) throw new MeshError(`${a}–${b} is not an edge of the mesh.`);
	if (!(t > 0 && t < 1)) throw new MeshError("The cut's place is a fraction between 0 and 1.");
	const ring = edgeRing(c, a, b);
	const d = draftOf(c);
	const mid = new Map<string, number>();
	for (const [p, q] of ring) {
		mid.set(ekey(p, q), d.points.length);
		d.points.push(lerp(c.points[p], c.points[q], t));
		d.src.push([p, q, t]);
	}
	const faces: number[][] = [];
	const from: number[] = [];
	const made: [number, number][] = [];
	const halves: { face: number[]; from: number }[] = [];
	let cut = 0;
	c.faces.forEach((f, fi) => {
		const on = f.map((v, i) => mid.get(ekey(v, f[(i + 1) % f.length])));
		// a cut face keeps its place in the list as one half; the other half goes to the end, so no other face is renumbered
		if (f.length === 4 && on[0] !== undefined && on[2] !== undefined && on[1] === undefined && on[3] === undefined) {
			faces.push([f[0], on[0], on[2], f[3]]);
			from.push(fi);
			halves.push({ face: [on[0], f[1], f[2], on[2]], from: fi });
			made.push([on[0], on[2]]);
			cut++;
		} else if (f.length === 4 && on[1] !== undefined && on[3] !== undefined && on[0] === undefined && on[2] === undefined) {
			faces.push([f[1], on[1], on[3], f[0]]);
			from.push(fi);
			halves.push({ face: [on[1], f[2], f[3], on[3]], from: fi });
			made.push([on[1], on[3]]);
			cut++;
		} else if (on.some((m) => m !== undefined)) {
			// a face at the ring's end (not a quad, or cut on one side only): the new corner joins its outline
			const g: number[] = [];
			f.forEach((v, i) => {
				g.push(v);
				if (on[i] !== undefined) g.push(on[i]!);
			});
			faces.push(g);
			from.push(fi);
		} else {
			faces.push([...f]);
			from.push(fi);
		}
	});
	for (const h of halves) {
		faces.push(h.face);
		from.push(h.from);
	}
	if (!cut) throw new MeshError("No ring of quads crosses that edge, so there is nothing to cut: a loop cut runs across four-sided faces.");
	d.faces = faces;
	d.from = from;
	return finish(c, d, { edges: made }, `Cut a loop across ${cut} face${cut === 1 ? "" : "s"}`);
}

// ------------------------------------------------------------- rims: bridge and fill

function rimOf(c: Cage, e: readonly [number, number] | number): number[] {
	const loop = typeof e === "number" ? rimThrough(c, e) : rimThrough(c, e[0], e[1]);
	if (!loop) throw new MeshError(typeof e === "number" ? `Corner ${e} is not on a rim (an open edge of the mesh).` : `Edge ${e[0]}–${e[1]} is not on a rim (an open edge of the mesh).`);
	return loop;
}

/** Bridge two rims of equal count with a band of quads. Each is named by an edge (or a corner) on it. */
export function bridgeRims(c: Cage, first: readonly [number, number] | number, second: readonly [number, number] | number): OpResult {
	const A = rimOf(c, first);
	const B = rimOf(c, second);
	if (A === B || (A.length === B.length && A.every((v) => B.includes(v)))) throw new MeshError("Both edges are on the same rim: choose an edge on each of two rims.");
	if (A.length !== B.length) throw new MeshError(`The rims have ${A.length} and ${B.length} corners: a bridge needs the same count on both.`);
	const n = A.length;
	// B runs the other way round; pair the corners with the turn that keeps the band shortest
	let best = 0;
	let bestD = Infinity;
	for (let off = 0; off < n; off++) {
		let sum = 0;
		for (let i = 0; i < n; i++) sum += len(sub(c.points[A[i]], c.points[B[(((off - i) % n) + n) % n]]));
		if (sum < bestD - 1e-9) {
			bestD = sum;
			best = off;
		}
	}
	const d = draftOf(c);
	const at = (i: number) => B[(((best - i) % n) + n) % n];
	const made: number[] = [];
	for (let i = 0; i < n; i++) {
		made.push(d.faces.length);
		d.faces.push([A[(i + 1) % n], A[i], at(i), at(i + 1)]);
		d.from.push(-1);
	}
	return finish(c, d, { faces: made }, `Bridged two rims of ${n} with ${n} faces`);
}

/** Fill a rim with one face. */
export function fillRim(c: Cage, e: readonly [number, number] | number): OpResult {
	const loop = rimOf(c, e);
	const d = draftOf(c);
	d.faces.push([...loop].reverse());
	d.from.push(-1);
	return finish(c, d, { faces: [d.faces.length - 1] }, `Filled a rim of ${loop.length} with a face`);
}

// ------------------------------------------------------------- delete, merge, flip, wind

/** Delete faces; corners nothing uses go with them. */
export function deleteFaces(c: Cage, faces: readonly number[]): OpResult {
	const list = new Set(checkFaces(c, faces));
	if (list.size >= c.faces.length) throw new MeshError("That would delete every face; delete the shape instead.");
	const d = draftOf(c);
	d.faces = d.faces.filter((_, i) => !list.has(i));
	d.from = d.from.filter((_, i) => !list.has(i));
	return finish(c, d, {}, `Deleted ${list.size} face${list.size === 1 ? "" : "s"}`);
}

/** Merge corners that lie within a distance of each other (all of them, or only those named) into one, at their middle. */
export function mergeCorners(c: Cage, distance: number, only?: readonly number[]): OpResult {
	if (!(distance >= 0)) throw new MeshError("The distance must be zero or more.");
	const n = c.points.length;
	const pool = only ? [...new Set(only)] : c.points.map((_, i) => i);
	for (const i of pool) checkPoint(c, i);
	const parent = c.points.map((_, i) => i);
	const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
	for (let x = 0; x < pool.length; x++) {
		for (let y = x + 1; y < pool.length; y++) {
			const i = pool[x];
			const j = pool[y];
			if (len(sub(c.points[i], c.points[j])) <= distance + 1e-9) parent[find(j)] = find(i);
		}
	}
	const groups = new Map<number, number[]>();
	for (let i = 0; i < n; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
	const d = draftOf(c);
	let merged = 0;
	const to = new Array<number>(n);
	for (const [root, list] of groups) {
		for (const i of list) to[i] = root;
		if (list.length < 2) continue;
		merged += list.length - 1;
		d.points[root] = mul(list.map((i) => c.points[i]).reduce(add, [0, 0, 0] as V3), 1 / list.length);
	}
	if (!merged) throw new MeshError(`No two corners are within ${r4(distance)} of each other.`);
	const faces: number[][] = [];
	const from: number[] = [];
	const seen = new Set<string>();
	c.faces.forEach((f, fi) => {
		const g = f.map((v) => to[v]).filter((v, i, l) => v !== l[(i + l.length - 1) % l.length]);
		if (new Set(g).size < 3 || g.length < 3) return;
		// two faces that became the same outline, back to back, are an inside wall: both go
		const k = [...g].sort((x, y) => x - y).join(",");
		if (seen.has(k)) return;
		seen.add(k);
		faces.push(g);
		from.push(fi);
	});
	d.faces = faces;
	d.from = from;
	d.alias = new Map(to.map((root, i) => [i, root] as [number, number]).filter(([i, root]) => i !== root));
	return finish(c, d, {}, `Merged ${merged} corner${merged === 1 ? "" : "s"}`);
}

/** Flip faces: each winds the other way. */
export function flipFaces(c: Cage, faces: readonly number[]): OpResult {
	const list = checkFaces(c, faces);
	const d = draftOf(c);
	for (const fi of list) d.faces[fi] = [c.faces[fi][0], ...c.faces[fi].slice(1).reverse()];
	return finish(c, d, { faces: list }, `Flipped ${list.length} face${list.length === 1 ? "" : "s"}`);
}

/**
 * Wind the whole mesh outward: within each connected piece neighbours
 * are made to agree, then the piece is turned so the volume it encloses
 * is positive.
 */
export function windOutward(c: Cage): OpResult {
	const d = draftOf(c);
	const t = topo(c.faces);
	const seen = new Array<boolean>(c.faces.length).fill(false);
	const flipped = new Array<boolean>(c.faces.length).fill(false);
	const neighbours = (fi: number) => {
		const f = c.faces[fi];
		const out: { g: number; same: boolean }[] = [];
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			const e = t.und.get(ekey(a, b))!;
			if (e.faces.length !== 2) continue; // an open or a crowded edge says nothing about a neighbour
			const g = e.faces[0] === fi ? e.faces[1] : e.faces[0];
			// neighbours agree when they run the shared edge opposite ways
			out.push({ g, same: !(t.dir.get(dkey(a, b)) ?? []).includes(g) });
		}
		return out;
	};
	let turned = 0;
	for (let s = 0; s < c.faces.length; s++) {
		if (seen[s]) continue;
		const piece = [s];
		seen[s] = true;
		for (let k = 0; k < piece.length; k++) {
			const fi = piece[k];
			for (const { g, same } of neighbours(fi)) {
				if (seen[g]) continue;
				seen[g] = true;
				flipped[g] = same ? flipped[fi] : !flipped[fi];
				piece.push(g);
			}
		}
		const loops = piece.map((fi) => (flipped[fi] ? [...c.faces[fi]].reverse() : c.faces[fi]));
		const pts = piece.flatMap((fi) => c.faces[fi]).map((i) => c.points[i]);
		const centre = mul(pts.reduce(add, [0, 0, 0] as V3), 1 / pts.length);
		const inside = signedVolume(c.points, loops, centre) < 0;
		for (const fi of piece) {
			const flip = flipped[fi] !== inside;
			if (flip) {
				d.faces[fi] = [c.faces[fi][0], ...c.faces[fi].slice(1).reverse()];
				turned++;
			}
		}
	}
	return finish(c, d, {}, turned ? `Turned ${turned} face${turned === 1 ? "" : "s"} to wind outward` : "Every face already winds outward");
}

// ------------------------------------------------------------- creases

/** The crease of an edge, 0 for none. */
export function creaseOf(c: Cage, a: number, b: number): number {
	const k = ekey(a, b);
	const e = (c.creases ?? []).find((x) => x.length === 3 && ekey(x[0], x[1]) === k);
	return e ? e[2] : 0;
}

/** Set the crease of the chosen edges: 0 takes it away, 1 is sharp. */
export function setCreases(c: Cage, edges: readonly (readonly [number, number])[], value: number): OpResult {
	if (!edges.length) throw new MeshError("Choose an edge first.");
	if (!(value >= 0 && value <= 1)) throw new MeshError("A crease is a number from 0 (smooth) to 1 (sharp).");
	const keys = new Set<string>();
	for (const [a, b] of edges) {
		checkPoint(c, a);
		checkPoint(c, b);
		if (!hasEdge(c, a, b)) throw new MeshError(`${a}–${b} is not an edge of the mesh.`);
		keys.add(ekey(a, b));
	}
	const rest = (c.creases ?? []).filter((e) => !(e.length === 3 && keys.has(ekey(e[0], e[1]))));
	if (value > 0) for (const [a, b] of edges) if (keys.delete(ekey(a, b))) rest.push([Math.min(a, b), Math.max(a, b), r4(value)]);
	const cage: Cage = { points: c.points, faces: c.faces, ...(rest.length ? { creases: rest } : {}), ...(c.uvs ? { uvs: c.uvs } : {}) };
	return { cage, src: c.points.map((_, i) => [i, i, 0] as Src), faceFrom: c.faces.map((_, i) => i), edges: edges.map(([a, b]) => [a, b] as [number, number]), note: value > 0 ? `Creased ${edges.length} edge${edges.length === 1 ? "" : "s"} at ${r4(value)}` : `Uncreased ${edges.length} edge${edges.length === 1 ? "" : "s"}` };
}

/** The edges whose two faces meet at more than `degrees` (the angle between their normals). */
export function sharpEdges(c: Cage, degrees: number): [number, number][] {
	const t = topo(c.faces);
	const cos = Math.cos((degrees * Math.PI) / 180);
	const out: [number, number][] = [];
	for (const e of t.und.values()) {
		if (e.faces.length !== 2) continue;
		const n0 = unit(faceNormal(c.points, c.faces[e.faces[0]]));
		const n1 = unit(faceNormal(c.points, c.faces[e.faces[1]]));
		if (dot(n0, n1) < cos - 1e-9) out.push([e.a, e.b]);
	}
	return out;
}

/** Crease by angle: every edge sharper than `degrees` gets the value, unless it has a crease already; the others keep what they have. */
export function creaseByAngle(c: Cage, degrees: number, value = 1): OpResult {
	if (!(degrees >= 0 && degrees <= 180)) throw new MeshError("The angle is in degrees, 0 to 180.");
	const sharp = sharpEdges(c, degrees);
	if (!sharp.length) throw new MeshError(`No edge is sharper than ${r4(degrees)}°.`);
	const edges = sharp.filter(([a, b]) => creaseOf(c, a, b) === 0);
	if (!edges.length) throw new MeshError(`Every edge sharper than ${r4(degrees)}° has a crease already.`);
	const r = setCreases(c, edges, value);
	return { ...r, note: `Creased ${edges.length} edge${edges.length === 1 ? "" : "s"} sharper than ${r4(degrees)}° at ${r4(value)}${edges.length < sharp.length ? ` (${sharp.length - edges.length} had a crease already)` : ""}` };
}

// ------------------------------------------------------------- symmetry across x

/** For each point, the point mirrored across x = 0 (itself when it lies on the plane), -1 when there is none. */
export function mirrorMap(points: readonly V3[], eps = 1e-3): number[] {
	const key = (x: number, y: number, z: number) => `${Math.round(x / eps / 2)},${Math.round(y / eps / 2)},${Math.round(z / eps / 2)}`;
	const at = new Map<string, number[]>();
	points.forEach((p, i) => at.set(key(p[0], p[1], p[2]), [...(at.get(key(p[0], p[1], p[2])) ?? []), i]));
	return points.map((p, i) => {
		if (Math.abs(p[0]) <= eps) return i;
		// the cell the mirror lands in, and its neighbours (a point near a cell wall may be over it)
		let best = -1;
		let bestD = eps * 2;
		for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
			for (const j of at.get(key(-p[0] + dx * eps * 2, p[1] + dy * eps * 2, p[2] + dz * eps * 2)) ?? []) {
				const q = points[j];
				const dd = Math.hypot(q[0] + p[0], q[1] - p[1], q[2] - p[2]);
				if (dd < bestD) {
					bestD = dd;
					best = j;
				}
			}
		}
		return best;
	});
}

/** The chosen faces and their mirrors across x. */
export function withMirrorFaces(c: Cage, faces: readonly number[]): number[] {
	const m = mirrorMap(c.points);
	const byKey = new Map<string, number>();
	c.faces.forEach((f, i) => byKey.set([...f].sort((a, b) => a - b).join(","), i));
	const out = new Set(faces);
	for (const fi of faces) {
		const f = c.faces[fi];
		if (!f) continue;
		const g = f.map((v) => m[v]);
		if (g.some((v) => v < 0)) continue;
		const other = byKey.get([...g].sort((a, b) => a - b).join(","));
		if (other !== undefined) out.add(other);
	}
	return [...out];
}

/** The chosen edges and their mirrors across x. */
export function withMirrorEdges(c: Cage, edges: readonly (readonly [number, number])[]): [number, number][] {
	const m = mirrorMap(c.points);
	const out = new Map<string, [number, number]>();
	for (const [a, b] of edges) {
		out.set(ekey(a, b), [a, b]);
		const p = m[a];
		const q = m[b];
		if (p >= 0 && q >= 0 && p !== q && hasEdge(c, p, q) && !out.has(ekey(p, q))) out.set(ekey(p, q), [p, q]);
	}
	return [...out.values()];
}

/** The chosen corners and their mirrors across x. */
export function withMirrorVerts(c: Cage, verts: readonly number[]): number[] {
	const m = mirrorMap(c.points);
	const out = new Set(verts);
	for (const v of verts) if (m[v] >= 0) out.add(m[v]);
	return [...out];
}
