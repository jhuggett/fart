// The model canvas: the 3D document projected under the view and drawn
// with the 2D painter, and what the pointer does to it. Everything the
// hand does happens in the view plane: a shape or a corner drags along
// it, a drawn rect, circle, line or poly becomes a box, a ball, a rod or
// a prism as deep as the depth field says, the current part's pivot
// drags to place it and its lever turns it about the view axis, and a
// drag on nothing orbits the model.

import { cssColor, colorOf, shadeColor, shapeDistance, viewXf3, xf3Apply, xf3ApplyDir, xf3Invert, xf3Det, dist, type Shape, type Vec2, type Vec3, type FramePart } from "@fastart/core";
import { view } from "./view.ts";
import { fillShape, outlineShape, tracePoly } from "./draw.ts";
import { drawGrid } from "./render.ts";
import { canvasColors } from "../state/theme.ts";
import {
	md,
	parts,
	curPart,
	curClip,
	curTokName,
	frameParts,
	framePartOf,
	selShape,
	poseOfCur,
	addShape,
	extrudeView,
	moveSelView,
	moveVertexView,
	workDepth,
	viewToRest,
	setPose,
	turnPose,
	setPivot,
	orbit,
	endGesture,
	type Sel3,
} from "../state/model.ts";

export interface Mods {
	shift: boolean;
	alt: boolean;
	cmd?: boolean;
}

export const ix3 = {
	down: false,
	cursor: null as Vec2 | null,
	drawing: false,
	drawA: [0, 0] as Vec2,
	dragging: false,
	dragLast: [0, 0] as Vec2,
	vertex: null as number | null,
	poseDrag: false,
	poseRot: false,
	poseAng0: 0,
	orbiting: false,
	orbitLast: [0, 0] as Vec2,
	mods: { shift: false, alt: false, cmd: false } as Mods,
};

const z = () => view.zoom.value;
const px = (n: number) => n / z();

/** Where a rest point of a part lands on the canvas. */
export function viewPoint(fp: FramePart, p: Vec3): Vec2 {
	const v = xf3Apply(fp.F, p);
	return [v[0], v[1]];
}

/** The corners of the selected mesh, projected. */
export function vertexHandles(): { i: number; at: Vec2 }[] {
	const s = md.sel.value;
	const sh = selShape();
	if (!s || !sh || sh.kind !== "mesh") return [];
	const fp = framePartOf(s.part);
	if (!fp) return [];
	return sh.points.map((p, i) => ({ i, at: viewPoint(fp, p) }));
}

/** The topmost shape under a world point: the nearest face that is under it. */
export function pick(wm: Vec2): Sel3 | null {
	const tol = px(4);
	let best: { depth: number; sel: Sel3 } | null = null;
	for (const fp of frameParts()) {
		if (fp.part.like) continue; // a part drawn like another: edit the source
		for (const f of fp.shapes) {
			if (f.outline) continue;
			if (shapeDistance(f.shape, wm) > tol) continue;
			if (!best || f.depth < best.depth) best = { depth: f.depth, sel: { part: fp.index, shape: f.src } };
		}
	}
	return best?.sel ?? null;
}

/** The current part's pivot on the canvas, and its lever (the in-plane turn). */
export function pivotLever(): { at: Vec2; lever: Vec2; angle: number } | null {
	const fp = framePartOf(md.curPart.value);
	if (!fp) return null;
	const at = fp.pivot;
	const angle = Math.atan2(fp.M[3], fp.M[0]);
	const len = px(36);
	return { at, lever: [at[0] + Math.cos(angle - Math.PI / 2) * len, at[1] + Math.sin(angle - Math.PI / 2) * len], angle };
}

function snapPt(p: Vec2): Vec2 {
	if (!view.snapGrid.value || ix3.mods.cmd) return p;
	return [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2];
}

