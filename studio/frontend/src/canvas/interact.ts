// What the pointer does to the document. Everything happens inside a
// state: shapes are edited through the pose their part is in (a corner
// you drag lands in the part's own space), the current part's pivot
// drags to place it and its lever turns it, a chain's ring reaches. The
// collision lens edits doc.collision in rest space with the same tools.

import {
	dist,
	shapeDistance,
	worldTransforms,
	xfApply,
	xfInvert,
	xfAngle,
	xfScale,
	pivotOf,
	chainEndWorld,
	shapesOf,
	XF_ID,
	type Constraint,
	type Shape,
	type Vec2,
	type Xf,
} from "@fastart/core";
import { view } from "./view.ts";
import { ask } from "../state/prompt.ts";
import {
	ed,
	curPart,
	curState,
	curTokName,
	mutate,
	endGesture,
	parts,
	primary,
	selShape,
	selHas,
	selOnly,
	selToggle,
	selMakePrimary,
	selClear,
	selAdd,
	moveShape,
	scaleShape,
	shapesIn,
	settleTargets,
	targetOf,
	setPivot,
	addAnchor,
	poseOfCur,
	colShape,
	constraints,
	ikTo,
	frame,
	doc,
	mode,
	pickableParts,
	dupSelInPlace,
	type Ref,
} from "../state/editor.ts";

export interface Mods {
	shift: boolean;
	alt: boolean;
	/** Cmd defeats snapping for the gesture */
	cmd?: boolean;
}

/** Everything a gesture in progress remembers. */
export const ix = {
	handle: 0, // >0: dragging that handle (1-based) of the primary shape
	scaling: false,
	scaleAnchor: [0, 0] as Vec2, // world
	scaleD: 1,
	dragging: false,
	dragOff: [0, 0] as Vec2, // world
	marquee: false,
	mqA: [0, 0] as Vec2,
	drawing: false,
	drawA: [0, 0] as Vec2, // world
	poseDrag: false,
	poseRot: false,
	poseGrab: [0, 0] as Vec2,
	poseRot0: 0,
	poseAng0: 0,
	ik: null as Constraint | null,
	cursor: null as Vec2 | null, // world position, for previews
	down: false,
	mods: { shift: false, alt: false, cmd: false } as Mods,
	snapAt: null as Vec2 | null,
	space: false,
};

function z(): number {
	return view.zoom.value;
}

// ------------------------------------------------------------- spaces
// The canvas is world space. Each part's shapes live in its own rest
// space; the pose on screen maps between the two.

/** World transforms of what is on screen. */
export function frameW(): Map<string, Xf> {
	return worldTransforms(doc(), frame());
}

export function partXf(p: number, w: Map<string, Xf> = frameW()): Xf {
	const part = parts()[p];
	return (part && w.get(part.name)) ?? XF_ID;
}

export function toLocal(p: number, wm: Vec2, w?: Map<string, Xf>): Vec2 {
	return xfApply(xfInvert(partXf(p, w)), wm);
}

export function toWorldPt(p: number, pt: Vec2, w?: Map<string, Xf>): Vec2 {
	return xfApply(partXf(p, w), pt);
}

/** A world displacement as the part sees it (rotation and scale undone). */
function localDelta(p: number, d: Vec2, w?: Map<string, Xf>): Vec2 {
	const T = xfInvert(partXf(p, w));
	return [T[0] * d[0] + T[2] * d[1], T[1] * d[0] + T[3] * d[1]];
}

/** Where a part's pivot sits on screen, parents applied. */
export function worldPivot(name: string, W = frameW()): Vec2 | null {
	const part = parts().find((p) => p.name === name);
	if (!part) return null;
	return xfApply(W.get(name) ?? XF_ID, pivotOf(part));
}

