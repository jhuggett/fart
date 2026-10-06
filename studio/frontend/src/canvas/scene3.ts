// The scene canvas: every instance drawn where the scene puts it (the 2D
// painter for a 2D scene, the WebGL solids for a 3D one), the chosen
// node outlined, a drag moving a node along the canvas (or the view
// plane), a drag on nothing orbiting a 3D scene.

import { docBounds, drawList, projectFrame, shapeDistance, shapesOfPosed, viewXf3, xfApply, xfInvert, xfScale, xf3Apply, xf3ApplyDir, xf3Invert, dist, type Doc, type Doc3, type Placed, type StatePart, type StatePart3, type Vec2, type Vec3, type Xf, type Xf3, type FramePart, xf3Scale } from "@fastart/core";
import { view } from "./view.ts";
import { drawDoc, fillShape, tracePoly } from "./draw.ts";
import { drawGrid, patternsOf } from "./render.ts";
import { canvasColors } from "../state/theme.ts";
import { partMesh, poseParts, type PosedPart, type SolidLayer } from "./gl3.ts";
import { sc, flattened, is3d, docPathOf, nudgeNode, orbit, endGesture, selectedNodes, selectNodes } from "../state/scene.ts";
import { gizmoDown, gizmoMove, gizmoUp, gizmoActive, gizmoHover, drawGizmo } from "./gizmo3.ts";
import { nodeOrigin } from "./sceneGizmo.ts";

export const sx = {
	down: false,
	cursor: null as Vec2 | null,
	dragging: false,
	dragLast: [0, 0] as Vec2,
	orbiting: false,
	orbitLast: [0, 0] as Vec2,
	marquee: false,
	marqueeA: [0, 0] as Vec2,
};
const z = () => view.zoom.value;
const px = (n: number) => n / z();

/** A placed 3D instance projected under the view, cached per frame. */
let projCache: { key: string; parts: Map<string, FramePart[]> } | null = null;
function projected(): Map<string, FramePart[]> {
	const { placed } = flattened();
	const key = `${sc.rev.value}|${sc.time.value}|${sc.turn.value.join(",")}|${placed.length}`;
	if (projCache && projCache.key === key) return projCache.parts;
	const out = new Map<string, FramePart[]>();
	for (const p of placed) out.set(p.path, projectFrame(p.doc as Doc3, p.poses as StatePart3[] | undefined, { view: sc.turn.value, light: sc.light.value, ambient: sc.ambient.value, instance: p.xf as Xf3 }));
	projCache = { key, parts: out };
	return out;
}

/**
 * Every instance's parts in the world, with nothing projected and no
 * view laid on: what the WebGL layer draws. It changes only when the
 * scene or its clock does, so orbiting, panning and zooming reuse it.
 */
let poseCache: { key: string; parts: Map<string, PosedPart[]> } | null = null;
function posed(): Map<string, PosedPart[]> {
	const { placed } = flattened();
	const key = `${sc.rev.value}|${sc.time.value}|${placed.length}`;
	if (poseCache && poseCache.key === key) return poseCache.parts;
	const out = new Map<string, PosedPart[]>();
	for (const p of placed) out.set(p.path, poseParts(p.doc as Doc3, p.poses as StatePart3[] | undefined, p.xf as Xf3));
	poseCache = { key, parts: out };
	return out;
}

/** One instance projected under the view (for picking and outlines), worked out when it is first asked for. */
let lazyProj: { key: string; parts: Map<string, FramePart[]> } | null = null;
function projectedOf(p: Placed): FramePart[] {
	const key = `${sc.rev.value}|${sc.time.value}|${sc.turn.value.join(",")}`;
	if (!lazyProj || lazyProj.key !== key) lazyProj = { key, parts: new Map() };
	let fps = lazyProj.parts.get(p.path);
	if (!fps) {
		fps = projectFrame(p.doc as Doc3, p.poses as StatePart3[] | undefined, { view: sc.turn.value, light: sc.light.value, ambient: sc.ambient.value, instance: p.xf as Xf3 });
		lazyProj.parts.set(p.path, fps);
	}
	return fps;
}

