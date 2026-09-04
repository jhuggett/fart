// The canvas element: sizes itself, routes pointer events into
// interact.ts, and redraws whenever the store or the view moves. Right or
// middle drag pans; a wheel pans; Cmd/Ctrl+wheel (a pinch, on a trackpad)
// zooms about the cursor. On a touch screen one finger draws and two pan
// and pinch; a pen is a mouse.

import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import type { Vec2 } from "@fastart/core";
import { view, toWorld, zoomAt } from "./view.ts";
import { render } from "./render.ts";
import { onDown, onMove, onUp, cancelGesture, ix, pick } from "./interact.ts";
import { ed, selHas, selOnly, curState, curClip } from "../state/editor.ts";
import { theme } from "../state/theme.ts";
import { openContextMenu } from "../state/menu.ts";
import { run, keysFor } from "../state/commands.ts";

export function Canvas() {
	const ref = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = ref.current!;
		const ctx = canvas.getContext("2d")!;
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
			view.size.value = [W, H];
			draw();
		};
		const draw = () => {
			raf = 0;
			if (W && H) render(ctx, W, H, dpr);
		};
		const request = () => {
			if (!raf) raf = requestAnimationFrame(draw);
		};
		const ro = new ResizeObserver(size);
		ro.observe(canvas);
		size();
		const stop = effect(() => {
			// read everything a frame depends on, so the effect re-runs on it
			void ed.rev.value;
			void ed.sel.value;
			void ed.hover.value;
			void ed.curPart.value;
			void ed.curState.value;
			void ed.collide.value;
			void ed.colSel.value;
			void ed.pending.value;
			void ed.polyPts.value;
			void ed.tool.value;
			void ed.curClip.value;
			void ed.clipTime.value;
			void ed.curKey.value;
			void view.pan.value;
			void view.zoom.value;
			void view.snapGrid.value;
			void theme.rev.value;
			request();
		});

		// pointers: which are down, for the two-finger gesture
		const touches = new Map<number, Vec2>();
		let panning = false;
		let panLast: Vec2 = [0, 0];
		let pinchMid: Vec2 | null = null;
		let pinchDist = 0;

		const local = (e: PointerEvent): Vec2 => {
			const r = canvas.getBoundingClientRect();
			return [e.clientX - r.left, e.clientY - r.top];
		};
		const mods = (e: PointerEvent) => ({ shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey || e.ctrlKey });

		// right-click: the short list for what is under the cursor
		const menu = (e: PointerEvent, s: Vec2) => {
			e.preventDefault();
			const wm = toWorld(s, W, H);
			const items = [];
			if (!ed.collide.value && !curState() && !curClip()) {
				const hit = pick(wm);
				if (hit && !selHas(hit)) selOnly(hit);
				const some = ed.sel.value.length > 0;
				items.push(
					{ label: "Duplicate", keys: keysFor("edit.duplicate"), disabled: !some, run: () => run("edit.duplicate") },
					{ label: "Copy", keys: keysFor("edit.copy"), disabled: !some, run: () => run("edit.copy") },
					{ label: "Paste", keys: keysFor("edit.paste"), run: () => run("edit.paste") },
					{ label: "Raise", keys: "]", disabled: !some, sep: true, run: () => run("edit.raise") },
					{ label: "Lower", keys: "[", disabled: !some, run: () => run("edit.lower") },
					{ label: "Delete", keys: "⌫", disabled: !some, danger: true, sep: true, run: () => run("edit.delete") },
				);
			}
			items.push(
				{ label: "Zoom to fit", keys: keysFor("view.fit"), sep: items.length > 0, run: () => run("view.fit") },
				{ label: `Snap to grid ${view.snapGrid.value ? "off" : "on"}`, keys: keysFor("view.snapGrid"), run: () => run("view.snapGrid") },
			);
			openContextMenu(e.clientX, e.clientY, items);
		};

		const twoFinger = () => {
			const [a, b] = [...touches.values()];
			return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as Vec2, d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
		};

		const down = (e: PointerEvent) => {
			canvas.setPointerCapture(e.pointerId);
			const s = local(e);
			if (e.pointerType === "touch") {
				touches.set(e.pointerId, s);
				if (touches.size === 2) {
					cancelGesture();
					const t = twoFinger();
					pinchMid = t.mid;
					pinchDist = t.d;
					return;
				}
				if (touches.size > 2) return;
			}
			if (e.button === 2) return menu(e, s);
			if (e.button === 1 || (e.button === 0 && ix.space)) {
				panning = true;
				panLast = s;
				canvas.classList.add("grab");
				return;
			}
			if (e.button !== 0) return;
			onDown(toWorld(s, W, H), mods(e));
			request();
		};
		const move = (e: PointerEvent) => {
			const s = local(e);
			if (e.pointerType === "touch" && touches.has(e.pointerId)) {
				touches.set(e.pointerId, s);
				if (touches.size >= 2 && pinchMid) {
					const t = twoFinger();
					const z = view.zoom.value;
					const [px, py] = view.pan.value;
					view.pan.value = [px - (t.mid[0] - pinchMid[0]) / z, py - (t.mid[1] - pinchMid[1]) / z];
					if (pinchDist > 1 && t.d > 1) zoomAt(t.d / pinchDist, t.mid, W, H);
					pinchMid = t.mid;
					pinchDist = t.d;
					return;
				}
			}
			if (panning) {
				const z = view.zoom.value;
				const [px, py] = view.pan.value;
				view.pan.value = [px - (s[0] - panLast[0]) / z, py - (s[1] - panLast[1]) / z];
				panLast = s;
				return;
			}
			onMove(toWorld(s, W, H), mods(e));
			request();
		};
		const up = (e: PointerEvent) => {
			const s = local(e);
			if (e.pointerType === "touch") {
				touches.delete(e.pointerId);
				if (pinchMid) {
					if (touches.size < 2) pinchMid = null;
					return;
				}
			}
			if (panning) {
				panning = false;
				canvas.classList.remove("grab");
				return;
			}
			if (ix.down) onUp(toWorld(s, W, H), mods(e));
			request();
		};
		const leave = () => {
			ix.cursor = null;
			if (ed.hover.value) ed.hover.value = null;
			request();
		};
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = canvas.getBoundingClientRect();
			const s: Vec2 = [e.clientX - r.left, e.clientY - r.top];
			if (e.ctrlKey || e.metaKey) {
				zoomAt(Math.exp(-e.deltaY * 0.01), s, W, H);
			} else {
				const z = view.zoom.value;
				const [px, py] = view.pan.value;
				view.pan.value = [px + e.deltaX / z, py + e.deltaY / z];
			}
		};
		const ctxmenu = (e: Event) => e.preventDefault();

		canvas.addEventListener("pointerdown", down);
		canvas.addEventListener("pointermove", move);
		canvas.addEventListener("pointerup", up);
		canvas.addEventListener("pointercancel", up);
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
			canvas.removeEventListener("pointercancel", up);
			canvas.removeEventListener("pointerleave", leave);
			canvas.removeEventListener("wheel", wheel);
			canvas.removeEventListener("contextmenu", ctxmenu);
		};
	}, []);

	return <canvas ref={ref} class={ed.tool.value === "select" ? "select" : ""} />;
}
