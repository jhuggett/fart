// Collision (1.4): the document's solids as an engine sees them under a
// pose: shapes that ride a part go through its world transform, boxes
// expand to convex meshes, and every collider carries its layer. Plus
// the convex hull a tool derives from a part's visible shapes.

import type { BoxShape, CollisionShape3, Doc, Doc3, MeshShape, Shape, Vec2, Vec3 } from "./types.ts";
import { worldTransforms, xfApply, xfScale, type Xf } from "./geometry.ts";
import { localXf3, quatFromEuler, quatToMat, shapesOf3, worldTransforms3, xf3Apply, xf3Scale, v3cross, v3dot, v3norm, v3sub, v3len, type Xf3 } from "./space3.ts";
import { ballMesh, rodMesh, windOutward } from "./solids.ts";
import type { StatePart, StatePart3 } from "./types.ts";

/** A 3D solid in document space, ready for a plane or distance test. */
export type Collider3 = {
	/** absent means "solid" in the file; here it is always set */
	layer: string;
	/** the part it rode, if any */
	part?: string;
	/** anything else the shape carried (an engine's own fields, meta) */
	extra: Record<string, unknown>;
} & (
	| { kind: "ball"; at: Vec3; r: number }
	| { kind: "rod"; a: Vec3; b: Vec3; w: number }
	| { kind: "mesh"; points: Vec3[]; faces: number[][]; tris: number[] }
);

const OWN = new Set(["kind", "color", "shade", "at", "r", "a", "b", "w", "points", "faces", "tris", "size", "rotate", "part", "layer"]);
function extraOf(sh: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(sh)) if (!OWN.has(k)) out[k] = sh[k];
	return out;
}

/** A box as the eight-point, six-face outward mesh it stands for. */
export function boxMesh(b: BoxShape): MeshShape {
	const h: Vec3 = [b.size[0] / 2, b.size[1] / 2, b.size[2] / 2];
	const R = quatToMat(quatFromEuler(b.rotate ?? [0, 0, 0]));
	const points: Vec3[] = [];
	for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) {
		const l: Vec3 = [dx * h[0], dy * h[1], dz * h[2]];
		points.push([b.at[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], b.at[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], b.at[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]]);
	}
	const m: MeshShape = { kind: "mesh", points, faces: [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]] };
	windOutward(m);
	m.tris = [];
	for (const f of m.faces) m.tris.push(f[0], f[1], f[2], f[0], f[2], f[3]);
	return m;
}

function meshTris(m: MeshShape): number[] {
	if (m.tris && m.tris.length % 3 === 0 && m.tris.every((i) => i < m.points.length)) return m.tris;
	const out: number[] = [];
	for (const f of m.faces) for (let i = 1; i + 1 < f.length; i++) out.push(f[0], f[i], f[i + 1]);
	return out;
}

/**
 * Every collision shape of a 3D document in document space under a pose
 * list (a state's parts, a sampled clip frame): shapes that name a part
 * ride its world transform, the rest pass through; boxes become meshes.
 * A part drawn like another carries the shapes that name its source.
 */
export function collisionWorld3(doc: Doc3, poses?: readonly StatePart3[]): Collider3[] {
	const out: Collider3[] = [];
	const W = worldTransforms3(doc, poses ?? []);
	const parts = doc.parts ?? [];
	const placed = (sh: CollisionShape3, T: Xf3 | undefined, part?: string) => {
		const base = { layer: sh.layer ?? "solid", extra: extraOf(sh as Record<string, unknown>) } as { layer: string; extra: Record<string, unknown>; part?: string };
		if (part) base.part = part;
		const mv = (p: Vec3): Vec3 => (T ? xf3Apply(T, p) : p);
		const s = T ? xf3Scale(T) : 1;
		if (sh.kind === "ball") out.push({ ...base, kind: "ball", at: mv(sh.at), r: sh.r * s });
		else if (sh.kind === "rod") out.push({ ...base, kind: "rod", a: mv(sh.a), b: mv(sh.b), w: sh.w * s });
		else {
			const m = sh.kind === "box" ? boxMesh(sh) : sh;
			let faces = m.faces.map((f) => [...f]);
			let tris = [...meshTris(m)];
			if (T && (T[0] * (T[4] * T[8] - T[5] * T[7]) - T[1] * (T[3] * T[8] - T[5] * T[6]) + T[2] * (T[3] * T[7] - T[4] * T[6])) < 0) {
				// a mirror turns the winding inside out: turn it back
				faces = faces.map((f) => f.reverse());
				const t2: number[] = [];
				for (let i = 0; i + 2 < tris.length; i += 3) t2.push(tris[i], tris[i + 2], tris[i + 1]);
				tris = t2;
			}
			out.push({ ...base, kind: "mesh", points: m.points.map(mv), faces, tris });
		}
	};
	for (const sh of doc.collision ?? []) {
		if (!sh.part) {
			placed(sh, undefined);
			continue;
		}
		// the part itself, and every part drawn like it
		for (const p of parts) {
			const src = p.like ?? p.name;
			if (src !== sh.part) continue;
			placed(sh, W.get(p.name), p.name);
		}
	}
	return out;
}

