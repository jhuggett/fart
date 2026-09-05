// Drawing a document onto a Canvas2D context. Fifty lines is the promise
// of the format, and this is roughly that plus outlines. Everything takes
// a `map` so the same code draws rest space and a posed state.

import { canvasColors } from "../state/theme.ts";
import { colorOf, cssColor, docBounds, drawList, xfApply, type Doc, type Shape, type StatePart, type Token, type Vec2, shapesOf } from "@fastart/core";

export type Map2 = (p: Vec2) => Vec2;
export const ident: Map2 = (p) => p;
const TAU = Math.PI * 2;

export function tracePoly(ctx: CanvasRenderingContext2D, pts: readonly Vec2[], map: Map2) {
	ctx.beginPath();
	pts.forEach((q, i) => {
		const m = map(q);
		if (i === 0) ctx.moveTo(m[0], m[1]);
		else ctx.lineTo(m[0], m[1]);
	});
	ctx.closePath();
}

export function fillShape(ctx: CanvasRenderingContext2D, sh: Shape, css: string, map: Map2 = ident, scale = 1) {
	ctx.fillStyle = css;
	ctx.strokeStyle = css;
	switch (sh.kind) {
		case "circle": {
			const c = map(sh.at);
			ctx.beginPath();
			ctx.arc(c[0], c[1], Math.max(sh.r * scale, 0), 0, TAU);
			ctx.fill();
			break;
		}
		case "line": {
			if (sh.w <= 0) return;
			const a = map(sh.a);
			const b = map(sh.b);
			ctx.lineWidth = sh.w * scale;
			ctx.lineCap = "round";
			ctx.beginPath();
			ctx.moveTo(a[0], a[1]);
			ctx.lineTo(b[0], b[1]);
			ctx.stroke();
			break;
		}
		case "poly": {
			if (sh.points.length < 3) return;
			tracePoly(ctx, sh.points, map);
			ctx.fill();
			break;
		}
	}
}

/** A constant-pixel outline around a shape's paint. `px` is in screen pixels. */
export function outlineShape(
	ctx: CanvasRenderingContext2D,
	sh: Shape,
	css: string,
	px: number,
	zoom: number,
	map: Map2 = ident,
	scale = 1,
) {
	ctx.strokeStyle = css;
	ctx.lineWidth = px / zoom;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	switch (sh.kind) {
		case "circle": {
			const c = map(sh.at);
			ctx.beginPath();
			ctx.arc(c[0], c[1], sh.r * scale + px / zoom, 0, TAU);
			ctx.stroke();
			break;
		}
		case "line": {
			const a = map(sh.a);
			const b = map(sh.b);
			ctx.lineWidth = Math.max(sh.w * scale * 0.2, 1.5 / zoom);
			ctx.beginPath();
			ctx.moveTo(a[0], a[1]);
			ctx.lineTo(b[0], b[1]);
			ctx.stroke();
			break;
		}
		case "poly": {
			if (sh.points.length < 2) return;
			tracePoly(ctx, sh.points, map);
			ctx.stroke();
			break;
		}
	}
}

export interface DrawOptions {
	/** A state name or a pose list (a clip frame); absent draws every part at rest. */
	pose?: string | readonly StatePart[];
	alpha?: number;
}

/** The whole picture, in world units (set the transform first). */
export function drawDoc(ctx: CanvasRenderingContext2D, doc: Doc, tokens: readonly Token[], opts: DrawOptions = {}) {
	ctx.globalAlpha = opts.alpha ?? 1;
	for (const { part, xf, scale } of drawList(doc, opts.pose)) {
		const map: Map2 = (p) => xfApply(xf, p);
		for (const sh of shapesOf(doc, part)) {
			fillShape(ctx, sh, cssColor(colorOf(tokens, sh.color ?? "")), map, scale);
		}
	}
	ctx.globalAlpha = 1;
}

/**
 * A PNG of the document (a state, a clip frame, or all parts at rest),
 * fitted, on the theme's ground: what Claude sees when it asks to look.
 * Returns base64 without the data-URL prefix.
 */