/** A shape's box on screen, from its points through the pose. */
export function shapeWorldBounds(p: number, sh: Shape, w?: Map<string, Xf>): { lo: Vec2; hi: Vec2 } | null {
	const xf = partXf(p, w);
	const s = xfScale(xf);
	let pts: Vec2[];
	switch (sh.kind) {
		case "circle": {
			const c = xfApply(xf, sh.at);
			return { lo: [c[0] - sh.r * s, c[1] - sh.r * s], hi: [c[0] + sh.r * s, c[1] + sh.r * s] };
		}
		case "line":
			pts = [xfApply(xf, sh.a), xfApply(xf, sh.b)];
			const hw = sh.w * s * 0.5;
			return {
				lo: [Math.min(pts[0][0], pts[1][0]) - hw, Math.min(pts[0][1], pts[1][1]) - hw],
				hi: [Math.max(pts[0][0], pts[1][0]) + hw, Math.max(pts[0][1], pts[1][1]) + hw],
			};
		case "poly":
			if (!sh.points.length) return null;
			pts = sh.points.map((q) => xfApply(xf, q));
			break;
	}
	const lo: Vec2 = [Infinity, Infinity];
	const hi: Vec2 = [-Infinity, -Infinity];
	for (const q of pts) {
		lo[0] = Math.min(lo[0], q[0]);
		lo[1] = Math.min(lo[1], q[1]);
		hi[0] = Math.max(hi[0], q[0]);
		hi[1] = Math.max(hi[1], q[1]);
	}
	return { lo, hi };
}

/** The selection's box on screen, or null. */
export function selBounds(): { lo: Vec2; hi: Vec2 } | null {
	const w = frameW();
	const ps = parts();
	let acc: { lo: Vec2; hi: Vec2 } | null = null;
	for (const r of ed.sel.value) {
		const sh = ps[r.p] ? shapesIn(ps[r.p])[r.s] : undefined;
		if (!sh) continue;
		const b = shapeWorldBounds(r.p, sh, w);
		if (!b) continue;
		if (!acc) acc = { lo: [...b.lo], hi: [...b.hi] };
		else {
			acc.lo[0] = Math.min(acc.lo[0], b.lo[0]);
			acc.lo[1] = Math.min(acc.lo[1], b.lo[1]);
			acc.hi[0] = Math.max(acc.hi[0], b.hi[0]);
			acc.hi[1] = Math.max(acc.hi[1], b.hi[1]);
		}
	}
	return acc;
}

/** Corner grips of the selection box (world), each with the anchor it scales about. */
export function scaleGrips(): { at: Vec2; anchor: Vec2 }[] {
	const b = selBounds();
	if (!b) return [];
	const pad = 6 / z();
	const { lo, hi } = b;
	return [
		{ at: [lo[0] - pad, lo[1] - pad], anchor: hi },
		{ at: [hi[0] + pad, lo[1] - pad], anchor: [lo[0], hi[1]] },
		{ at: [hi[0] + pad, hi[1] + pad], anchor: lo },
		{ at: [lo[0] - pad, hi[1] + pad], anchor: [hi[0], lo[1]] },
	];
}

/** A shape's handles in its own space. */
export function handlesOf(sh: Shape): Vec2[] {
	switch (sh.kind) {
		case "circle":
			return [[sh.at[0] + sh.r, sh.at[1]]];
		case "line":
			return [sh.a, sh.b];
		case "poly":
			return sh.points;
	}
}

/** The primary shape's handles on screen. */
export function worldHandles(): Vec2[] {
	const r = primary();
	const sh = selShape();
	if (!r || !sh) return [];
	const xf = partXf(r.p);
	return handlesOf(sh).map((h) => xfApply(xf, h));
}

/** The shape under a point among the pickable parts; topmost wins. */
export function pick(at: Vec2): Ref | null {
	const ps = parts();
	const w = frameW();
	let best: Ref | null = null;
	let bd = 10 / z() + 2;
	for (const p of pickableParts()) {
		const xf = partXf(p, w);
		const inv = xfInvert(xf);
		const s = xfScale(xf) || 1;
		const local = xfApply(inv, at);
		shapesIn(ps[p]).forEach((sh, si) => {
			const d = shapeDistance(sh, local) * s;
			if (d <= bd) {
				bd = d;
				best = { p, s: si };
			}
		});
	}
	return best;
}

// ------------------------------------------------------------- snapping

const SNAP_PX = 8;

function snapCandidates(exclude: Set<string>): Vec2[] {
	const out: Vec2[] = [];
	const ps = parts();
	const w = frameW();
	for (const p of pickableParts()) {
		const xf = partXf(p, w);
		shapesIn(ps[p]).forEach((sh, s) => {
			if (exclude.has(`${p}:${s}`)) return;
			switch (sh.kind) {
				case "circle":
					out.push(xfApply(xf, sh.at));
					break;
				case "line":
					out.push(xfApply(xf, sh.a), xfApply(xf, sh.b));
					break;
				case "poly":
					for (const q of sh.points) out.push(xfApply(xf, q));
					break;
			}
		});
		out.push(xfApply(xf, pivotOf(ps[p])));
	}
	return out;
}