/** A 2D solid in document space. */
export type Collider = { layer: string; part?: string; extra: Record<string, unknown> } & (
	| { kind: "circle"; at: Vec2; r: number }
	| { kind: "line"; a: Vec2; b: Vec2; w: number }
	| { kind: "poly"; points: Vec2[]; tris?: number[] }
);

/** The 2D counterpart: shapes that name a part ride the 2D world transform. */
export function collisionWorld(doc: Doc, poses?: readonly StatePart[]): Collider[] {
	const out: Collider[] = [];
	const W = worldTransforms(doc, poses ?? []);
	const parts = doc.parts ?? [];
	const placed = (sh: Shape, T: Xf | undefined, part?: string) => {
		const base = { layer: sh.layer ?? "solid", extra: extraOf(sh as Record<string, unknown>) } as { layer: string; extra: Record<string, unknown>; part?: string };
		if (part) base.part = part;
		const mv = (p: Vec2): Vec2 => (T ? xfApply(T, p) : p);
		const s = T ? xfScale(T) : 1;
		if (sh.kind === "circle") out.push({ ...base, kind: "circle", at: mv(sh.at), r: sh.r * s });
		else if (sh.kind === "line") out.push({ ...base, kind: "line", a: mv(sh.a), b: mv(sh.b), w: sh.w * s });
		else out.push({ ...base, kind: "poly", points: sh.points.map(mv), ...(sh.tris ? { tris: [...sh.tris] } : {}) });
	};
	for (const sh of doc.collision ?? []) {
		if (!sh.part) {
			placed(sh, undefined);
			continue;
		}
		for (const p of parts) if ((p.like ?? p.name) === sh.part) placed(sh, W.get(p.name), p.name);
	}
	return out;
}

// ------------------------------------------------------------- hulls

/** The convex hull of a point cloud as an outward-wound mesh, coplanar triangles merged into faces; null when the points are flat. */
export function convexHull(input: readonly Vec3[]): MeshShape | null {
	// unique points
	const pts: Vec3[] = [];
	const seen = new Set<string>();
	for (const p of input) {
		const k = p.map((x) => Math.round(x * 1e5)).join(",");
		if (!seen.has(k)) {
			seen.add(k);
			pts.push([p[0], p[1], p[2]]);
		}
	}
	if (pts.length < 4) return null;
	let scale = 0;
	for (const p of pts) scale = Math.max(scale, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
	const eps = 1e-6 * Math.max(1, scale);
	// an initial tetrahedron: the two farthest apart, the farthest from that line, the farthest from that plane
	let i0 = 0;
	let i1 = 0;
	let best = -1;
	for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
		const d = v3len(v3sub(pts[i], pts[j]));
		if (d > best) {
			best = d;
			i0 = i;
			i1 = j;
		}
	}
	if (best < eps) return null;
	const d01 = v3sub(pts[i1], pts[i0]);
	let i2 = -1;
	best = eps;
	for (let i = 0; i < pts.length; i++) {
		const d = v3len(v3cross(d01, v3sub(pts[i], pts[i0]))) / v3len(d01);
		if (d > best) {
			best = d;
			i2 = i;
		}
	}
	if (i2 < 0) return null;
	const n0 = v3norm(v3cross(d01, v3sub(pts[i2], pts[i0])));
	let i3 = -1;
	best = eps;
	for (let i = 0; i < pts.length; i++) {
		const d = Math.abs(v3dot(n0, v3sub(pts[i], pts[i0])));
		if (d > best) {
			best = d;
			i3 = i;
		}
	}
	if (i3 < 0) return null;
	// faces as triangles wound so the normal points away from the tetrahedron's centre
	type Tri = { v: [number, number, number]; n: Vec3; d: number; dead: boolean };
	const tris: Tri[] = [];
	const centre: Vec3 = [(pts[i0][0] + pts[i1][0] + pts[i2][0] + pts[i3][0]) / 4, (pts[i0][1] + pts[i1][1] + pts[i2][1] + pts[i3][1]) / 4, (pts[i0][2] + pts[i1][2] + pts[i2][2] + pts[i3][2]) / 4];
	const make = (a: number, b: number, c: number): Tri => {
		let n = v3norm(v3cross(v3sub(pts[b], pts[a]), v3sub(pts[c], pts[a])));
		let v: [number, number, number] = [a, b, c];
		if (v3dot(n, v3sub(centre, pts[a])) > 0) {
			n = [-n[0], -n[1], -n[2]];
			v = [a, c, b];
		}
		return { v, n, d: v3dot(n, pts[a]), dead: false };
	};
	tris.push(make(i0, i1, i2), make(i0, i1, i3), make(i0, i2, i3), make(i1, i2, i3));
	const used = new Set([i0, i1, i2, i3]);
	// add every other point: remove the faces it sees, close the hole with new faces to its horizon
	for (let p = 0; p < pts.length; p++) {
		if (used.has(p)) continue;
		const q = pts[p];
		const visible = tris.filter((t) => !t.dead && v3dot(t.n, q) - t.d > eps);
		if (!visible.length) continue;
		const edgeCount = new Map<string, { a: number; b: number; n: number }>();
		for (const t of visible) {
			t.dead = true;
			for (let i = 0; i < 3; i++) {
				const a = t.v[i];
				const b = t.v[(i + 1) % 3];
				const k = a < b ? `${a}:${b}` : `${b}:${a}`;
				const e = edgeCount.get(k) ?? { a, b, n: 0 };
				e.n++;
				edgeCount.set(k, e);
			}
		}
		for (const e of edgeCount.values()) {
			if (e.n !== 1) continue; // an inner edge of the visible patch
			// keep the horizon edge's direction as the dead face had it, so the new face winds outward
			const t = make(e.a, e.b, p);
			tris.push(t);
		}
		used.add(p);
	}
	const live = tris.filter((t) => !t.dead);
	// merge coplanar neighbours into faces: group by plane, take each group's boundary loop
	const groups: Tri[][] = [];
	for (const t of live) {
		const g = groups.find((gr) => v3dot(gr[0].n, t.n) > 1 - 1e-6 && Math.abs(gr[0].d - t.d) < 1e-5 * Math.max(1, scale));
		if (g) g.push(t);
		else groups.push([t]);
	}
	const faces: number[][] = [];
	for (const g of groups) {
		const dir = new Map<string, [number, number]>();
		const count = new Map<string, number>();
		for (const t of g) for (let i = 0; i < 3; i++) {
			const a = t.v[i];
			const b = t.v[(i + 1) % 3];
			const k = a < b ? `${a}:${b}` : `${b}:${a}`;
			count.set(k, (count.get(k) ?? 0) + 1);
			dir.set(k, [a, b]);
		}
		const next = new Map<number, number>();
		for (const [k, c] of count) if (c === 1) {
			const [a, b] = dir.get(k)!;
			next.set(a, b);
		}
		if (!next.size) continue;
		const start = next.keys().next().value as number;
		const loop = [start];
		let cur = next.get(start)!;
		let guard = 0;
		while (cur !== start && guard++ < next.size + 1) {
			loop.push(cur);
			cur = next.get(cur)!;
			if (cur === undefined) break;
		}
		// drop collinear corners
		const clean = loop.filter((_, i) => {
			const a = pts[loop[(i + loop.length - 1) % loop.length]];
			const b = pts[loop[i]];
			const c = pts[loop[(i + 1) % loop.length]];
			return v3len(v3cross(v3sub(b, a), v3sub(c, b))) > eps * Math.max(1, v3len(v3sub(c, a)));
		});
		if (clean.length >= 3) faces.push(clean);
	}
	// only the points a face uses, renumbered
	const usedIdx = [...new Set(faces.flat())].sort((a, b) => a - b);
	const remap = new Map(usedIdx.map((v, i) => [v, i]));
	const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
	const mesh: MeshShape = { kind: "mesh", points: usedIdx.map((i) => [r3(pts[i][0]), r3(pts[i][1]), r3(pts[i][2])] as Vec3), faces: faces.map((f) => f.map((i) => remap.get(i)!)) };
	windOutward(mesh);
	mesh.tris = [];
	for (const f of mesh.faces) for (let i = 1; i + 1 < f.length; i++) mesh.tris.push(f[0], f[i], f[i + 1]);
	return mesh;
}