/** The axis of the view (toward the viewer's z) in the current part's parent frame, for turning about it. */
function viewAxisInParent(): { axis: Vec3; sign: number } | null {
	const p = curPart();
	if (!p) return null;
	const fp = framePartOf(md.curPart.value);
	if (!fp) return null;
	// F(part) = V · W(parent) · L; the parent's frame in view space is F · L⁻¹; a turn about view z in
	// the parent's rest frame is that map's inverse applied to (0, 0, 1)
	const parentIdx = p.parent ? parts().findIndex((q) => q.name === p.parent) : -1;
	const P = parentIdx >= 0 ? framePartOf(parentIdx)?.F : undefined;
	// no parent: the parent frame is the world, whose view map is the view turn alone
	const base = P ?? viewOnly();
	const inv = xf3Invert(base);
	const axis = xf3ApplyDir(inv, [0, 0, 1]);
	void fp;
	return { axis, sign: xf3Det(base) < 0 ? -1 : 1 };
}
/** The view turn as a map: the world's frame on the canvas. */
function viewOnly() {
	return viewXf3(md.turn.value);
}
/** Orbit by a pointer movement in pixels: yaw and pitch, grabbing the surface. */
export function orbitDrag(dxPx: number, dyPx: number) {
	orbit(-dxPx * 0.008, dyPx * 0.008);
}

// ------------------------------------------------------------- pointer

export function onDown(wm: Vec2, mods: Mods) {
	ix3.down = true;
	ix3.mods = mods;
	ix3.cursor = wm;
	if (md.pending.value === "pivot") {
		const i = md.curPart.value;
		const fp = framePartOf(i);
		if (fp) setPivot(i, viewToRest(i, [wm[0], wm[1], xf3Apply(fp.F, parts()[i].pivot ?? [0, 0, 0])[2]]));
		md.pending.value = "none";
		ix3.down = false;
		return;
	}
	const preview = !!curClip();
	const tool = md.tool.value;
	if (tool !== "select" && !preview) {
		const p = snapPt(wm);
		if (tool === "poly") {
			const pts = md.polyPts.value;
			if (pts.length >= 3 && dist(p, pts[0]) < px(10)) return polyClose();
			md.polyPts.value = [...pts, p];
			return;
		}
		ix3.drawing = true;
		ix3.drawA = p;
		return;
	}
	// the pivot and its lever, for the current part
	const pl = pivotLever();
	if (pl && !preview && poseOfCur()) {
		if (dist(wm, pl.lever) < px(8)) {
			ix3.poseRot = true;
			ix3.poseAng0 = Math.atan2(wm[1] - pl.at[1], wm[0] - pl.at[0]);
			return;
		}
		if (dist(wm, pl.at) < px(9)) {
			ix3.poseDrag = true;
			ix3.dragLast = wm;
			return;
		}
	}
	// a corner of the selected mesh
	if (!preview) {
		for (const h of vertexHandles()) {
			if (dist(wm, h.at) < px(7)) {
				md.vert.value = h.i;
				ix3.vertex = h.i;
				ix3.dragging = true;
				ix3.dragLast = wm;
				return;
			}
		}
	}
	const hit = pick(wm);
	if (hit) {
		md.sel.value = hit;
		md.vert.value = null;
		md.curPart.value = hit.part;
		if (!preview) {
			ix3.dragging = true;
			ix3.vertex = null;
			ix3.dragLast = wm;
		}
		return;
	}
	if (!mods.shift) {
		md.sel.value = null;
		md.vert.value = null;
	}
	ix3.orbiting = true;
	ix3.orbitLast = wm;
}