/**
 * Where each instance is on the canvas, roughly: a circle that holds each
 * of its parts (the part's own sphere, through its map and the view).
 * Cheap enough for every instance of a big scene on every view.
 */
let reachCache: { key: string; list: { path: string; at: Vec2; r: number }[] } | null = null;
function reach(): { path: string; at: Vec2; r: number }[] {
	const { placed } = flattened();
	const key = `${sc.rev.value}|${sc.time.value}|${sc.turn.value.join(",")}|${placed.length}`;
	if (reachCache && reachCache.key === key) return reachCache.list;
	const V = viewXf3(sc.turn.value);
	const list: { path: string; at: Vec2; r: number }[] = [];
	const all = posed();
	for (const p of placed) {
		for (const fp of all.get(p.path) ?? []) {
			const m = partMesh(fp.solids, p.tokens, sc.patterns.value.get(docPathOf(p)));
			if (!m.radius) continue;
			const c = xf3Apply(V, xf3Apply(fp.F, m.centre));
			list.push({ path: p.path, at: [c[0], c[1]], r: m.radius * xf3Scale(fp.F) });
		}
	}
	reachCache = { key, list };
	return list;
}

/** What the WebGL layer draws for a 3D scene. */
export function sceneLayers(): SolidLayer[] {
	const { placed } = flattened();
	const all = posed();
	return placed.map((p) => ({ fps: all.get(p.path) ?? [], tokens: p.tokens, patterns: sc.patterns.value.get(docPathOf(p)) }));
}

/** The canvas-space outline of an instance: its bounds through its map (2D), or its projected shapes' bounds (3D). */
function outlineOf(p: Placed): Vec2[] | null {
	if (is3d()) {
		const fps = projectedOf(p);
		let lo: Vec2 = [Infinity, Infinity];
		let hi: Vec2 = [-Infinity, -Infinity];
		for (const fp of fps) for (const f of fp.shapes) {
			const sh = f.shape;
			const pts: Vec2[] = sh.kind === "poly" ? sh.points : sh.kind === "circle" ? [[sh.at[0] - sh.r, sh.at[1] - sh.r], [sh.at[0] + sh.r, sh.at[1] + sh.r]] : sh.kind === "line" ? [sh.a, sh.b] : [];
			for (const q of pts) {
				lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
				hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
			}
		}
		if (!Number.isFinite(lo[0])) return null;
		return [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]];
	}
	const b = docBounds(p.doc as Doc);
	if (!b) return null;
	const X = p.xf as Xf;
	return [xfApply(X, b.lo), xfApply(X, [b.hi[0], b.lo[1]]), xfApply(X, b.hi), xfApply(X, [b.lo[0], b.hi[1]])];
}

/** The node under a canvas point: the topmost instance whose art is under it. */
export function pick(wm: Vec2): string | null {
	const { placed } = flattened();
	const tol = px(4);
	if (is3d()) {
		let best: { depth: number; path: string } | null = null;
		const near = new Set(reach().filter((r) => Math.hypot(r.at[0] - wm[0], r.at[1] - wm[1]) <= r.r + tol).map((r) => r.path));
		for (const p of placed) {
			// only what the pointer could be over is projected: the rest of a big scene is never touched
			if (!near.has(p.path)) continue;
			for (const fp of projectedOf(p)) for (const f of fp.shapes) {
				if (f.outline || shapeDistance(f.shape, wm) > tol) continue;
				if (!best || f.depth < best.depth) best = { depth: f.depth, path: p.path };
			}
		}
		return best?.path ?? null;
	}
	for (let i = placed.length - 1; i >= 0; i--) {
		const p = placed[i];
		const X = p.xf as Xf;
		const local = xfApply(xfInvert(X), wm);
		const s = xfScale(X) || 1;
		for (const e of drawList(p.doc as Doc, p.poses as StatePart[] | undefined).reverse()) {
			const q = xfApply(xfInvert(e.xf), local);
			for (const sh of shapesOfPosed(p.doc as Doc, e.part, e.sp)) if (shapeDistance(sh, q) <= tol / s / (e.scale || 1)) return p.path;
		}
	}
	return null;
}