/** Pull a world point to nearby geometry or the grid; remembers where, for the marker. */
export function snap(wm: Vec2, mods: Mods, exclude: Ref[] = []): Vec2 {
	ix.snapAt = null;
	if (mods.cmd) return wm;
	const ex = new Set(exclude.map((r) => `${r.p}:${r.s}`));
	let best: Vec2 | null = null;
	let bd = SNAP_PX / z();
	for (const c of snapCandidates(ex)) {
		const d = dist(c, wm);
		if (d < bd) {
			bd = d;
			best = c;
		}
	}
	if (best) {
		ix.snapAt = best;
		return [best[0], best[1]];
	}
	if (view.snapGrid.value) {
		const g: Vec2 = [Math.round(wm[0] * 2) / 2, Math.round(wm[1] * 2) / 2];
		ix.snapAt = g;
		return g;
	}
	return wm;
}

/** Shift while drawing: lines to 45°, rects square. */
function constrain(a: Vec2, b: Vec2, tool: string, shift: boolean): Vec2 {
	if (!shift) return b;
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	if (tool === "line") {
		const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
		const len = Math.hypot(dx, dy);
		return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
	}
	if (tool === "rect") {
		const side = Math.max(Math.abs(dx), Math.abs(dy));
		return [a[0] + Math.sign(dx || 1) * side, a[1] + Math.sign(dy || 1) * side];
	}
	return b;
}

/** Where the cursor really is for a drawing preview: snapped and constrained. */
export function drawCursor(): Vec2 | null {
	const cur = ix.cursor;
	if (!cur) return null;
	return constrain(ix.drawA, snap(cur, ix.mods), ed.tool.value, ix.mods.shift);
}

// ------------------------------------------------------------- shapes

function polyIsRect(pts: Vec2[]): boolean {
	if (pts.length !== 4) return false;
	const eq = (a: number, b: number) => Math.abs(a - b) < 0.001;
	const c1 = eq(pts[0][0], pts[3][0]) && eq(pts[0][1], pts[1][1]) && eq(pts[2][0], pts[1][0]) && eq(pts[2][1], pts[3][1]);
	const c2 = eq(pts[0][0], pts[1][0]) && eq(pts[0][1], pts[3][1]) && eq(pts[2][0], pts[3][0]) && eq(pts[2][1], pts[1][1]);
	return c1 || c2;
}

/** Drag handle `h` (1-based) of a shape to a point in the shape's own space. */
function dragHandle(sh: Shape, h: number, lm: Vec2, alt: boolean) {
	switch (sh.kind) {
		case "circle":
			sh.r = Math.max(dist(sh.at, lm), 0.2);
			break;
		case "line":
			if (h === 1) sh.a = lm;
			else sh.b = lm;
			break;
		case "poly": {
			const i = h - 1;
			if (i >= sh.points.length) return;
			const pts = sh.points;
			if (!alt && polyIsRect(pts)) {
				// a rect stays a rect: the neighbours follow on the axis
				// each shared with this corner
				const old = pts[i];
				const prev = pts[(i + 3) % 4];
				const next = pts[(i + 1) % 4];
				const np: Vec2 = [...prev];
				const nn: Vec2 = [...next];
				if (Math.abs(prev[0] - old[0]) < 0.001) np[0] = lm[0];
				if (Math.abs(prev[1] - old[1]) < 0.001) np[1] = lm[1];
				if (Math.abs(next[0] - old[0]) < 0.001) nn[0] = lm[0];
				if (Math.abs(next[1] - old[1]) < 0.001) nn[1] = lm[1];
				pts[(i + 3) % 4] = np;
				pts[(i + 1) % 4] = nn;
			}
			pts[i] = lm;
			break;
		}
	}
}

/** A shape from two world points, for the current part (or the collision list). */
function newShape(kind: "circle" | "line" | "rect", a: Vec2, b: Vec2, collision: boolean): Shape {
	const color = collision ? undefined : curTokName();
	const p = ed.curPart.value;
	const L = (q: Vec2): Vec2 => (collision ? q : toLocal(p, q));
	const s = collision ? 1 : xfScale(partXf(p)) || 1;
	switch (kind) {
		case "circle":
			return { kind: "circle", color, at: L(a), r: Math.max(dist(a, b) / s, 0.4) };
		case "line":
			return { kind: "line", color, a: L(a), b: L(b), w: collision ? 6 : 1.4 };
		case "rect": {
			const lo: Vec2 = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
			const hi: Vec2 = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
			if (hi[0] - lo[0] < 0.3) hi[0] = lo[0] + 0.3;
			if (hi[1] - lo[1] < 0.3) hi[1] = lo[1] + 0.3;
			return { kind: "poly", color, points: [L(lo), L([hi[0], lo[1]]), L(hi), L([lo[0], hi[1]])] };
		}
	}
}

