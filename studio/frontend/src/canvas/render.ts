// The canvas frame: grid, the art (at rest or posed, dimmed under the
// collision lens), then the overlays that only the editor sees: hover and
// selection outlines, handles, the selection box and its grips, pivots
// and anchors, the pose lever, the marquee, and whatever is being drawn.

import { cssColor, colorOf, posePoint, poseOf, type Shape, type Vec2 } from "@fastart/core";
import { view } from "./view.ts";
import { drawDoc, fillShape, outlineShape, tracePoly, ident, type Map2 } from "./draw.ts";
import { ix, handlesOf, scaleGrips, poseLever } from "./interact.ts";
import { ed, curPart, curState, curTokName, selShapes, selShape, shapeAt, colShape, poseOfCur } from "../state/editor.ts";

const ACCENT = "#ffc85c";
const HOVER = "rgba(255,255,255,0.45)";
const TEAL = "#6cc7c0";

export function render(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number) {
	const [px, py] = view.pan.value;
	const zoom = view.zoom.value;
	const world = () => ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, (W / 2 - px * zoom) * dpr, (H / 2 - py * zoom) * dpr);
	const screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const toS = (p: Vec2): Vec2 => [(p[0] - px) * zoom + W / 2, (p[1] - py) * zoom + H / 2];

	screen();
	ctx.fillStyle = "#121213";
	ctx.fillRect(0, 0, W, H);
	drawGrid(ctx, W, H, px, py, zoom);

	const doc = ed.doc.value;
	const tokens = ed.tokens.value;
	const st = curState();
	const collide = ed.collide.value;

	world();
	drawDoc(ctx, doc, tokens, { state: st?.name, alpha: collide ? 0.22 : 1 });

	if (collide) {
		// the lens: solids the game may honour, never drawn by it
		const sel = ed.colSel.value;
		(doc.collision ?? []).forEach((sh, i) => {
			ctx.globalAlpha = i === sel ? 0.5 : 0.3;
			fillShape(ctx, sh, TEAL);
			ctx.globalAlpha = 1;
			outlineShape(ctx, sh, i === sel ? ACCENT : "rgba(108,199,192,0.8)", i === sel ? 1.5 : 1, zoom);
		});
		const cs = colShape();
		if (cs) drawHandles(ctx, handlesOf(cs).map(toS), screen, world);
	} else if (st) {
		// pose mode: outline the current part where it lands, and its lever
		const part = curPart();
		const sp = poseOfCur();
		if (part && sp) {
			const map: Map2 = (p) => posePoint(p, part, sp);
			const scale = poseOf(sp, part).scale;
			for (const sh of part.shapes ?? []) outlineShape(ctx, sh, ACCENT, 1, zoom, map, scale);
			const off = sp.offset ?? part.pivot ?? [0, 0];
			const lever = poseLever();
			screen();
			const o = toS(off);
			crosshair(ctx, o, ACCENT);
			if (lever) {
				const l = toS(lever);
				ctx.strokeStyle = ACCENT;
				ctx.lineWidth = 1.5;
				ctx.beginPath();
				ctx.moveTo(o[0], o[1]);
				ctx.lineTo(l[0], l[1]);
				ctx.stroke();
				ctx.fillStyle = ACCENT;
				ctx.beginPath();
				ctx.arc(l[0], l[1], 5, 0, Math.PI * 2);
				ctx.fill();
			}
			world();
		}
	} else {
		// geometry mode: hover, selection, handles, the box
		const hov = ed.hover.value;
		const hs = shapeAt(hov);
		if (hs && !ed.sel.value.some((r) => r.p === hov!.p && r.s === hov!.s)) outlineShape(ctx, hs, HOVER, 1, zoom);
		for (const sh of selShapes()) outlineShape(ctx, sh, ACCENT, 1.5, zoom);
		const prim = selShape();
		if (prim) drawHandles(ctx, handlesOf(prim).map(toS), screen, world);
		const grips = scaleGrips();
		if (grips.length && ed.sel.value.length) {
			screen();
			const a = toS(grips[0].at);
			const c = toS(grips[2].at);
			ctx.strokeStyle = "rgba(255,200,92,0.35)";
			ctx.lineWidth = 1;
			ctx.setLineDash([4, 4]);
			ctx.strokeRect(a[0], a[1], c[0] - a[0], c[1] - a[1]);
			ctx.setLineDash([]);
			for (const g of grips) {
				const s = toS(g.at);
				ctx.fillStyle = "#1d1d1f";
				ctx.strokeStyle = ACCENT;
				ctx.beginPath();
				ctx.rect(s[0] - 4, s[1] - 4, 8, 8);
				ctx.fill();
				ctx.stroke();
			}
			world();
		}
		// the current part's pivot and anchors
		const part = curPart();
		if (part) {
			screen();
			crosshair(ctx, toS(part.pivot ?? [0, 0]), "rgba(255,200,92,0.7)");
			for (const a of part.anchors ?? []) {
				const s = toS(a.at);
				diamond(ctx, s, "rgba(108,199,192,0.9)");
				ctx.fillStyle = "rgba(108,199,192,0.9)";
				ctx.font = "11px system-ui, sans-serif";
				ctx.fillText(a.name, s[0] + 8, s[1] - 6);
			}
			world();
		}
	}

	// in progress: a rubber band, a shape being drawn, a polygon's path
	const cur = ix.cursor;
	if (ix.marquee && cur) {
		screen();
		const a = toS(ix.mqA);
		const b = toS(cur);
		ctx.fillStyle = "rgba(255,200,92,0.06)";
		ctx.strokeStyle = "rgba(255,200,92,0.5)";
		ctx.lineWidth = 1;
		ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
		ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
		world();
	}
	if (ix.drawing && cur) {
		const tool = ed.tool.value;
		const css = collide ? TEAL : cssColor(colorOf(tokens, curTokName()));
		ctx.globalAlpha = 0.6;
		let sh: Shape | null = null;
		if (tool === "circle") sh = { kind: "circle", at: ix.drawA, r: Math.hypot(cur[0] - ix.drawA[0], cur[1] - ix.drawA[1]) };
		else if (tool === "line") sh = { kind: "line", a: ix.drawA, b: cur, w: collide ? 6 : 1.4 };
		else if (tool === "rect") {
			const lo: Vec2 = [Math.min(ix.drawA[0], cur[0]), Math.min(ix.drawA[1], cur[1])];
			const hi: Vec2 = [Math.max(ix.drawA[0], cur[0]), Math.max(ix.drawA[1], cur[1])];
			sh = { kind: "poly", points: [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]] };
		}
		if (sh) fillShape(ctx, sh, css);
		ctx.globalAlpha = 1;
	}
	const pts = ed.polyPts.value;
	if (pts.length) {
		const css = collide ? TEAL : cssColor(colorOf(tokens, curTokName()));
		if (pts.length >= 3) {
			ctx.globalAlpha = 0.35;
			tracePoly(ctx, pts, ident);
			ctx.fillStyle = css;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		screen();
		ctx.strokeStyle = css;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		pts.forEach((q, i) => {
			const s = toS(q);
			if (i === 0) ctx.moveTo(s[0], s[1]);
			else ctx.lineTo(s[0], s[1]);
		});
		if (cur) {
			const s = toS(cur);
			ctx.lineTo(s[0], s[1]);
		}
		ctx.stroke();
		const first = toS(pts[0]);
		ctx.fillStyle = pts.length >= 3 && cur && Math.hypot(toS(cur)[0] - first[0], toS(cur)[1] - first[1]) < 10 ? ACCENT : css;
		ctx.beginPath();
		ctx.arc(first[0], first[1], 5, 0, Math.PI * 2);
		ctx.fill();
		world();
	}
	if (ed.pending.value !== "none" && cur) {
		screen();
		crosshair(ctx, toS(cur), ACCENT, 14);
		world();
	}
	screen();
}