/** The extents of everything drawn, for zoom to fit. */
export function frameBounds(): { lo: Vec2; hi: Vec2 } | null {
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	if (is3d()) {
		for (const r of reach()) {
			lo = [Math.min(lo[0], r.at[0] - r.r), Math.min(lo[1], r.at[1] - r.r)];
			hi = [Math.max(hi[0], r.at[0] + r.r), Math.max(hi[1], r.at[1] + r.r)];
		}
		return Number.isFinite(lo[0]) ? { lo, hi } : null;
	}
	for (const p of flattened().placed) {
		for (const q of outlineOf(p) ?? []) {
			lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
			hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
		}
	}
	return Number.isFinite(lo[0]) ? { lo, hi } : null;
}

// ------------------------------------------------------------- pointer

export function onDown(wm: Vec2, mods: { shift: boolean; alt: boolean }) {
	sx.down = true;
	sx.cursor = wm;
	// a handle grabbed, or a keyed transform kept by the click
	if (gizmoDown(wm)) return;
	const hit = pick(wm);
	if (hit) {
		// a nested scene's node cannot be edited here: select its top-level ancestor
		const path = editablePath(hit);
		const all = selectedNodes();
		const member = all.includes(path);
		// ⇧ adds a node to what is chosen, or takes it out; a plain click on one of several keeps them all, to drag together
		if (mods.shift && all.length) selectNodes(member ? all.filter((p) => p !== path) : [path, ...all]);
		else if (member) selectNodes([path, ...all.filter((p) => p !== path)]);
		else selectNodes([path]);
		if (mods.shift && member) return;
		sx.dragging = true;
		sx.dragLast = wm;
		return;
	}
	if (!mods.shift) selectNodes([]);
	// a drag on nothing is a marquee (the middle button, two fingers or Alt-drag orbit a 3D scene)
	sx.marquee = true;
	sx.marqueeA = wm;
}

/** Every editable node whose outline on the canvas touches a rectangle. */
function nodesIn(lo: Vec2, hi: Vec2): string[] {
	const out = new Set<string>();
	for (const p of flattened().placed) {
		const o = outlineOf(p);
		if (!o?.length) continue;
		const blo: Vec2 = [Math.min(...o.map((q) => q[0])), Math.min(...o.map((q) => q[1]))];
		const bhi: Vec2 = [Math.max(...o.map((q) => q[0])), Math.max(...o.map((q) => q[1]))];
		if (blo[0] <= hi[0] && bhi[0] >= lo[0] && blo[1] <= hi[1] && bhi[1] >= lo[1]) out.add(editablePath(p.path));
	}
	return [...out];
}

/** The canvas bounds of the chosen nodes; of the whole scene when none is. */
export function chosenBounds(): { lo: Vec2; hi: Vec2 } | null {
	const chosen = selectedNodes();
	if (!chosen.length) return frameBounds();
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	for (const p of flattened().placed) {
		if (!chosen.some((c) => p.path === c || p.path.startsWith(c + "/"))) continue;
		for (const q of outlineOf(p) ?? []) {
			lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
			hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
		}
	}
	return Number.isFinite(lo[0]) ? { lo, hi } : frameBounds();
}