export function renderPNG(doc: Doc, tokens: readonly Token[], pose: string | readonly StatePart[] | undefined, size = 512): string {
	// bounds of what will be drawn, through each part's transform
	let lo: Vec2 = [Infinity, Infinity];
	let hi: Vec2 = [-Infinity, -Infinity];
	const take = (p: Vec2) => {
		lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1])];
		hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1])];
	};
	for (const { part, xf, scale } of drawList(doc, pose)) {
		for (const sh of shapesOf(doc, part)) {
			if (sh.kind === "circle") {
				const c = xfApply(xf, sh.at);
				take([c[0] - sh.r * scale, c[1] - sh.r * scale]);
				take([c[0] + sh.r * scale, c[1] + sh.r * scale]);
			} else if (sh.kind === "line") {
				for (const q of [sh.a, sh.b]) {
					const c = xfApply(xf, q);
					take([c[0] - sh.w * scale, c[1] - sh.w * scale]);
					take([c[0] + sh.w * scale, c[1] + sh.w * scale]);
				}
			} else for (const q of sh.points) take(xfApply(xf, q));
		}
	}
	if (!Number.isFinite(lo[0])) {
		lo = [-10, -10];
		hi = [10, 10];
	}
	const w = Math.max(hi[0] - lo[0], 1);
	const h = Math.max(hi[1] - lo[1], 1);
	const pad = 0.12;
	const zoom = (size * (1 - 2 * pad)) / Math.max(w, h);
	const W = Math.round(w * zoom + size * 2 * pad);
	const H = Math.round(h * zoom + size * 2 * pad);
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--canvas").trim() || "#1a1a1c";
	ctx.fillRect(0, 0, W, H);
	ctx.save();
	ctx.translate(W / 2 - ((lo[0] + hi[0]) / 2) * zoom, H / 2 - ((lo[1] + hi[1]) / 2) * zoom);
	ctx.scale(zoom, zoom);
	drawDoc(ctx, doc, tokens, { pose });
	ctx.restore();
	return canvas.toDataURL("image/png").split(",")[1];
}

/**
 * A thumbnail: the art fitted into the canvas, wearing its first state
 * (all-parts overlays lit-and-out, item-and-prop at once). A rig with no
 * art yet lists the parts it wants; a palette shows its swatches.
 */
export function drawThumb(canvas: HTMLCanvasElement, doc: Doc, tokens: readonly Token[]) {
	const dpr = window.devicePixelRatio || 1;
	const w = canvas.clientWidth;
	const h = canvas.clientHeight;
	if (!w || !h) return;
	if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, w, h);
	const b = docBounds(doc);
	if (b) {
		const bw = Math.max(b.hi[0] - b.lo[0], 0.001);
		const bh = Math.max(b.hi[1] - b.lo[1], 0.001);
		const s = Math.min((w - 16) / bw, (h - 16) / bh);
		const mid: Vec2 = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2];
		ctx.setTransform(s * dpr, 0, 0, s * dpr, (w / 2 - mid[0] * s) * dpr, (h / 2 - mid[1] * s) * dpr);
		drawDoc(ctx, doc, tokens, { pose: doc.states?.[0]?.name });
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		return;
	}
	ctx.font = "11px system-ui, sans-serif";
	const C = canvasColors();
	if (doc.parts?.length) {
		ctx.fillStyle = C.text3;
		ctx.fillText("awaiting art:", 10, 18);
		ctx.fillStyle = C.text2;
		let y = 34;
		for (const p of doc.parts) {
			if (y > h - 6) break;
			ctx.fillText(p.name, 18, y);
			y += 15;
		}
		return;
	}
	let x = 10;
	const y = h / 2 - 9;
	for (const tk of doc.palette ?? []) {
		if (x + 20 > w - 8) break;
		ctx.fillStyle = cssColor(tk.rgb);
		ctx.beginPath();
		ctx.roundRect(x, y, 18, 18, 4);
		ctx.fill();
		x += 22;
	}
}
