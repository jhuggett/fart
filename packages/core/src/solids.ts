// Solids (1.3): the helpers that make meshes worth having, shared by the
// studio's tools, the example generators, and any script an agent
// writes. Boxes, extruded profiles and lathed profiles come out wound
// outward whatever the input's order; windOutward fixes any closed mesh;
// ballMesh and rodMesh tessellate the round kinds; triMesh flattens a
// shape into the triangle list a renderer uploads; Y_UP takes the
// format's y-down frame to the y-up one most engines use.

import type { BallShape, Doc3, MeshShape, Part3, RodShape, Shape3, Vec2, Vec3 } from "./types.ts";
import { faceNormal, shapesOf3, triangulateFace, v3cross, v3dot, v3norm, v3sub, type Xf3 } from "./space3.ts";

export type Axis = "x" | "y" | "z";

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const round = (p: Vec3): Vec3 => [r3(p[0]), r3(p[1]), r3(p[2])];

/**
 * Make every face of a closed mesh wind outward: neighbours are made to
 * agree across shared edges, then the whole is flipped if its signed
 * volume comes out negative. Concave solids are fine. The mesh is
 * returned, changed in place; `tris` are dropped (bake them again).
 */
export function windOutward(mesh: MeshShape): MeshShape {
	const faces = mesh.faces.map((f) => [...f]);
	const n = faces.length;
	if (!n) return mesh;
	// directed edges of each face, for finding neighbours
	const byEdge = new Map<string, { face: number; dir: 1 | -1 }[]>();
	const edges = (f: number[]) => f.map((a, i) => [a, f[(i + 1) % f.length]] as [number, number]);
	const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
	faces.forEach((f, fi) => {
		for (const [a, b] of edges(f)) {
			const k = key(a, b);
			const list = byEdge.get(k) ?? [];
			list.push({ face: fi, dir: a < b ? 1 : -1 });
			byEdge.set(k, list);
		}
	});
	const seen = new Array<boolean>(n).fill(false);
	for (let start = 0; start < n; start++) {
		if (seen[start]) continue;
		seen[start] = true;
		const queue = [start];
		while (queue.length) {
			const fi = queue.shift()!;
			for (const [a, b] of edges(faces[fi])) {
				const mine = a < b ? 1 : -1;
				for (const nb of byEdge.get(key(a, b)) ?? []) {
					if (nb.face === fi || seen[nb.face]) continue;
					// a consistent neighbour walks the shared edge the other way
					const theirs = faces[nb.face].some((x, i) => x === a && faces[nb.face][(i + 1) % faces[nb.face].length] === b) ? mine : -mine;
					if (theirs === mine) faces[nb.face].reverse();
					seen[nb.face] = true;
					queue.push(nb.face);
				}
			}
		}
	}
	let vol = 0;
	for (const f of faces) {
		const tris = triangulateFace(mesh.points, f);
		for (let i = 0; i + 2 < tris.length; i += 3) {
			const a = mesh.points[tris[i]];
			const b = mesh.points[tris[i + 1]];
			const c = mesh.points[tris[i + 2]];
			vol += v3dot(a, v3cross(b, c));
		}
	}
	mesh.faces = vol < 0 ? faces.map((f) => f.reverse()) : faces;
	delete mesh.tris;
	return mesh;
}

/** A box centred at `center`, `size` along x, y, z. */
export function box(color: string, center: Vec3, size: Vec3): MeshShape {
	const h: Vec3 = [size[0] / 2, size[1] / 2, size[2] / 2];
	const points: Vec3[] = [];
	for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1]) points.push(round([center[0] + dx * h[0], center[1] + dy * h[1], center[2] + dz * h[2]]));
	const faces = [
		[0, 1, 3, 2],
		[4, 5, 7, 6],
		[0, 1, 5, 4],
		[2, 3, 7, 6],
		[0, 2, 6, 4],
		[1, 3, 7, 5],
	];
	return windOutward({ kind: "mesh", color, points, faces });
}

/** A profile point onto an axis-aligned plane: for axis x the profile is [z, y]; y: [x, z]; z: [x, y]. */
function lift(axis: Axis, along: number, uv: Vec2): Vec3 {
	if (axis === "x") return [along, uv[1], uv[0]];
	if (axis === "y") return [uv[0], along, uv[1]];
	return [uv[0], uv[1], along];
}

/**
 * A profile (three or more points, either way round, concave is fine)
 * extruded along an axis from `from` to `to`: a prism. The classic way
 * to build a low-poly thing is to draw its side and extrude it.
 */
export function extrude(color: string, profile: Vec2[], axis: Axis, from: number, to: number): MeshShape {
	const n = profile.length;
	const points: Vec3[] = [...profile.map((uv) => round(lift(axis, from, uv))), ...profile.map((uv) => round(lift(axis, to, uv)))];
	const faces: number[][] = [profile.map((_, i) => i), profile.map((_, i) => i + n)];
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		faces.push([i, j, j + n, i + n]);
	}
	return windOutward({ kind: "mesh", color, points, faces });
}

/**
 * A profile of [radius, along] pairs revolved about an axis, in
 * `segments` steps: a barrel, a bottle, a wheel. A zero radius is a
 * point on the axis (an apex); an open end (radius above 0 at either
 * end of the profile) is capped.
 */