/**
 * The convex hull of a part's visible shapes (through `like`) as a
 * collision mesh that rides the part: mesh points as they are, a ball
 * as a coarse sphere, a rod as its capsule's ends. Null when the part
 * has no volume.
 */
export function hullPart(doc: Doc3, partName: string): MeshShape | null {
	const part = (doc.parts ?? []).find((p) => p.name === partName);
	if (!part) return null;
	const cloud: Vec3[] = [];
	for (const sh of shapesOf3(doc, part)) {
		if (sh.kind === "mesh") cloud.push(...sh.points);
		else if (sh.kind === "ball") cloud.push(...ballMesh(sh, 4, 8).points);
		else {
			const m = rodMesh(sh, 8);
			cloud.push(...m.points);
			// the capsule's round ends reach w/2 past the rod's ends
			const d = v3norm(v3sub(sh.b, sh.a));
			const h = sh.w / 2;
			cloud.push([sh.a[0] - d[0] * h, sh.a[1] - d[1] * h, sh.a[2] - d[2] * h], [sh.b[0] + d[0] * h, sh.b[1] + d[1] * h, sh.b[2] + d[2] * h]);
		}
	}
	const hull = convexHull(cloud);
	if (!hull) return null;
	hull.part = part.like ?? part.name;
	hull.meta = { hull: true };
	return hull;
}

/** Write a part's hull into the document's collision, replacing the hull it had. Returns it, or null. */
export function setHull(doc: Doc3, partName: string): MeshShape | null {
	const hull = hullPart(doc, partName);
	if (!hull) return null;
	const list = (doc.collision ??= []);
	const i = list.findIndex((sh) => sh.part === hull.part && (sh.meta as { hull?: boolean } | undefined)?.hull === true);
	if (i >= 0) list[i] = hull;
	else list.push(hull);
	return hull;
}

void localXf3;