function commitPoly() {
	const pts = ed.polyPts.value;
	if (pts.length < 3) return;
	const collision = ed.collide.value;
	const p = ed.curPart.value;
	const sh: Shape = { kind: "poly", color: collision ? undefined : curTokName(), points: collision ? pts : pts.map((q) => toLocal(p, q)) };
	addShape(sh);
	ed.polyPts.value = [];
}

function addShape(sh: Shape) {
	if (ed.collide.value) {
		mutate((d) => (d.collision ??= []).push(sh));
		ed.colSel.value = (ed.doc.value.collision?.length ?? 1) - 1;
		return;
	}
	const pi = ed.curPart.value;
	mutate((d) => shapesOf(d, d.parts![pi]).push(sh));
	selOnly({ p: pi, s: shapesIn(parts()[pi]).length - 1 });
}

// ------------------------------------------------------------- the part

/** The turn lever: from the current part's world pivot, along its world angle. */
export function poseLever(): Vec2 | null {
	const sp = poseOfCur();
	const part = curPart();
	if (!sp || !part) return null;
	const xf = partXf(ed.curPart.value);
	const o = xfApply(xf, pivotOf(part));
	const ang = xfAngle(xf);
	const l = 40 / z();
	return [o[0] + Math.cos(ang) * l, o[1] + Math.sin(ang) * l];
}

/** Every chain's reach point in the world, for grabbing; a pinned chain (1.2) shows its pin. */
export function chainGrabs(): { c: Constraint; at: Vec2; pinned: boolean }[] {
	const fr = frame();
	if (!fr) return [];
	const out: { c: Constraint; at: Vec2; pinned: boolean }[] = [];
	for (const c of constraints()) {
		const pin = mode() === "state" ? targetOf(c.name) : undefined;
		const at = pin ? pin.at : chainEndWorld(doc(), fr, c);
		if (at) out.push({ c, at, pinned: !!pin });
	}
	return out;
}

// ------------------------------------------------------------- events

export function onDown(wm: Vec2, mods: Mods) {
	ix.down = true;
	ix.cursor = wm;
	ix.mods = mods;

	// an armed crosshair: this click places it, in the part's own space
	if (ed.pending.value !== "none") {
		const what = ed.pending.value;
		ed.pending.value = "none";
		const k = ed.curPart.value;
		const lm = toLocal(k, wm);
		if (what === "pivot") setPivot(k, lm);
		else void ask("Name the new anchor").then((name) => name && addAnchor(k, name, lm));
		return;
	}

	if (mode() === "collide") return collideDown(wm);
	if (mode() === "clip") return; // a preview: nothing to grab

	switch (ed.tool.value) {
		case "select":
			return selectDown(wm, mods);
		case "circle":
		case "line":
		case "rect":
			ix.drawing = true;
			ix.drawA = snap(wm, mods);
			return;
		case "poly": {
			const pts = ed.polyPts.value;
			if (pts.length >= 3 && dist(pts[0], wm) * z() < 10) commitPoly();
			else ed.polyPts.value = [...pts, snap(wm, mods)];
			return;
		}
	}
}

function selectDown(wm: Vec2, mods: Mods) {
	ix.handle = 0;
	// the part's own grips first: a chain's ring, the lever, the pivot
	for (const g of chainGrabs()) {
		if (dist(g.at, wm) * z() < 10) {
			ix.ik = g.c;
			const last = g.c.chain[g.c.chain.length - 1];
			const k = parts().findIndex((p) => p.name === last);
			if (k >= 0) ed.curPart.value = k;
			return;
		}
	}
	const sp = poseOfCur();
	const part = curPart();
	if (sp && part) {
		const lever = poseLever();
		const o = worldPivot(part.name) ?? [0, 0];
		if (lever && dist(lever, wm) * z() < 10) {
			ix.poseRot = true;
			ix.poseRot0 = sp.rotate ?? 0;
			ix.poseAng0 = Math.atan2(wm[1] - o[1], wm[0] - o[0]);
			return;
		}
		if (dist(o, wm) * z() < 9) {
			ix.poseDrag = true;
			ix.poseGrab = [wm[0] - o[0], wm[1] - o[1]];
			return;
		}
	}
	// then the shape's handles, the selection's grips, the shape itself
	const hs = worldHandles();
	for (let k = 0; k < hs.length; k++) {
		if (dist(hs[k], wm) * z() < 8) {
			ix.handle = k + 1;
			return;
		}
	}
	for (const g of scaleGrips()) {
		if (dist(g.at, wm) * z() < 9) {
			ix.scaling = true;
			ix.scaleAnchor = g.anchor;
			ix.scaleD = Math.max(dist(g.anchor, wm), 0.001);
			return;
		}
	}
	const hit = pick(wm);
	if (hit) {
		if (mods.shift) selToggle(hit);
		else {
			if (!selHas(hit)) selOnly(hit);
			else selMakePrimary(hit);
			ed.curPart.value = hit.p;
			// Alt: drag away a copy, leave the original
			if (mods.alt) dupSelInPlace();
			ix.dragging = true;
			ix.dragOff = wm;
		}
	} else {
		ix.marquee = true;
		ix.mqA = wm;
		if (!mods.shift) selClear();
	}
}

