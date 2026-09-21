// The scene canvas: every instance drawn where the scene puts it (the 2D
// painter for a 2D scene, the WebGL solids for a 3D one), the chosen
// node outlined, a drag moving a node along the canvas (or the view
// plane), a drag on nothing orbiting a 3D scene.

import { docBounds, drawList, projectFrame, shapeDistance, shapesOf, viewXf3, xfApply, xfInvert, xfScale, xf3Apply, xf3ApplyDir, xf3Invert, dist, type Doc, type Doc3, type Placed, type StatePart, type StatePart3, type Vec2, type Vec3, type Xf, type Xf3, type FramePart } from "@fastart/core";
import { view } from "./view.ts";
import { drawDoc, fillShape, tracePoly } from "./draw.ts";
import { drawGrid, patternsOf } from "./render.ts";
import { canvasColors } from "../state/theme.ts";
import type { SolidLayer } from "./gl3.ts";
import { sc, flattened, is3d, docPathOf, nudgeNode, orbit, endGesture } from "../state/scene.ts";

export const sx = {
	down: false,
	cursor: null as Vec2 | null,
	dragging: false,
	dragLast: [0, 0] as Vec2,
	orbiting: false,
	orbitLast: [0, 0] as Vec2,
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

/** What the WebGL layer draws for a 3D scene. */
export function sceneLayers(): SolidLayer[] {
	const { placed } = flattened();
	const proj = projected();
	return placed.map((p) => ({ doc: p.doc as Doc3, fps: proj.get(p.path) ?? [], tokens: p.tokens, patterns: sc.patterns.value.get(docPathOf(p)) }));
}

/** The canvas-space outline of an instance: its bounds through its map (2D), or its projected shapes' bounds (3D). */
function outlineOf(p: Placed): Vec2[] | null {
	if (is3d()) {
		const fps = projected().get(p.path) ?? [];
		let lo: Vec2 = [Infinity, Infinity];
		let hi: Vec2 = [-Infinity, -Infinity];
		for (const fp of fps) for (const f of fp.shapes) {
			const sh = f.shape;
			const pts: Vec2[] = sh.kind === "poly" ? sh.points : sh.kind === "circle" ? [[sh.at[0] - sh.r, sh.at[1] - sh.r], [sh.at[0] + sh.r, sh.at[1] + sh.r]] : [sh.a, sh.b];
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
		const proj = projected();
		for (const p of placed) {
			for (const fp of proj.get(p.path) ?? []) for (const f of fp.shapes) {
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
			for (const sh of shapesOf(p.doc as Doc, e.part)) if (shapeDistance(sh, q) <= tol / s / (e.scale || 1)) return p.path;
		}
	}
	return null;
}

/** The extents of everything drawn, for zoom to fit. */
export function frameBounds(): { lo: Vec2; hi: Vec2 } | null {
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
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
	const hit = pick(wm);
	if (hit) {
		// a nested scene's node cannot be edited here: select its top-level ancestor
		sc.sel.value = editablePath(hit);
		sx.dragging = true;
		sx.dragLast = wm;
		return;
	}
	if (!mods.shift) sc.sel.value = null;
	if (is3d()) {
		sx.orbiting = true;
		sx.orbitLast = wm;
	}
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
	void mods;
	sx.cursor = wm;
	if (!sx.down) {
		const h = pick(wm);
		const e = h ? editablePath(h) : null;
		if (e !== sc.hover.value) sc.hover.value = e;
		return;
	}
	if (sx.orbiting) {
		orbit(-(wm[0] - sx.orbitLast[0]) * z() * 0.008, (wm[1] - sx.orbitLast[1]) * z() * 0.008);
		sx.orbitLast = wm;
		return;
	}
	if (sx.dragging && sc.sel.value) {
		const d: Vec2 = [wm[0] - sx.dragLast[0], wm[1] - sx.dragLast[1]];
		sx.dragLast = wm;
		if (is3d()) {
			// a view-plane displacement, back in the world's frame
			const Vinv = xf3Invert(viewXf3(sc.turn.value));
			const dw = xf3ApplyDir(Vinv, [d[0], d[1], 0]);
			nudgeNode(sc.sel.value, dw);
		} else nudgeNode(sc.sel.value, d);
	}
}
export function onUp() {
	sx.down = false;
	if (sx.dragging || sx.orbiting) endGesture();
	sx.dragging = false;
	sx.orbiting = false;
}
export function cancelGesture() {
	onUp();
}
export function nudgeSel(d: Vec2) {
	if (!sc.sel.value) return;
	if (is3d()) {
		const Vinv = xf3Invert(viewXf3(sc.turn.value));
		nudgeNode(sc.sel.value, xf3ApplyDir(Vinv, [d[0], d[1], 0]), "nudge");
	} else nudgeNode(sc.sel.value, d, "nudge");
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
	if (sc.hover.value && sc.hover.value !== sc.sel.value) drawOutline(sc.hover.value, C.hover, C.line);
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
export function drawSceneThumb(canvas: HTMLCanvasElement, layers: { placed: Placed[]; space3d: boolean }) {
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.clientWidth;
	const h = canvas.clientHeight;
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
				else pts.push(sh.a, sh.b);
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
