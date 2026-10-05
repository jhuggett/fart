// Modifiers (1.8): a mesh's `mods`, applied to its cage in order after a
// morph and before `smooth`. Mirror reflects the cage through a plane and
// welds the seam; solidify gives a surface thickness and a rim; crease
// marks every edge sharper than an angle. Paint, shades, creases and
// pattern coordinates ride through each. What a mod decides (which points
// weld, which edges crease) it decides on the rest cage, so a morph moves
// positions and never the topology.

import type { MeshShape, Mod, Vec2, Vec3 } from "./types.ts";

/** Where a morphed mesh keeps its rest points, so the mods decide as they do at rest. */
const REST = Symbol.for("fastart.rest");

/** A mesh with other points (a morph's): the same shape, its rest points remembered for the mods. */
export function posedMesh(sh: MeshShape, points: Vec3[]): MeshShape {
	const out: MeshShape = { ...sh, points };
	if (sh.mods?.length) Object.defineProperty(out, REST, { value: restOf(sh), enumerable: false });
	return out;
}

/** The points the mods decide on: the base cage's under a morph, else the mesh's own. */
export function restOf(sh: MeshShape): Vec3[] {
	const rest = (sh as unknown as Record<symbol, unknown>)[REST] as Vec3[] | undefined;
	return rest && rest.length === sh.points.length ? rest : sh.points;
}

interface Work {
	points: Vec3[];
	rest: Vec3[];
	faces: number[][];
	paint: number[];
	shades?: number[];
	creases: number[][];
	uvs?: Vec2[][];
}

const AXES = { x: 0, y: 1, z: 2 } as const;
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const r4 = (x: number) => Math.round(x * 10000) / 10000 + 0;

/** A face's unit normal by Newell's method; zero for a degenerate face. */
function unitNormal(points: readonly Vec3[], f: readonly number[]): Vec3 {
	let x = 0;
	let y = 0;
	let z = 0;
	for (let i = 0; i < f.length; i++) {
		const a = points[f[i]];
		const b = points[f[(i + 1) % f.length]];
		if (!a || !b) return [0, 0, 0];
		x += (a[1] - b[1]) * (a[2] + b[2]);
		y += (a[2] - b[2]) * (a[0] + b[0]);
		z += (a[0] - b[0]) * (a[1] + b[1]);
	}
	const l = Math.hypot(x, y, z);
	return l < 1e-12 ? [0, 0, 0] : [x / l, y / l, z / l];
}

/** A normal per point: the unit normals of its faces summed, then made unit. */
function pointNormals(points: readonly Vec3[], faces: readonly number[][]): Vec3[] {
	const acc: Vec3[] = points.map(() => [0, 0, 0]);
	for (const f of faces) {
		const n = unitNormal(points, f);
		for (const i of f) {
			const a = acc[i];
			if (a) acc[i] = [a[0] + n[0], a[1] + n[1], a[2] + n[2]];
		}
	}
	return acc.map((a) => {
		const l = Math.hypot(a[0], a[1], a[2]);
		return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
	});
}