function collideDown(wm: Vec2) {
	switch (ed.tool.value) {
		case "select": {
			ix.handle = 0;
			const sh = colShape();
			if (sh) {
				const hs = handlesOf(sh);
				for (let k = 0; k < hs.length; k++) {
					if (dist(hs[k], wm) * z() < 8) {
						ix.handle = k + 1;
						return;
					}
				}
			}
			let best = -1;
			let bd = 10 / z() + 2;
			(ed.doc.value.collision ?? []).forEach((c, i) => {
				const d = shapeDistance(c, wm);
				if (d <= bd) {
					bd = d;
					best = i;
				}
			});
			ed.colSel.value = best;
			if (best >= 0) {
				ix.dragging = true;
				ix.dragOff = wm;
			}
			return;
		}
		case "circle":
		case "line":
		case "rect":
			ix.drawing = true;
			ix.drawA = wm;
			return;
		case "poly": {
			const pts = ed.polyPts.value;
			if (pts.length >= 3 && dist(pts[0], wm) * z() < 10) commitPoly();
			else ed.polyPts.value = [...pts, wm];
			return;
		}
	}
}

export function onMove(wm: Vec2, mods: Mods) {
	ix.cursor = wm;
	ix.mods = mods;
	const collide = mode() === "collide";
	if (!ix.down) {
		// hover: what a click would pick
		if (ed.tool.value === "select" && mode() === "state") {
			const h = pick(wm);
			const c = ed.hover.value;
			if ((h === null) !== (c === null) || (h && c && (h.p !== c.p || h.s !== c.s))) ed.hover.value = h;
		} else if (ed.hover.value) ed.hover.value = null;
		return;
	}
	const prim = primary();
	const target = collide ? colShape() : selShape();

	if (ix.handle > 0 && target) {
		if (collide) mutate(() => dragHandle(target, ix.handle, wm, mods.alt), "handle");
		else if (prim) {
			const at = snap(wm, mods, ed.sel.value);
			const lm = toLocal(prim.p, at);
			mutate(() => dragHandle(target, ix.handle, lm, mods.alt), "handle");
		}
	} else if (ix.scaling) {
		const d = Math.max(dist(ix.scaleAnchor, wm), 0.001);
		if (d !== ix.scaleD) {
			const f = d / ix.scaleD;
			const w = frameW();
			const ps = parts();
			const refs = ed.sel.value.filter((r) => ps[r.p] && shapesIn(ps[r.p])[r.s]);
			mutate(() => {
				for (const r of refs) scaleShape(shapesIn(ps[r.p])[r.s], f, toLocal(r.p, ix.scaleAnchor, w));
			}, "scale");
			ix.scaleD = d;
		}
	} else if (ix.dragging) {
		// the grab point pulls to geometry, so what you hold lands on things
		const at = collide ? wm : snap(wm, mods, ed.sel.value);
		const d: Vec2 = [at[0] - ix.dragOff[0], at[1] - ix.dragOff[1]];
		if (d[0] !== 0 || d[1] !== 0) {
			if (collide) {
				if (target) mutate(() => moveShape(target, d), "drag");
			} else {
				const w = frameW();
				const ps = parts();
				const refs = ed.sel.value.filter((r) => ps[r.p] && shapesIn(ps[r.p])[r.s]);
				mutate(() => {
					for (const r of refs) moveShape(shapesIn(ps[r.p])[r.s], localDelta(r.p, d, w));
				}, "drag");
			}
			ix.dragOff = at;
		}
	} else if (ix.ik) {
		ikTo(ix.ik, wm);
	} else if (ix.poseRot) {
		const sp = poseOfCur();
		const part = curPart();
		if (sp && part) {
			// a turn about the pivot on screen is the same turn in the part's own frame
			const o = worldPivot(part.name) ?? [0, 0];
			const a = Math.atan2(wm[1] - o[1], wm[0] - o[0]);
			mutate((d) => {
				sp.rotate = ix.poseRot0 + (a - ix.poseAng0);
				settleTargets(d);
			}, "pose");
		}
	} else if (ix.poseDrag) {
		const sp = poseOfCur();
		const part = curPart();
		if (sp && part) {
			// the pivot lands under the cursor, measured in the parent's frame
			const W = frameW();
			const parentXf = part.parent ? (W.get(part.parent) ?? XF_ID) : XF_ID;
			const want: Vec2 = [wm[0] - ix.poseGrab[0], wm[1] - ix.poseGrab[1]];
			const local = xfApply(xfInvert(parentXf), want);
			mutate((d) => {
				sp.offset = local;
				settleTargets(d);
			}, "pose");
		}
	} else {
		// marquee / drawing previews only need a redraw
		ed.rev.value++;
	}
}