function drawHandles(ctx: CanvasRenderingContext2D, pts: Vec2[], screen: () => void, world: () => void) {
	screen();
	for (const s of pts) {
		ctx.fillStyle = "#1d1d1f";
		ctx.strokeStyle = ACCENT;
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc(s[0], s[1], 4.5, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
	}
	world();
}

function crosshair(ctx: CanvasRenderingContext2D, s: Vec2, css: string, r = 8) {
	ctx.strokeStyle = css;
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(s[0] - r, s[1]);
	ctx.lineTo(s[0] + r, s[1]);
	ctx.moveTo(s[0], s[1] - r);
	ctx.lineTo(s[0], s[1] + r);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(s[0], s[1], 3, 0, Math.PI * 2);
	ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, s: Vec2, css: string) {
	ctx.fillStyle = css;
	ctx.beginPath();
	ctx.moveTo(s[0], s[1] - 5);
	ctx.lineTo(s[0] + 5, s[1]);
	ctx.lineTo(s[0], s[1] + 5);
	ctx.lineTo(s[0] - 5, s[1]);
	ctx.closePath();
	ctx.fill();
}

function drawGrid(ctx: CanvasRenderingContext2D, W: number, H: number, px: number, py: number, zoom: number) {
	// a step that stays between 24 and 120 pixels
	let step = 1;
	while (step * zoom < 24) step *= step === 1 ? 5 : 2;
	while (step * zoom > 120 && step > 1) step /= step % 5 === 0 ? 5 : 2;
	const x0 = px - W / 2 / zoom;
	const y0 = py - H / 2 / zoom;
	const x1 = px + W / 2 / zoom;
	const y1 = py + H / 2 / zoom;
	ctx.lineWidth = 1;
	ctx.strokeStyle = "rgba(255,255,255,0.045)";
	ctx.beginPath();
	for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
		const sx = Math.round((x - px) * zoom + W / 2) + 0.5;
		ctx.moveTo(sx, 0);
		ctx.lineTo(sx, H);
	}
	for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
		const sy = Math.round((y - py) * zoom + H / 2) + 0.5;
		ctx.moveTo(0, sy);
		ctx.lineTo(W, sy);
	}
	ctx.stroke();
	// the axes
	ctx.strokeStyle = "rgba(255,255,255,0.12)";
	ctx.beginPath();
	const ax = Math.round(-px * zoom + W / 2) + 0.5;
	const ay = Math.round(-py * zoom + H / 2) + 0.5;
	ctx.moveTo(ax, 0);
	ctx.lineTo(ax, H);
	ctx.moveTo(0, ay);
	ctx.lineTo(W, ay);
	ctx.stroke();
}

