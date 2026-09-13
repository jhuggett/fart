// The model canvas element: sizes itself, routes the pointer into
// model3.ts, and redraws when the store or the view moves. Middle drag
// (or Space) pans, a wheel pans, Cmd/Ctrl+wheel zooms; a left drag on
// nothing, or Alt+drag anywhere, orbits the model.

import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import type { Vec2 } from "@fastart/core";
import { view, toWorld, zoomAt } from "./view.ts";
import { render3, renderGround, onDown, onMove, onUp, cancelGesture, ix3, orbitDrag } from "./model3.ts";
import { drawSolids } from "./gl3.ts";
import { md, frameParts } from "../state/model.ts";
import { theme } from "../state/theme.ts";
import { openContextMenu } from "../state/menu.ts";
import { run, keysFor } from "../state/commands.ts";

export function ModelCanvas() {
	const ref = useRef<HTMLCanvasElement>(null);
	const groundRef = useRef<HTMLCanvasElement>(null);
	const glRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current!;
		const ground = groundRef.current!;
		const glCanvas = glRef.current!;
		const ctx = canvas.getContext("2d")!;
		const gctx = ground.getContext("2d")!;
		let W = 0;
		let H = 0;
		let dpr = window.devicePixelRatio || 1;
		let raf = 0;
		const size = () => {
			dpr = window.devicePixelRatio || 1;
			W = canvas.clientWidth;
			H = canvas.clientHeight;
			canvas.width = Math.round(W * dpr);
			canvas.height = Math.round(H * dpr);
			ground.width = canvas.width;
			ground.height = canvas.height;
			view.size.value = [W, H];
			draw();
		};
		const draw = () => {
			raf = 0;
			if (!W || !H) return;
			renderGround(gctx, W, H, dpr);
			const solid = drawSolids(glCanvas, md.doc.value, frameParts(), md.tokens.value, md.light.value, md.ambient.value, { W, H, dpr, pan: view.pan.value, zoom: view.zoom.value });
			render3(ctx, W, H, dpr, !solid);
		};
		const request = () => {
			if (!raf) raf = requestAnimationFrame(draw);
		};
		const ro = new ResizeObserver(size);
		ro.observe(canvas);
		size();
		const stop = effect(() => {
			void md.rev.value;
			void md.sel.value;
			void md.vert.value;
			void md.hover.value;
			void md.curPart.value;
			void md.curState.value;
			void md.curClip.value;
			void md.clipTime.value;
			void md.polyPts.value;
			void md.tool.value;
			void md.turn.value;
			void md.light.value;
			void md.ambient.value;
			void md.outline.value;
			void md.pending.value;
			void view.pan.value;
			void view.zoom.value;
			void view.snapGrid.value;
			void theme.rev.value;
			request();
		});
		let panning = false;
		let panLast: Vec2 = [0, 0];
		let orbiting = false;
		let orbitLast: Vec2 = [0, 0];
		const local = (e: PointerEvent): Vec2 => {
			const r = canvas.getBoundingClientRect();
			return [e.clientX - r.left, e.clientY - r.top];
		};
		const mods = (e: PointerEvent) => ({ shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey || e.ctrlKey });
		const menu = (e: PointerEvent) => {
			e.preventDefault();
			const some = !!md.sel.value;
			openContextMenu(e.clientX, e.clientY, [
				{ label: "Duplicate", keys: keysFor("edit.duplicate"), disabled: some ? false : true, run: () => run("edit.duplicate") },
				{ label: "Mirror across x", disabled: !some, run: () => run("model.mirror") },
				{ label: "Delete", keys: "⌫", disabled: !some, danger: true, sep: true, run: () => run("edit.delete") },
				{ label: "Front", sep: true, run: () => run("view.front") },
				{ label: "Left", run: () => run("view.left") },
				{ label: "Right", run: () => run("view.right") },
				{ label: "Top", run: () => run("view.top") },
				{ label: "Zoom to fit", keys: keysFor("view.fit"), sep: true, run: () => run("view.fit") },
			]);
		};
		const down = (e: PointerEvent) => {
			canvas.setPointerCapture(e.pointerId);
			const s = local(e);
			if (e.button === 2) return menu(e);
			if (e.button === 1 || (e.button === 0 && md.space)) {
				panning = true;
				panLast = s;
				canvas.classList.add("grab");
				return;
			}
			if (e.button !== 0) return;
			if (e.altKey) {
				orbiting = true;
				orbitLast = s;
				return;
			}
			onDown(toWorld(s, W, H), mods(e));
			request();
		};
		const move = (e: PointerEvent) => {
			const s = local(e);
			if (panning) {
				const z = view.zoom.value;
				const [px, py] = view.pan.value;
				view.pan.value = [px - (s[0] - panLast[0]) / z, py - (s[1] - panLast[1]) / z];
				panLast = s;
				return;
			}
			if (orbiting) {
				orbitDrag(s[0] - orbitLast[0], s[1] - orbitLast[1]);
				orbitLast = s;
				return;
			}
			onMove(toWorld(s, W, H), mods(e));
			request();
		};
		const up = (e: PointerEvent) => {
			const s = local(e);
			if (panning) {
				panning = false;
				canvas.classList.remove("grab");
				return;
			}
			if (orbiting) {
				orbiting = false;
				return;
			}
			if (ix3.down) onUp(toWorld(s, W, H), mods(e));
			request();
		};
		const leave = () => {
			ix3.cursor = null;
			if (md.hover.value) md.hover.value = null;
			request();
		};
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = canvas.getBoundingClientRect();
			const s: Vec2 = [e.clientX - r.left, e.clientY - r.top];
			if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), s, W, H);
			else {
				const z = view.zoom.value;
				const [px, py] = view.pan.value;
				view.pan.value = [px + e.deltaX / z, py + e.deltaY / z];
			}
		};
		const ctxmenu = (e: Event) => e.preventDefault();
		canvas.addEventListener("pointerdown", down);
		canvas.addEventListener("pointermove", move);
		canvas.addEventListener("pointerup", up);
		canvas.addEventListener("pointercancel", () => cancelGesture());
		canvas.addEventListener("pointerleave", leave);
		canvas.addEventListener("wheel", wheel, { passive: false });
		canvas.addEventListener("contextmenu", ctxmenu);
		return () => {
			ro.disconnect();
			stop();
			if (raf) cancelAnimationFrame(raf);
			canvas.removeEventListener("pointerdown", down);
			canvas.removeEventListener("pointermove", move);
			canvas.removeEventListener("pointerup", up);
			canvas.removeEventListener("pointerleave", leave);
			canvas.removeEventListener("wheel", wheel);
			canvas.removeEventListener("contextmenu", ctxmenu);
		};
	}, []);
	return (
		<>
			<canvas ref={groundRef} class="under" />
			<canvas ref={glRef} class="under" />
			<canvas ref={ref} class={md.tool.value === "select" ? "select" : ""} />
		</>
	);
}