export function lathe(color: string, profile: Vec2[], axis: Axis, segments = 12): MeshShape {
	const points: Vec3[] = [];
	const rings: number[][] = [];
	const ring = (r: number, t: number): number[] => {
		if (r <= 0) {
			points.push(round(lift(axis, t, [0, 0])));
			return [points.length - 1];
		}
		const out: number[] = [];
		for (let k = 0; k < segments; k++) {
			const th = (k / segments) * Math.PI * 2;
			points.push(round(lift(axis, t, [r * Math.cos(th), r * Math.sin(th)])));
			out.push(points.length - 1);
		}
		return out;
	};
	for (const [r, t] of profile) rings.push(ring(r, t));
	const faces: number[][] = [];
	for (let i = 0; i + 1 < rings.length; i++) {
		const a = rings[i];
		const b = rings[i + 1];
		if (a.length === 1 && b.length === 1) continue;
		for (let k = 0; k < segments; k++) {
			const k2 = (k + 1) % segments;
			if (a.length === 1) faces.push([a[0], b[k2], b[k]]);
			else if (b.length === 1) faces.push([a[k], a[k2], b[0]]);
			else faces.push([a[k], a[k2], b[k2], b[k]]);
		}
	}
	if (rings[0].length > 1) faces.push([...rings[0]]);
	const last = rings[rings.length - 1];
	if (last.length > 1) faces.push([...last]);
	return windOutward({ kind: "mesh", color, points, faces });
}

/** A ball as a mesh: `rings` from pole to pole, `segments` around. */
export function ballMesh(ball: BallShape, rings = 7, segments = 12): MeshShape {
	const profile: Vec2[] = [];
	for (let i = 0; i <= rings; i++) {
		const ph = (i / rings) * Math.PI;
		profile.push([ball.r * Math.sin(ph), ball.at[1] - ball.r * Math.cos(ph)]);
	}
	const m = lathe(ball.color ?? "", profile, "y", segments);
	m.points = m.points.map((p) => round([p[0] + ball.at[0], p[1], p[2] + ball.at[2]]));
	if (ball.shade !== undefined) m.shade = ball.shade;
	return m;
}

/** A rod as a mesh: a cylinder with flat ends, `sides` around. */
export function rodMesh(rod: RodShape, sides = 10): MeshShape {
	const d = v3sub(rod.b, rod.a);
	const len = Math.hypot(d[0], d[1], d[2]);
	const m = lathe(rod.color ?? "", [[0, 0], [rod.w / 2, 0], [rod.w / 2, len], [0, len]], "y", sides);
	if (len < 1e-9) return m;
	// turn y onto the axis, then move to a
	const w = v3norm(d);
	const seed: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
	const u = v3norm(v3cross(w, seed));
	const v = v3cross(w, u);
	m.points = m.points.map((p) => round([rod.a[0] + u[0] * p[0] + w[0] * p[1] + v[0] * p[2], rod.a[1] + u[1] * p[0] + w[1] * p[1] + v[1] * p[2], rod.a[2] + u[2] * p[0] + w[2] * p[1] + v[2] * p[2]]));
	if (rod.shade !== undefined) m.shade = rod.shade;
	return windOutward(m);
}

/** A shape as a mesh: itself, or its ball or rod tessellated. */
export function asMesh(sh: Shape3): MeshShape {
	if (sh.kind === "mesh") return sh;
	return sh.kind === "ball" ? ballMesh(sh) : rodMesh(sh);
}

/** What a renderer uploads: flat triangles with one normal per face, and the token and shade to paint them. */
export interface TriMesh {
	color?: string;
	shade?: number;
	/** x, y, z per vertex, three vertices per triangle */
	positions: Float32Array;
	/** one normal per vertex, the face's, unit length */
	normals: Float32Array;
	/** triangles */
	count: number;
}

/** Flatten one shape. Meshes use their baked tris when they have them. */
export function triMesh(sh: Shape3): TriMesh {
	const m = asMesh(sh);
	let tris = m.tris;
	if (!tris || tris.length % 3 !== 0 || tris.some((i) => i >= m.points.length)) {
		tris = [];
		for (const f of m.faces) tris.push(...triangulateFace(m.points, f));
	}
	const count = tris.length / 3;
	const positions = new Float32Array(count * 9);
	const normals = new Float32Array(count * 9);
	for (let t = 0; t < count; t++) {
		const a = m.points[tris[t * 3]];
		const b = m.points[tris[t * 3 + 1]];
		const c = m.points[tris[t * 3 + 2]];
		const n = v3norm(v3cross(v3sub(b, a), v3sub(c, a)));
		[a, b, c].forEach((p, k) => {
			positions.set(p, t * 9 + k * 3);
			normals.set(n, t * 9 + k * 3);
		});
	}
	return { color: sh.color, shade: sh.shade, positions, normals, count };
}

/** Every shape of a part (through `like`), flattened. */
export function flattenPart(doc: Doc3, part: Part3): TriMesh[] {
	return shapesOf3(doc, part).map(triMesh);
}

/** The outward normal of a mesh face, unit length. */
export function faceUnitNormal(mesh: MeshShape, face: number): Vec3 {
	return v3norm(faceNormal(mesh.points, mesh.faces[face]));
}

/**
 * The format is y-down, z-away (right-handed). Most engines are y-up,
 * z-toward-the-viewer (right-handed too): the same frame turned half a
 * turn about x. Lay this on a world map, or on points, to get there.
 */
export const Y_UP: Xf3 = [1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0];
export function yUp(p: Vec3): Vec3 {
	return [p[0], -p[1], -p[2]];
}