export function onMove(wm: Vec2, mods: Mods) {
	ix3.mods = mods;
	ix3.cursor = wm;
	if (!ix3.down) {
		const h = md.tool.value === "select" ? pick(wm) : null;
		const cur = md.hover.value;
		if ((h?.part !== cur?.part || h?.shape !== cur?.shape) && !(h === null && cur === null)) md.hover.value = h;
		return;
	}
	if (ix3.orbiting) {
		orbitDrag((wm[0] - ix3.orbitLast[0]) * z(), (wm[1] - ix3.orbitLast[1]) * z());
		ix3.orbitLast = wm;
		return;
	}
	if (ix3.poseRot) {
		const pl = pivotLever();
		const sp = poseOfCur();
		const ax = viewAxisInParent();
		if (!pl || !sp || !ax) return;
		const a = Math.atan2(wm[1] - pl.at[1], wm[0] - pl.at[0]);
		let d = a - ix3.poseAng0;
		if (d > Math.PI) d -= Math.PI * 2;
		if (d < -Math.PI) d += Math.PI * 2;
		if (mods.shift) d = Math.round(d / (Math.PI / 12)) * (Math.PI / 12);
		if (d === 0) return;
		turnPose(sp, ax.axis, d * ax.sign, "pose-rot");
		ix3.poseAng0 = a;
		return;
	}
	if (ix3.poseDrag) {
		const sp = poseOfCur();
		const p = curPart();
		if (!sp || !p) return;
		const d: Vec2 = [wm[0] - ix3.dragLast[0], wm[1] - ix3.dragLast[1]];
		ix3.dragLast = wm;
		// the offset lives in the parent's rest frame: undo the parent's view map on the displacement
		const parentIdx = p.parent ? parts().findIndex((q) => q.name === p.parent) : -1;
		const P = parentIdx >= 0 ? framePartOf(parentIdx)?.F : undefined;
		const inv = xf3Invert(P ?? viewOnly());
		const dr = xf3ApplyDir(inv, [d[0], d[1], 0]);
		const o = sp.offset ?? p.pivot ?? [0, 0, 0];
		setPose(sp, { offset: [o[0] + dr[0], o[1] + dr[1], o[2] + dr[2]].map((x) => Math.round(x * 1000) / 1000) as Vec3 }, "pose-move");
		return;
	}
	if (ix3.dragging && md.sel.value) {
		const d: Vec3 = [wm[0] - ix3.dragLast[0], wm[1] - ix3.dragLast[1], 0];
		ix3.dragLast = wm;
		if (ix3.vertex !== null) moveVertexView(md.sel.value, ix3.vertex, d);
		else moveSelView(md.sel.value, d);
	}
}

export function onUp(wm: Vec2, mods: Mods) {
	ix3.down = false;
	ix3.mods = mods;
	if (ix3.orbiting) {
		ix3.orbiting = false;
		return;
	}
	if (ix3.drawing) {
		ix3.drawing = false;
		const a = ix3.drawA;
		const b = snapPt(wm);
		finishDraw(a, b, mods);
		return;
	}
	if (ix3.dragging || ix3.poseDrag || ix3.poseRot) {
		ix3.dragging = false;
		ix3.poseDrag = false;
		ix3.poseRot = false;
		ix3.vertex = null;
		endGesture();
	}
}

export function cancelGesture() {
	ix3.down = false;
	ix3.drawing = false;
	ix3.dragging = false;
	ix3.poseDrag = false;
	ix3.poseRot = false;
	ix3.orbiting = false;
	endGesture();
}

/** A drag with a drawing tool: a box, a ball or a rod, as deep as the depth field. */
function finishDraw(a: Vec2, b: Vec2, mods: Mods) {
	const tool = md.tool.value;
	const color = curTokName();
	const depth = workDepth();
	const thick = md.thick.value;
	const i = md.curPart.value;
	if (tool === "rect") {
		let [x0, y0, x1, y1] = [a[0], a[1], b[0], b[1]];
		if (mods.shift) {
			const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
			x1 = x0 + Math.sign(x1 - x0 || 1) * s;
			y1 = y0 + Math.sign(y1 - y0 || 1) * s;
		}
		if (Math.abs(x1 - x0) < 0.05 || Math.abs(y1 - y0) < 0.05) return;
		const mesh = extrudeView([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], depth, thick, color);
		if (mesh) addShape(mesh);
	} else if (tool === "circle") {
		const r = Math.max(dist(a, b), 0.1);
		addShape({ kind: "ball", color, at: viewToRest(i, [a[0], a[1], depth]), r: Math.round(r * 1000) / 1000 });
	} else if (tool === "line") {
		if (dist(a, b) < 0.05) return;
		let bb = b;
		if (mods.shift) {
			const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 4)) * (Math.PI / 4);
			const l = dist(a, b);
			bb = [a[0] + Math.cos(ang) * l, a[1] + Math.sin(ang) * l];
		}
		addShape({ kind: "rod", color, a: viewToRest(i, [a[0], a[1], depth]), b: viewToRest(i, [bb[0], bb[1], depth]), w: Math.max(0.2, thick / 2) });
	}
}

