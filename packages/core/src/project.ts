// Projection (1.3): a 3D document to a 2D one, by the rules in
// spec/PROJECT.md. A view turn is laid on the model, z is dropped, faces
// that face the viewer become polys with a shade, and every pose is
// either an exact 2D pose (a turn about the view axis) or a baked
// variant part. States and clips come through; spans that need it are
// subdivided at a frame rate.

import type { Anchor, Anchor3, Clip, Clip3, ClipKey, ClipKey3, Doc, Doc3, Part, Part3, Shape, Shape3, State, StatePart, StatePart3, Vec2, Vec3 } from "./types.ts";
import { triangulate, xfApply, xfFlipped, xfInvert, xfMul, type Xf } from "./geometry.ts";
import { affineFrom, meshUVs } from "./textures.ts";
import { solveTargets3 } from "./ik3.ts";
import {
	anchorsOf3,
	keyPoses3,
	keyTargets3,
	pivotOf3,
	sampleClip3,
	sampleTargets3,
	shapesOf3,
	turnXf3,
	v3dot,
	v3norm,
	worldTransforms3,
	xf3Apply,
	xf3ApplyDir,
	xf3Det,
	xf3Mul,
	xf3Scale,
	type Xf3,
} from "./space3.ts";

/** The named views: turns laid on the model before z is dropped. */
export const VIEWS: Record<string, Vec3> = {
	front: [0, 0, 0],
	back: [0, Math.PI, 0],
	right: [0, Math.PI / 2, 0],
	left: [0, -Math.PI / 2, 0],
	side: [0, Math.PI / 2, 0],
	top: [Math.PI / 2, 0, Math.PI],
	bottom: [-Math.PI / 2, 0, 0],
};

export interface ProjectOptions {
	/** A named view or a turn [x, y, z] in radians. Default front. */
	view?: string | Vec3;
	/** Toward the light, in view space. Default [-1, -2, -3]. */
	light?: Vec3;
	/** 0..1, default 0.4. */
	ambient?: number;
	/** Samples per second for spans that must be baked. Default 12. */
	fps?: number;
	/** Silhouette edges as lines in this token, this wide. */
	outline?: { color: string; w: number };
	/** Recorded in meta.projected.from: where the source is, relative to the output. */
	from?: string;
	/** projectFrame only: a map laid in front of every part's world map (a scene placing this document) */
	instance?: Xf3;
}

export const DEFAULT_LIGHT: Vec3 = [-1, -2, -3];
export const DEFAULT_AMBIENT = 0.4;
export const DEFAULT_FPS = 12;
const EPS = 1e-3;