function mirror(w: Work, mod: Mod): void {
	const ax = AXES[mod.axis as "x" | "y" | "z"] ?? 0;
	const merge = typeof mod.merge === "number" && mod.merge >= 0 ? mod.merge : 0.001;
	const n = w.points.length;
	const welded = w.rest.map((p) => Math.abs(p[ax]) <= merge);
	const map: number[] = [];
	let next = n;
	for (let i = 0; i < n; i++) map.push(welded[i] ? i : next++);
	const flip = (p: Vec3): Vec3 => {
		const q: Vec3 = [p[0], p[1], p[2]];
		q[ax] = -q[ax] + 0;
		return q;
	};
	const pin = (p: Vec3): Vec3 => {
		const q: Vec3 = [p[0], p[1], p[2]];
		q[ax] = 0;
		return q;
	};
	for (const list of w.rest === w.points ? [w.points] : [w.points, w.rest]) {
		for (let i = 0; i < n; i++) {
			if (welded[i]) list[i] = pin(list[i]);
			else list.push(flip(list[i]));
		}
	}
	if (w.shades) for (let i = 0; i < n; i++) if (!welded[i]) w.shades.push(w.shades[i]);
	const count = w.faces.length;
	for (let fi = 0; fi < count; fi++) {
		const f = w.faces[fi];
		// a face lying in the plane is its own reflection
		if (f.every((i) => welded[i])) continue;
		w.faces.push(f.map((i) => map[i]).reverse());
		w.paint.push(w.paint[fi]);
		if (w.uvs) w.uvs.push([...w.uvs[fi]].reverse());
	}
	const creases = w.creases.length;
	for (let ci = 0; ci < creases; ci++) {
		const c = w.creases[ci];
		if (c.length >= 3) {
			if (!(welded[c[0]] && welded[c[1]])) w.creases.push([map[c[0]], map[c[1]], c[2]]);
		} else if (c.length === 2 && !welded[c[0]]) w.creases.push([map[c[0]], c[1]]);
	}
}

function solidify(w: Work, mod: Mod): void {
	const thick = typeof mod.thick === "number" ? mod.thick : 0;
	const o = Math.max(-1, Math.min(1, typeof mod.offset === "number" ? mod.offset : -1));
	const out = (thick * (1 + o)) / 2;
	const inn = (thick * (1 - o)) / 2;
	const n = w.points.length;
	const shells = (pts: Vec3[]): Vec3[] => {
		const nor = pointNormals(pts, w.faces);
		const at = (k: number) => pts.map((p, i): Vec3 => [p[0] + nor[i][0] * k, p[1] + nor[i][1] * k, p[2] + nor[i][2] * k]);
		return [...at(out), ...at(-inn)];
	};
	const same = w.rest === w.points;
	w.points = shells(w.points);
	w.rest = same ? w.points : shells(w.rest);
	if (w.shades) w.shades = [...w.shades, ...w.shades];
	// how many faces use each edge: one is a boundary
	const uses = new Map<string, number>();
	for (const f of w.faces) for (let i = 0; i < f.length; i++) {
		const k = edgeKey(f[i], f[(i + 1) % f.length]);
		uses.set(k, (uses.get(k) ?? 0) + 1);
	}
	const count = w.faces.length;
	const inner = typeof mod.inner === "number" ? mod.inner : null;
	const rim = typeof mod.rim === "number" ? mod.rim : null;
	for (let fi = 0; fi < count; fi++) {
		w.faces.push(w.faces[fi].map((i) => i + n).reverse());
		w.paint.push(inner ?? w.paint[fi]);
		if (w.uvs) w.uvs.push([...w.uvs[fi]].reverse());
	}
	for (let fi = 0; fi < count; fi++) {
		const f = w.faces[fi];
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			if (a === b || uses.get(edgeKey(a, b)) !== 1) continue;
			w.faces.push([b, a, a + n, b + n]);
			w.paint.push(rim ?? w.paint[fi]);
			if (w.uvs) {
				const ua = w.uvs[fi][i];
				const ub = w.uvs[fi][(i + 1) % f.length];
				w.uvs.push([ub, ua, ua, ub]);
			}
		}
	}
	const creases = w.creases.length;
	for (let ci = 0; ci < creases; ci++) {
		const c = w.creases[ci];
		if (c.length >= 3) w.creases.push([c[0] + n, c[1] + n, c[2]]);
		else if (c.length === 2) w.creases.push([c[0] + n, c[1]]);
	}
}