/** Close the polygon being drawn into a prism. */
export function polyClose() {
	const pts = md.polyPts.value;
	if (pts.length < 3) return;
	const mesh = extrudeView(pts, workDepth(), md.thick.value, curTokName());
	md.polyPts.value = [];
	if (mesh) addShape(mesh);
}
export function polyEnter() {
	polyClose();
}
export function escape() {
	if (md.polyPts.value.length) {
		md.polyPts.value = [];
		return;
	}
	if (md.pending.value !== "none") {
		md.pending.value = "none";
		return;
	}
	if (md.tool.value !== "select") {
		md.tool.value = "select";
		return;
	}
	md.sel.value = null;
	md.vert.value = null;
}
export function nudgeView(d: Vec2) {
	const s = md.sel.value;
	if (!s) return;
	if (md.vert.value !== null) moveVertexView(s, md.vert.value, [d[0], d[1], 0], "nudge");
	else moveSelView(s, [d[0], d[1], 0], "nudge");
}

/** The frame's extents on the canvas, for zoom to fit. */
export function frameBounds(): { lo: Vec2; hi: Vec2 } | null {
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	const take = (p: Vec2) => {
		lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
		hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
	};
	for (const fp of frameParts()) {
		for (const f of fp.shapes) {
			const sh = f.shape;
			if (sh.kind === "poly") sh.points.forEach(take);
			else if (sh.kind === "circle") {
				take([sh.at[0] - sh.r, sh.at[1] - sh.r]);
				take([sh.at[0] + sh.r, sh.at[1] + sh.r]);
			} else {
				take(sh.a);
				take(sh.b);
			}
		}
		take(fp.pivot);
	}
	return Number.isFinite(lo[0]) ? { lo, hi } : null;
}

// ------------------------------------------------------------- render

/** The ground under the solids: the theme's bg and the grid. */
export function renderGround(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
	const C = canvasColors();
	const [panx, pany] = view.pan.value;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = C.bg;
	ctx.fillRect(0, 0, W, H);
	drawGrid(ctx, W, H, panx, pany, view.zoom.value, C.grid, C.gridStrong);
}

/**
 * The overlay above the solids: outlines, corners, the pivot and lever,
 * the rig, what is being drawn, the axes. With `paint`, the solids too
 * (the painter's fallback when there is no WebGL).
 */