// what the view turns about: the middle of the scene as it is drawn,
// fixed in the world for as long as one orbit lasts
let pivot: Vec3 | null = null;
let pivotAt = 0;
export function orbitStart() {
	pivot = null;
}
/** Orbit a 3D scene by a pointer movement in pixels; its middle stays where it is on the canvas. */
export function orbitDrag(dxPx: number, dyPx: number, free = false) {
	if (!is3d()) return;
	const V = () => viewXf3(sc.turn.value);
	const now = performance.now();
	if (!pivot || now - pivotAt > 350) {
		// about the chosen nodes' own origins (true points in the world); else the middle of the scene as drawn
		const chosen = selectedNodes().map((p) => nodeOrigin(p)?.world).filter((w): w is Vec3 => !!w);
		const b = frameBounds();
		if (chosen.length) pivot = [chosen.reduce((s, w) => s + w[0], 0) / chosen.length, chosen.reduce((s, w) => s + w[1], 0) / chosen.length, chosen.reduce((s, w) => s + w[2], 0) / chosen.length];
		else pivot = b ? xf3Apply(xf3Invert(V()), [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, 0]) : [0, 0, 0];
	}
	pivotAt = now;
	const before = xf3Apply(V(), pivot);
	orbit(-dxPx * 0.008, dyPx * 0.008, free);
	const after = xf3Apply(V(), pivot);
	const [px, py] = view.pan.value;
	view.pan.value = [px + after[0] - before[0], py + after[1] - before[1]];
}
/** The path of the node this scene edits: an instance inside a placed scene belongs to that scene's node. */
function editablePath(path: string): string {
	const names = path.split("/");
	let nodes = sc.scene.value.nodes ?? [];
	const out: string[] = [];
	for (const name of names) {
		const n = nodes.find((x) => x.name === name);
		if (!n) break;
		out.push(name);
		if (n.ref?.endsWith(".shart")) break;
		nodes = n.children ?? [];
	}
	return out.join("/");
}
export function onMove(wm: Vec2, mods: { shift: boolean; alt: boolean }) {
	if (gizmoActive()) {
		sx.cursor = wm;
		gizmoMove(wm, !!mods?.shift);
		return;
	}
	if (!sx.down) gizmoHover(wm);
	void mods;
	sx.cursor = wm;
	if (!sx.down) {
		const h = pick(wm);
		const e = h ? editablePath(h) : null;
		if (e !== sc.hover.value) sc.hover.value = e;
		return;
	}
	if (sx.marquee) return;
	if (sx.orbiting) {
		const pan0 = view.pan.value;
		orbitDrag((wm[0] - sx.orbitLast[0]) * z(), (wm[1] - sx.orbitLast[1]) * z());
		// the pointer has not moved on the screen, but the world slid under it with the pan
		sx.orbitLast = [wm[0] + view.pan.value[0] - pan0[0], wm[1] + view.pan.value[1] - pan0[1]];
		return;
	}
	if (sx.dragging && sc.sel.value) {
		const d: Vec2 = [wm[0] - sx.dragLast[0], wm[1] - sx.dragLast[1]];
		sx.dragLast = wm;
		// a view-plane displacement, back in the world's frame; every chosen node goes
		const dw = is3d() ? xf3ApplyDir(xf3Invert(viewXf3(sc.turn.value)), [d[0], d[1], 0]) : d;
		for (const p of movable()) nudgeNode(p, dw);
	}
}
/** The chosen nodes that are not inside another chosen one: moving the outer one already moves them. */
function movable(): string[] {
	const all = selectedNodes();
	return all.filter((p) => !all.some((q) => q !== p && p.startsWith(q + "/")));
}
export function onUp(wm?: Vec2, shift = false) {
	sx.down = false;
	const g = gizmoUp();
	if (g === "click" && wm) {
		// a click on a handle, not a drag: the node under it is what was meant
		const hit = pick(wm);
		if (hit) selectNodes([editablePath(hit)]);
	}
	if (g) return;
	if (sx.marquee) {
		sx.marquee = false;
		const a = sx.marqueeA;
		const b = wm ?? sx.cursor ?? a;
		// a press that went nowhere was a click on nothing: it has already let go of everything
		if (Math.hypot(b[0] - a[0], b[1] - a[1]) * z() < 3) return;
		const found = nodesIn([Math.min(a[0], b[0]), Math.min(a[1], b[1])], [Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
		selectNodes(shift ? [...selectedNodes(), ...found] : found);
		return;
	}
	if (sx.dragging || sx.orbiting) endGesture();
	sx.dragging = false;
	sx.orbiting = false;
}
export function cancelGesture() {
	onUp();
}
export function nudgeSel(d: Vec2) {
	if (!sc.sel.value) return;
	const dw = is3d() ? xf3ApplyDir(xf3Invert(viewXf3(sc.turn.value)), [d[0], d[1], 0]) : d;
	for (const p of movable()) nudgeNode(p, dw, "nudge");
}

// ------------------------------------------------------------- render

export function renderSceneGround(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
	const C = canvasColors();
	const [panx, pany] = view.pan.value;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = C.bg;
	ctx.fillRect(0, 0, W, H);
	drawGrid(ctx, W, H, panx, pany, view.zoom.value, C.grid, C.gridStrong);
}

/** The overlay: in 2D the instances themselves, then outlines, origins, the axes. `paint3d` paints a 3D scene here when WebGL is missing. */
export function renderScene(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, paint3d = false) {
	const C = canvasColors();
	const [panx, pany] = view.pan.value;
	const zoom = view.zoom.value;
	const world = () => ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (W / 2 - panx * zoom) * dpr, (H / 2 - pany * zoom) * dpr);
	const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const toS = (p: Vec2): Vec2 => [(p[0] - panx) * zoom + W / 2, (p[1] - pany) * zoom + H / 2];
	screen();
	ctx.clearRect(0, 0, W, H);
	const { placed, worlds } = flattened();
	if (!is3d()) {
		for (const p of placed) {
			world();
			const X = p.xf as Xf;
			ctx.transform(X[0], X[1], X[2], X[3], X[4], X[5]);
			drawDoc(ctx, p.doc as Doc, p.tokens, { pose: p.poses as StatePart[] | undefined, patterns: patternsOf(sc.patterns.value.get(docPathOf(p)) ?? new Map()) });
		}
	} else if (paint3d) {
		world();
		const proj = projected();
		const all = placed.flatMap((p) => (proj.get(p.path) ?? []).flatMap((fp) => fp.shapes.map((f) => ({ f, tokens: p.tokens })))).sort((a, b) => b.f.depth - a.f.depth);
		for (const { f, tokens } of all) {
			const tk = tokens.find((t) => t.name === f.shape.color);
			const rgb = tk ? tk.rgb : [255, 0, 255, 255];
			const k = f.shape.shade ?? 1;
			fillShape(ctx, f.shape, `rgba(${Math.min(255, rgb[0] * k)},${Math.min(255, rgb[1] * k)},${Math.min(255, rgb[2] * k)},${rgb[3] / 255})`);
		}
	}
	// the chosen node and the hovered one: their instances' outlines
	screen();
	const drawOutline = (path: string, color: string, lw: number) => {
		for (const p of placed) {
			if (p.path !== path && !p.path.startsWith(path + "/")) continue;
			const o = outlineOf(p);
			if (!o) continue;
			ctx.strokeStyle = color;
			ctx.lineWidth = lw;
			ctx.setLineDash([]);
			tracePoly(ctx, o.map(toS), (q) => q);
			ctx.stroke();
		}
	};
	if (sc.hover.value && !selectedNodes().includes(sc.hover.value)) drawOutline(sc.hover.value, C.hover, C.line);
	for (const p of sc.also.value) drawOutline(p, C.accent, 1.5 * C.line);
	if (sc.sel.value) {
		drawOutline(sc.sel.value, C.accent, 1.5 * C.line);
		// the node's origin, where its `at` lands
		const w = worlds.get(sc.sel.value);
		if (w) {
			let o: Vec2;
			if (is3d()) {
				const V = viewXf3(sc.turn.value);
				const p3 = xf3Apply(V, xf3Apply(w as Xf3, [0, 0, 0]));
				o = toS([p3[0], p3[1]]);
			} else o = toS(xfApply(w as Xf, [0, 0]));
			ctx.strokeStyle = C.accent;
			ctx.lineWidth = 1.5 * C.line;
			ctx.beginPath();
			ctx.arc(o[0], o[1], 6, 0, Math.PI * 2);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(o[0] - 9, o[1]);
			ctx.lineTo(o[0] + 9, o[1]);
			ctx.moveTo(o[0], o[1] - 9);
			ctx.lineTo(o[0], o[1] + 9);
			ctx.lineWidth = C.line;
			ctx.stroke();
		}
	}
	// the marquee: every node it touches is chosen
	if (sx.marquee && sx.cursor) {
		const a = toS(sx.marqueeA);
		const b = toS(sx.cursor);
		ctx.fillStyle = C.marquee;
		ctx.strokeStyle = C.accent;
		ctx.lineWidth = C.line;
		ctx.beginPath();
		ctx.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
		ctx.fill();
		ctx.stroke();
	}
	// the axis handles of the chosen nodes: arrows to move, rings to turn
	drawGizmo(ctx, toS);
	if (is3d()) {
		const V = viewXf3(sc.turn.value);
		const o: Vec2 = [46, H - 46];
		ctx.font = "10px system-ui, sans-serif";
		for (const [d, name, color] of [[[1, 0, 0], "x", "#d9534f"], [[0, 1, 0], "y", "#5cb85c"], [[0, 0, 1], "z", "#5b9bd5"]] as [Vec3, string, string][]) {
			const v = xf3ApplyDir(V, d);
			ctx.strokeStyle = color;
			ctx.globalAlpha = v[2] > 0 ? 0.45 : 1;
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(o[0], o[1]);
			ctx.lineTo(o[0] + v[0] * 26, o[1] + v[1] * 26);
			ctx.stroke();
			ctx.fillStyle = color;
			ctx.fillText(name, o[0] + v[0] * 32 - 3, o[1] + v[1] * 32 + 3);
			ctx.globalAlpha = 1;
		}
	}
	void dist;
}

/** A scene on the shelf: everything drawn small, fitted. */
export function drawSceneThumb(canvas: HTMLCanvasElement, layers: { placed: Placed[]; space3d: boolean }, size?: number) {
	// with a size the canvas is off screen: a square of that many pixels
	const dpr = size ? 1 : window.devicePixelRatio || 1;
	const w = size ?? canvas.clientWidth;
	const h = size ?? canvas.clientHeight;
	if (!w || !h) return;
	canvas.width = Math.round(w * dpr);
	canvas.height = Math.round(h * dpr);
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);
	// bounds from every instance
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	const items: { draw: () => void; pts: Vec2[] }[] = [];
	for (const p of layers.placed) {
		if (layers.space3d) {
			const fps = projectFrame(p.doc as Doc3, p.poses as StatePart3[] | undefined, { view: [0.35, -0.6, 0], instance: p.xf as Xf3 });
			const shapes = fps.flatMap((fp) => fp.shapes).sort((a, b) => b.depth - a.depth);
			const pts: Vec2[] = [];
			for (const f of shapes) {
				const sh = f.shape;
				if (sh.kind === "poly") pts.push(...sh.points);
				else if (sh.kind === "circle") pts.push([sh.at[0] - sh.r, sh.at[1] - sh.r], [sh.at[0] + sh.r, sh.at[1] + sh.r]);
				else if (sh.kind === "line") pts.push(sh.a, sh.b);
			}
			items.push({
				pts,
				draw: () => {
					for (const f of shapes) {
						const tk = p.tokens.find((t) => t.name === f.shape.color);
						const rgb = tk ? tk.rgb : [255, 0, 255, 255];
						const k = f.shape.shade ?? 1;
						fillShape(ctx, f.shape, `rgba(${Math.min(255, rgb[0] * k)},${Math.min(255, rgb[1] * k)},${Math.min(255, rgb[2] * k)},${rgb[3] / 255})`);
					}
				},
			});
		} else {
			const o = outlineOf(p) ?? [];
			items.push({
				pts: o,
				draw: () => {
					const X = p.xf as Xf;
					ctx.save();
					ctx.transform(X[0], X[1], X[2], X[3], X[4], X[5]);
					drawDoc(ctx, p.doc as Doc, p.tokens, { pose: p.poses as StatePart[] | undefined });
					ctx.restore();
				},
			});
		}
	}
	for (const it of items) for (const q of it.pts) {
		lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
		hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
	}
	if (!Number.isFinite(lo[0])) return;
	const bw = Math.max(hi[0] - lo[0], 0.001);
	const bh = Math.max(hi[1] - lo[1], 0.001);
	const s = Math.min((w - 16) / bw, (h - 16) / bh);
	const mid: Vec2 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
	ctx.setTransform(s * dpr, 0, 0, s * dpr, (w / 2 - mid[0] * s) * dpr, (h / 2 - mid[1] * s) * dpr);
	for (const it of items) it.draw();
}