export function viewTurn(view: string | Vec3 | undefined): Vec3 {
	if (view === undefined) return [0, 0, 0];
	if (typeof view === "string") {
		const t = VIEWS[view];
		if (!t) throw new Error(`unknown view "${view}" (one of ${Object.keys(VIEWS).join(", ")}, or [x, y, z])`);
		return t;
	}
	return view;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0; // +0 turns -0 into 0
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const flat = (p: Vec3): Vec2 => [r3(p[0]), r3(p[1])];

/** One 2D shape of a projected frame, and where it came from. */
export interface FrameShape {
	shape: Shape;
	/** index of the source shape in the part's (or its like's) shapes */
	src: number;
	/** the face, for a mesh */
	face?: number;
	/** view-space depth of its centre */
	depth: number;
	/** an outline line, not a face */
	outline?: boolean;
}

interface Projected {
	shapes: FrameShape[];
	/** mean depth of what is visible; null when nothing is */
	depth: number | null;
}

interface RestPart {
	part: Part3;
	/** geometry in view space (the view turn applied), through `like` */
	shapes: Shape3[];
	/** the same shapes as authored, for pattern coordinates */
	raw: Shape3[];
	anchors: Anchor3[];
	pivot: Vec3;
}

/** A part as it stands in one projected frame: the maps an editor needs, and its 2D shapes. */
export interface FramePart {
	part: Part3;
	/** index in the document's parts */
	index: number;
	/** rest space to view space: V · W(part). Points, handles and drags go through this. */
	F: Xf3;
	/** the pose in view space: V · W · V⁻¹; in-plane when it is a turn about the view axis */
	M: Xf3;
	inPlane: boolean;
	/** the projected pivot */
	pivot: Vec2;
	depth: number | null;
	shapes: FrameShape[];
}

/** The view turn as a map (no translation). */
export function viewXf3(view: string | Vec3 | undefined): Xf3 {
	return turnXf3(viewTurn(view));
}

const IDENT3: Xf3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/**
 * One frame of a 3D document as 2D shapes: every listed part under the
 * pose list (or every part at rest), in painter's order (far first),
 * each with its maps. What an editor draws and picks; projectDoc builds
 * whole files from the same pieces.
 */
export function projectFrame(src: Doc3, poses: readonly StatePart3[] | undefined, opts: ProjectOptions = {}): FramePart[] {
	const V = viewXf3(opts.view);
	const Vinv = transpose3(V);
	const light = v3norm(opts.light ?? DEFAULT_LIGHT);
	const ambient = Math.min(1, Math.max(0, opts.ambient ?? DEFAULT_AMBIENT));
	const parts = src.parts ?? [];
	const rest = restParts(src, V);
	const list: readonly StatePart3[] = poses ?? parts.map((p) => ({ part: p.name }));
	const W = worldTransforms3(src, poses ?? []);
	const out: FramePart[] = [];
	for (const sp of list) {
		const rp = rest.get(sp.part);
		const index = parts.findIndex((p) => p.name === sp.part);
		if (!rp || index < 0) continue;
		const w = opts.instance ? xf3Mul(opts.instance, W.get(sp.part) ?? IDENT3) : (W.get(sp.part) ?? IDENT3);
		const M = xf3Mul(V, xf3Mul(w, Vinv));
		const F = xf3Mul(V, w);
		const { shapes, depth } = projectShapes(rp, M, light, ambient, opts.outline);
		out.push({ part: rp.part, index, F, M, inPlane: inPlane(M), pivot: flat(xf3Apply(M, rp.pivot)), depth, shapes });
	}
	const drawn = out.filter((e) => e.depth !== null).sort((p, q) => q.depth! - p.depth!);
	return [...drawn, ...out.filter((e) => e.depth === null)];
}

function transpose3(V: Xf3): Xf3 {
	const T = IDENT3.slice() as Xf3;
	for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[r * 3 + c] = V[c * 3 + r];
	return T;
}

/** Every part's geometry in view space (the view turn applied), through `like`. */
function restParts(src: Doc3, V: Xf3): Map<string, RestPart> {
	const rest = new Map<string, RestPart>();
	for (const part of src.parts ?? []) {
		const move = (p: Vec3) => xf3Apply(V, p);
		const shapes: Shape3[] = shapesOf3(src, part).map((sh) => {
			if (sh.kind === "mesh") return { ...sh, points: sh.points.map(move) };
			if (sh.kind === "ball") return { ...sh, at: move(sh.at) };
			return { ...sh, a: move(sh.a), b: move(sh.b) };
		});
		const anchors: Anchor3[] = anchorsOf3(src, part).map((a) => ({ ...a, at: move(a.at), ...(a.dir ? { dir: xf3ApplyDir(V, a.dir) } : {}) }));
		rest.set(part.name, { part, shapes, raw: shapesOf3(src, part), anchors, pivot: move(pivotOf3(part)) });
	}
	return rest;
}

/**
 * The 2D shapes of a part's view-space geometry under a map M: faces that
 * face the viewer, far to near, shaded by the light; then outline lines.
 */
function projectShapes(rest: RestPart, M: Xf3, light: Vec3, ambient: number, outline: ProjectOptions["outline"]): Projected {
	const flip = xf3Det(M) < 0;
	const s = xf3Scale(M);
	const items: FrameShape[] = [];
	const lines: FrameShape[] = [];
	const shadeOf = (n: Vec3, base: number | undefined): number => {
		const lit = Math.max(0, v3dot(v3norm(n), light));
		return r2((ambient + (1 - ambient) * lit) * (base ?? 1));
	};
	rest.shapes.forEach((sh, si) => {
		if (sh.kind === "mesh") {
			const pts = sh.points.map((p) => xf3Apply(M, p));
			const uvs = sh.texture ? meshUVs(rest.raw[si]) : undefined;
			const visible: boolean[] = [];
			sh.faces.forEach((face, fi) => {
				if (face.length < 3 || face.some((i) => i >= pts.length)) {
					visible[fi] = false;
					return;
				}
				// the normal from the moved points; a mirror reverses the winding
				let n: Vec3 = [0, 0, 0];
				for (let i = 0; i < face.length; i++) {
					const a = pts[face[i]];
					const b = pts[face[(i + 1) % face.length]];
					n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
				}
				if (flip) n = [-n[0], -n[1], -n[2]];
				const vis = n[2] < -1e-9;
				visible[fi] = vis;
				if (!vis) return;
				const points = face.map((i) => flat(pts[i]));
				const depth = face.reduce((acc, i) => acc + pts[i][2], 0) / face.length;
				const poly: Shape = { kind: "poly", color: sh.color, shade: shadeOf(n, sh.shade), points, tris: triangulate(points) };
				if (sh.texture && uvs) {
					// the pattern's affine onto the projected face, from three corners that are not collinear
					const xf = affineFrom(uvs[fi].slice(0, 3), points.slice(0, 3)) ?? affineFrom([uvs[fi][0], uvs[fi][1], uvs[fi][uvs[fi].length - 1]], [points[0], points[1], points[points.length - 1]]);
					poly.texture = sh.texture;
					if (xf) poly.mapping = { xf };
				}
				items.push({ depth, shape: poly, src: si, face: fi });
			});
			if (outline) {
				// an edge with exactly one face turned to the viewer is a silhouette
				const edges = new Map<string, { a: number; b: number; faces: number; vis: number }>();
				sh.faces.forEach((face, fi) => {
					for (let i = 0; i < face.length; i++) {
						const a = face[i];
						const b = face[(i + 1) % face.length];
						const key = a < b ? `${a}:${b}` : `${b}:${a}`;
						const e = edges.get(key) ?? { a, b, faces: 0, vis: 0 };
						e.faces++;
						if (visible[fi]) e.vis++;
						edges.set(key, e);
					}
				});
				for (const e of edges.values()) {
					if (e.vis !== 1) continue;
					if (e.a >= pts.length || e.b >= pts.length) continue;
					lines.push({ shape: { kind: "line", color: outline.color, a: flat(pts[e.a]), b: flat(pts[e.b]), w: r3(outline.w) }, src: si, depth: (pts[e.a][2] + pts[e.b][2]) / 2 - 1e-3, outline: true });
				}
			}
		} else if (sh.kind === "ball") {
			const at = xf3Apply(M, sh.at);
			items.push({ depth: at[2] - sh.r * s, shape: { kind: "circle", color: sh.color, shade: shadeOf([0, 0, -1], sh.shade), at: flat(at), r: r3(sh.r * s) }, src: si });
		} else if (sh.kind === "rod") {
			const a = xf3Apply(M, sh.a);
			const b = xf3Apply(M, sh.b);
			items.push({ depth: (a[2] + b[2]) / 2 - (sh.w * s) / 2, shape: { kind: "line", color: sh.color, shade: shadeOf([0, 0, -1], sh.shade), a: flat(a), b: flat(b), w: r3(sh.w * s) }, src: si });
		}
	});
	items.sort((p, q) => q.depth - p.depth); // far first
	const depth = items.length ? items.reduce((acc, it) => acc + it.depth, 0) / items.length : null;
	return { shapes: [...items, ...lines], depth };
}

function projectAnchors(anchors: Anchor3[], M: Xf3): Anchor[] {
	return anchors.map((a) => {
		const out: Anchor = { name: a.name, at: flat(xf3Apply(M, a.at)) };
		if (a.dir) {
			const d = xf3ApplyDir(M, a.dir);
			if (Math.hypot(d[0], d[1]) > 1e-6) out.angle = r3(Math.atan2(d[1], d[0]));
		}
		return out;
	});
}

/** Is the map's image independent of rest depth: a turn about the view axis, a scale, a mirror, a move? */
function inPlane(M: Xf3): boolean {
	const s = xf3Scale(M) || 1;
	return Math.abs(M[2]) <= EPS * s && Math.abs(M[5]) <= EPS * s;
}

/** The 2D similarity an in-plane map is, canvas convention. */
function plane2d(M: Xf3): Xf {
	return [M[0], M[3], M[1], M[4], M[9], M[10]];
}

/** A 2D pose entry from a local 2D map and the part's 2D pivot. */
function poseEntry(name: string, L: Xf, pivot: Vec2): StatePart {
	const offset = xfApply(L, pivot);
	const mirror = xfFlipped(L);
	const a = mirror ? -L[0] : L[0];
	const b = mirror ? -L[1] : L[1];
	const rotate = Math.atan2(b, a);
	const scale = Math.hypot(a, b);
	const out: StatePart = { part: name, offset: [r3(offset[0]), r3(offset[1])] };
	if (Math.abs(rotate) > 1e-9) out.rotate = r3(rotate);
	if (Math.abs(scale - 1) > 1e-9) out.scale = r3(scale);
	if (mirror) out.mirror = true;
	return out;
}

/** Project a 3D document to a 2D one. */
export function projectDoc(src: Doc3, opts: ProjectOptions = {}): Doc {
	const turn = viewTurn(opts.view);
	const V = turnXf3(turn);
	const Vinv = transpose3(V); // a turn's inverse is its transpose
	const light = v3norm(opts.light ?? DEFAULT_LIGHT);
	const ambient = Math.min(1, Math.max(0, opts.ambient ?? DEFAULT_AMBIENT));
	const fps = opts.fps && opts.fps > 0 ? opts.fps : DEFAULT_FPS;
	const outline = opts.outline;

	const parts = src.parts ?? [];
	const rest = restParts(src, V);
	/** every part's map in view space under a pose list: V · W · V⁻¹ */
	const viewMaps = (poses: readonly StatePart3[]): Map<string, Xf3> => {
		const W = worldTransforms3(src, poses);
		const out = new Map<string, Xf3>();
		for (const [name, w] of W) out.set(name, xf3Mul(V, xf3Mul(w, Vinv)));
		return out;
	};

	// every pose the document has, sub-samples included: the parents that
	// stay in-plane through all of them keep their children in 2D
	const allPoses: (readonly StatePart3[])[] = [];
	for (const st of src.states ?? []) allPoses.push(st.parts);
	const sampleTimes = (clip: Clip3, i: number): number[] => {
		const A = clip.keys[i];
		const B = clip.keys[i + 1];
		const span = B.t - A.t;
		const n = Math.max(1, Math.ceil(span * fps));
		const out: number[] = [];
		for (let k = 1; k < n; k++) out.push(A.t + (span * k) / n);
		return out;
	};
	/** the frame at t, with its targets reached */
	const frameAt = (clip: Clip3, t: number): StatePart3[] => {
		const poses = sampleClip3(src, clip, t);
		const tg = sampleTargets3(src, clip, t);
		if (tg.length) solveTargets3(src, poses, tg);
		return poses;
	};
	/** a key's poses, with its targets reached */
	const keyFrame = (clip: Clip3, k: ClipKey3): StatePart3[] => {
		const poses = keyPoses3(src, k).map((sp) => ({ ...sp }));
		const tg = keyTargets3(src, k);
		if (tg.length) solveTargets3(src, poses, tg);
		return poses;
	};
	for (const clip of src.clips ?? []) {
		for (let i = 0; i < clip.keys.length; i++) {
			allPoses.push(keyFrame(clip, clip.keys[i]));
			if (i + 1 < clip.keys.length) for (const t of sampleTimes(clip, i)) allPoses.push(frameAt(clip, t));
		}
	}
	const alwaysInPlane = new Map<string, boolean>(parts.map((p) => [p.name, true]));
	for (const poses of allPoses) {
		for (const [name, M] of viewMaps(poses)) if (!inPlane(M)) alwaysInPlane.set(name, false);
	}
	const keepParent = (part: Part3): boolean => !!part.parent && rest.has(part.parent) && alwaysInPlane.get(part.parent) === true;

	// the 2D rest parts: every source part, projected as authored
	const out2d: Part[] = [];
	for (const part of parts) {
		const rp = rest.get(part.name)!;
		const p2: Part = { name: part.name };
		if (keepParent(part)) p2.parent = part.parent;
		p2.pivot = flat(rp.pivot);
		if (part.like && rest.has(part.like)) p2.like = part.like;
		else {
			const { shapes } = projectShapes(rp, IDENT3, light, ambient, outline);
			p2.shapes = shapes.map((f) => f.shape);
			const anchors = projectAnchors(rp.anchors, IDENT3);
			if (anchors.length) p2.anchors = anchors;
		}
		if (part.meta) p2.meta = part.meta;
		out2d.push(p2);
	}

	// variants: baked poses, shared by map
	const variants = new Map<string, string>();
	const variantParts: Part[] = [];
	const counts = new Map<string, number>();
	const variantFor = (rp: RestPart, M: Xf3): string => {
		const key = `${rp.part.name}|${M.map((x) => Math.round(x * 1000)).join(",")}`;
		const have = variants.get(key);
		if (have) return have;
		const n = (counts.get(rp.part.name) ?? 0) + 1;
		counts.set(rp.part.name, n);
		const name = `${rp.part.name}@${n}`;
		const { shapes } = projectShapes(rp, M, light, ambient, outline);
		const vp: Part = { name, pivot: flat(xf3Apply(M, rp.pivot)), shapes: shapes.map((f) => f.shape) };
		const anchors = projectAnchors(rp.anchors, M);
		if (anchors.length) vp.anchors = anchors;
		variantParts.push(vp);
		variants.set(key, name);
		return name;
	};

	interface Emitted {
		parts: StatePart[];
		baked: boolean;
		order: string;
	}
	/** A 3D pose list as a 2D one: exact poses where the turn allows, variants elsewhere, painter's order. */
	const emit = (poses: readonly StatePart3[]): Emitted => {
		const maps = viewMaps(poses);
		const entries: { depth: number | null; sp: StatePart; baked: boolean }[] = [];
		for (const sp of poses) {
			const rp = rest.get(sp.part);
			if (!rp) continue;
			const M = maps.get(sp.part)!;
			const { depth } = projectShapes(rp, M, light, ambient, undefined);
			if (inPlane(M)) {
				let L = plane2d(M);
				if (keepParent(rp.part)) L = xfMul(xfInvert(plane2d(maps.get(rp.part.parent!)!)), L);
				entries.push({ depth, sp: poseEntry(sp.part, L, flat(rp.pivot)), baked: false });
			} else {
				entries.push({ depth, sp: { part: variantFor(rp, M) }, baked: true });
			}
		}
		// far first; parts drawing nothing keep their place at the end
		const drawn = entries.filter((e) => e.depth !== null).sort((p, q) => q.depth! - p.depth!);
		const empty = entries.filter((e) => e.depth === null);
		const all = [...drawn, ...empty];
		return { parts: all.map((e) => e.sp), baked: all.some((e) => e.baked), order: all.map((e) => e.sp.part).join("\n") };
	};

	const states: State[] = (src.states ?? []).map((st) => {
		const poses = st.parts.map((sp) => ({ ...sp }));
		if (st.targets?.length) solveTargets3(src, poses, st.targets);
		return { name: st.name, parts: emit(poses).parts };
	});

	const clips: Clip[] = (src.clips ?? []).map((clip) => {
		const keys: ClipKey[] = [];
		for (let i = 0; i < clip.keys.length; i++) {
			const k = clip.keys[i];
			const here = emit(keyFrame(clip, k));
			const key: ClipKey = { t: k.t };
			if (k.state !== undefined) key.state = k.state;
			else key.parts = here.parts;
			if (k.ease) key.ease = k.ease;
			if (k.curve) key.curve = k.curve;
			if (k.events) key.events = k.events;
			// does the span into this key need sub-keys?
			if (i > 0) {
				const prev = emit(keyFrame(clip, clip.keys[i - 1]));
				const times = sampleTimes(clip, i - 1);
				const samples = times.map((t) => ({ t, e: emit(frameAt(clip, t)) }));
				const needs = here.baked || prev.baked || samples.some((s) => s.e.baked || s.e.order !== prev.order) || here.order !== prev.order;
				if (needs) {
					for (const s of samples) keys.push({ t: r3(s.t), parts: s.e.parts });
					delete key.ease;
					delete key.curve;
				}
			}
			keys.push(key);
		}
		const c: Clip = { name: clip.name, keys };
		if (clip.loop) c.loop = true;
		return c;
	});

	const doc: Doc = { version: 1 };
	if (src.name !== undefined) doc.name = src.name;
	if (src.palette_refs) doc.palette_refs = [...src.palette_refs];
	if (src.palette) doc.palette = src.palette.map((t) => ({ ...t }));
	if (src.textures) doc.textures = JSON.parse(JSON.stringify(src.textures));
	doc.parts = [...out2d, ...variantParts];
	if (src.states) doc.states = states;
	if (src.clips) doc.clips = clips;
	const projected: Record<string, unknown> = {
		view: typeof opts.view === "string" ? opts.view : turn.map(r3),
		light: light.map(r3),
		ambient,
		fps,
	};
	if (opts.from !== undefined) projected.from = opts.from;
	if (outline) projected.outline = { ...outline };
	doc.meta = { ...(src.meta ?? {}), projected };
	return doc;
}