export function render3(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, paint = false) {
	const C = canvasColors();
	const ACCENT = C.accent;
	const HOVER = C.hover;
	const TEAL = C.ok;
	const LW = C.line;
	const [panx, pany] = view.pan.value;
	const zoom = view.zoom.value;
	const world = () => ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (W / 2 - panx * zoom) * dpr, (H / 2 - pany * zoom) * dpr);
	const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const toS = (p: Vec2): Vec2 => [(p[0] - panx) * zoom + W / 2, (p[1] - pany) * zoom + H / 2];

	screen();
	ctx.clearRect(0, 0, W, H);

	const tokens = md.tokens.value;
	const fps = frameParts();
	const sel = md.sel.value;
	const hov = md.hover.value;
	const preview = !!curClip();

	world();
	let selShapes: Shape[] = [];
	let hovShapes: Shape[] = [];
	// one painter's order for the whole frame: faces of different parts interleave by depth
	const faces = fps.flatMap((fp) => fp.shapes.map((f) => ({ fp, f }))).sort((p, q) => q.f.depth - p.f.depth);
	for (const { fp, f } of faces) {
		const css = f.outline ? C.text2 : cssColor(shadeColor(colorOf(tokens, f.shape.color ?? ""), f.shape.shade));
		if (paint || f.outline) fillShape(ctx, f.shape, css);
		const srcIndex = fp.part.like ? -1 : fp.index;
		if (sel && sel.part === srcIndex && sel.shape === f.src && !f.outline) selShapes.push(f.shape);
		if (hov && hov.part === srcIndex && hov.shape === f.src && !f.outline) hovShapes.push(f.shape);
	}
	// the rig: a bone from each child's pivot to its parent's
	screen();
	ctx.strokeStyle = C.accentSoft;
	ctx.lineWidth = LW;
	ctx.setLineDash([3, 3]);
	for (const fp of fps) {
		if (!fp.part.parent) continue;
		const parent = fps.find((q) => q.part.name === fp.part.parent);
		if (!parent) continue;
		const a = toS(fp.pivot);
		const b = toS(parent.pivot);
		ctx.beginPath();
		ctx.moveTo(a[0], a[1]);
		ctx.lineTo(b[0], b[1]);
		ctx.stroke();
	}
	ctx.setLineDash([]);

	world();
	for (const sh of hovShapes) if (!selShapes.includes(sh)) outlineShape(ctx, sh, HOVER, LW, zoom);
	for (const sh of selShapes) outlineShape(ctx, sh, ACCENT, 1.5 * LW, zoom);

	// the selected mesh's corners
	if (!preview) {
		const vert = md.vert.value;
		screen();
		for (const h of vertexHandles()) {
			const s = toS(h.at);
			ctx.fillStyle = h.i === vert ? ACCENT : C.handleFill;
			ctx.strokeStyle = ACCENT;
			ctx.lineWidth = LW;
			ctx.beginPath();
			ctx.rect(s[0] - 3.5, s[1] - 3.5, 7, 7);
			ctx.fill();
			ctx.stroke();
		}
	}

	// the current part's pivot and lever
	const pl = pivotLever();
	if (pl && !preview) {
		screen();
		const a = toS(pl.at);
		const l = toS(pl.lever);
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = LW;
		ctx.beginPath();
		ctx.moveTo(a[0], a[1]);
		ctx.lineTo(l[0], l[1]);
		ctx.stroke();
		ctx.fillStyle = ACCENT;
		ctx.beginPath();
		ctx.arc(l[0], l[1], 4, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.arc(a[0], a[1], 6, 0, Math.PI * 2);
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = 1.5 * LW;
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(a[0] - 9, a[1]);
		ctx.lineTo(a[0] + 9, a[1]);
		ctx.moveTo(a[0], a[1] - 9);
		ctx.lineTo(a[0], a[1] + 9);
		ctx.lineWidth = LW;
		ctx.stroke();
	}

	// what is being drawn
	const cur = ix3.cursor;
	const tool = md.tool.value;
	const css = cssColor(colorOf(tokens, curTokName()));
	world();
	if (ix3.drawing && cur) {
		const a = ix3.drawA;
		const b = snapPt(cur);
		ctx.globalAlpha = 0.6;
		if (tool === "rect") fillShape(ctx, { kind: "poly", points: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]] }, css);
		else if (tool === "circle") fillShape(ctx, { kind: "circle", at: a, r: dist(a, b) }, css);
		else if (tool === "line") fillShape(ctx, { kind: "line", a, b, w: Math.max(0.2, md.thick.value / 2) }, css);
		ctx.globalAlpha = 1;
	}
	const pts = md.polyPts.value;
	if (pts.length) {
		const all = cur ? [...pts, snapPt(cur)] : pts;
		ctx.globalAlpha = 0.5;
		if (all.length >= 3) {
			tracePoly(ctx, all, (p) => p);
			ctx.fillStyle = css;
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = LW / zoom;
		tracePoly(ctx, all, (p) => p);
		ctx.stroke();
		screen();
		const first = toS(pts[0]);
		ctx.fillStyle = pts.length >= 3 && cur && dist(cur, pts[0]) < px(10) ? ACCENT : css;
		ctx.beginPath();
		ctx.arc(first[0], first[1], 5, 0, Math.PI * 2);
		ctx.fill();
	}

	// the axes: which way the model is turned
	screen();
	const V = viewOnly();
	const o: Vec2 = [46, H - 46];
	const axes: [Vec3, string, string][] = [
		[[1, 0, 0], "x", "#d9534f"],
		[[0, 1, 0], "y", "#5cb85c"],
		[[0, 0, 1], "z", "#5b9bd5"],
	];
	ctx.font = "10px system-ui, sans-serif";
	for (const [d, name, color] of axes) {
		const v = xf3ApplyDir(V, d);
		const e: Vec2 = [o[0] + v[0] * 26, o[1] + v[1] * 26];
		ctx.strokeStyle = color;
		ctx.globalAlpha = v[2] > 0 ? 0.45 : 1;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(o[0], o[1]);
		ctx.lineTo(e[0], e[1]);
		ctx.stroke();
		ctx.fillStyle = color;
		ctx.fillText(name, e[0] + v[0] * 6 - 3, e[1] + v[1] * 6 + 3);
		ctx.globalAlpha = 1;
	}
	void TEAL;
}