function crease(w: Work, mod: Mod): void {
	const angle = typeof mod.angle === "number" ? mod.angle : 30;
	const value = typeof mod.value === "number" ? mod.value : 1;
	const limit = Math.cos((Math.max(0, Math.min(180, angle)) * Math.PI) / 180);
	const normals = w.faces.map((f) => unitNormal(w.rest, f));
	const edges = new Map<string, { a: number; b: number; faces: number[] }>();
	w.faces.forEach((f, fi) => {
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			if (a === b) continue;
			const k = edgeKey(a, b);
			const e = edges.get(k) ?? { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
			e.faces.push(fi);
			edges.set(k, e);
		}
	});
	const has = new Set<string>();
	for (const c of w.creases) if (c.length >= 3) has.add(edgeKey(c[0], c[1]));
	for (const [k, e] of edges) {
		if (e.faces.length !== 2 || has.has(k)) continue;
		const n1 = normals[e.faces[0]];
		const n2 = normals[e.faces[1]];
		if (n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < limit - 1e-9) w.creases.push([e.a, e.b, value]);
	}
}

const built = new Map<string, MeshShape>();

/**
 * A cage with its mods applied: a plain mesh (no `mods`, no bake, no
 * tris) holding the points, faces, paint, shades, creases and pattern
 * coordinates the mods leave. A mesh without mods is returned as it is.
 * An op this reader does not know is passed over.
 */
export function applyMods(sh: MeshShape): MeshShape {
	const mods = sh.mods;
	if (!Array.isArray(mods) || !mods.length) return sh;
	const rest = restOf(sh);
	const posed = rest !== sh.points;
	const key = JSON.stringify([sh.points, posed ? rest : null, sh.faces, sh.creases ?? null, mods, sh.paint ?? null, sh.shades ?? null, sh.mapping?.uvs ?? null]);
	let hit = built.get(key);
	if (!hit) {
		const uvs = sh.mapping?.uvs;
		const fits = Array.isArray(uvs) && uvs.length === sh.faces.length && uvs.every((f, i) => Array.isArray(f) && f.length === sh.faces[i].length);
		const w: Work = {
			points: sh.points.map((p) => [p[0], p[1], p[2]]),
			rest: [],
			faces: sh.faces.map((f) => [...f]),
			paint: Array.isArray(sh.paint) && sh.paint.length === sh.faces.length ? [...sh.paint] : sh.faces.map(() => 0),
			shades: Array.isArray(sh.shades) && sh.shades.length === sh.points.length ? [...sh.shades] : undefined,
			creases: (sh.creases ?? []).map((c) => [...c]),
			uvs: fits ? uvs!.map((f) => [...f]) : undefined,
		};
		w.rest = posed ? rest.map((p) => [p[0], p[1], p[2]]) : w.points;
		for (const mod of mods) {
			if (!mod || typeof mod !== "object") continue;
			if (mod.op === "mirror") mirror(w, mod);
			else if (mod.op === "solidify") solidify(w, mod);
			else if (mod.op === "crease") crease(w, mod);
		}
		hit = { kind: "mesh", points: w.points.map((p) => [r4(p[0]), r4(p[1]), r4(p[2])]), faces: w.faces };
		if (w.paint.some((p) => p !== 0)) hit.paint = w.paint;
		if (w.shades) hit.shades = w.shades;
		if (w.creases.length) hit.creases = w.creases;
		if (w.uvs) hit.mapping = { uvs: w.uvs };
		if (built.size > 128) built.clear();
		built.set(key, hit);
	}
	const { mods: _m, bake: _b, tris: _t, paint: _p, shades: _s, creases: _c, mapping, ...look } = sh;
	void _m;
	void _b;
	void _t;
	void _p;
	void _s;
	void _c;
	const out: MeshShape = { ...look, points: hit.points, faces: hit.faces };
	if (hit.paint) out.paint = hit.paint;
	if (hit.shades) out.shades = hit.shades;
	if (hit.creases) out.creases = hit.creases;
	// explicit pattern coordinates are the built faces' own; ones that never fitted the cage leave box mapping
	if (mapping) {
		const { uvs: _u, ...restMapping } = mapping;
		void _u;
		out.mapping = hit.mapping?.uvs ? { ...restMapping, uvs: hit.mapping.uvs } : restMapping;
	}
	return out;
}