export function onUp(wm: Vec2, mods: Mods) {
	ix.cursor = wm;
	ix.down = false;
	if (ix.marquee) {
		ix.marquee = false;
		if (dist(ix.mqA, wm) * z() > 4) {
			const lo: Vec2 = [Math.min(ix.mqA[0], wm[0]), Math.min(ix.mqA[1], wm[1])];
			const hi: Vec2 = [Math.max(ix.mqA[0], wm[0]), Math.max(ix.mqA[1], wm[1])];
			const found: Ref[] = [];
			const ps = parts();
			const w = frameW();
			for (const p of pickableParts()) {
				shapesIn(ps[p]).forEach((sh, s) => {
					const b = shapeWorldBounds(p, sh, w);
					if (b && b.lo[0] <= hi[0] && b.hi[0] >= lo[0] && b.lo[1] <= hi[1] && b.hi[1] >= lo[1]) found.push({ p, s });
				});
			}
			selAdd(found);
		}
	}
	if (ix.drawing) {
		ix.drawing = false;
		const kind = ed.tool.value;
		if (kind === "circle" || kind === "line" || kind === "rect") {
			const collide = mode() === "collide";
			let b = constrain(ix.drawA, collide ? wm : snap(wm, mods), kind, mods.shift);
			if (dist(ix.drawA, b) * z() < 3) {
				// a click, not a drag: a default-sized shape, not a speck
				const a = ix.drawA;
				b = kind === "circle" ? [a[0] + 2, a[1]] : kind === "line" ? [a[0] + 4, a[1]] : [a[0] + 4, a[1] + 4];
			}
			addShape(newShape(kind, ix.drawA, b, collide));
		}
	}
	ix.snapAt = null;
	ix.dragging = false;
	ix.handle = 0;
	ix.scaling = false;
	ix.poseDrag = false;
	ix.poseRot = false;
	ix.ik = null;
	endGesture();
	ed.rev.value++;
}

/** Cancel whatever is in flight (a pointer leaving, a second finger landing). */
export function cancelGesture() {
	ix.down = false;
	ix.dragging = false;
	ix.handle = 0;
	ix.scaling = false;
	ix.marquee = false;
	ix.drawing = false;
	ix.poseDrag = false;
	ix.poseRot = false;
	ix.ik = null;
	endGesture();
	ed.rev.value++;
}

/** Nudge the selection by a world step (the arrow keys), each shape in its part's space. */
export function nudgeWorld(d: Vec2) {
	const ps = parts();
	const w = frameW();
	const refs = ed.sel.value.filter((r) => ps[r.p] && shapesIn(ps[r.p])[r.s]);
	if (!refs.length) return;
	mutate(() => {
		for (const r of refs) moveShape(shapesIn(ps[r.p])[r.s], localDelta(r.p, d, w));
	}, "nudge");
}

/** Enter closes a polygon in progress. */
export function polyEnter() {
	commitPoly();
}

/** Esc: deselect, drop the poly in progress, disarm the crosshair. */
export function escape() {
	selClear();
	ed.colSel.value = -1;
	ed.polyPts.value = [];
	ed.pending.value = "none";
	cancelGesture();
}

export function primaryRef(): Ref | null {
	return primary();
}

export { curState };
