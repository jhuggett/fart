// The scene canvas element: the ground, the WebGL solids (3D scenes), and
// the overlay that takes the pointer.

import { useEffect, useRef } from "preact/hooks";
import { effect } from "@preact/signals";
import type { Vec2 } from "@fastart/core";
import { viewXf3 } from "@fastart/core";
import { view, toWorld } from "./view.ts";
import { wheelNav } from "./orbit.ts";
import { gizmoCancel, modal3, useGizmo } from "./gizmo3.ts";
import { sceneGizmo } from "./sceneGizmo.ts";
import { renderScene, renderSceneGround, sceneLayers, onDown, onMove, onUp, cancelGesture, sx, orbitDrag, orbitStart } from "./scene3.ts";
import { drawLayers } from "./gl3.ts";
import { sc, is3d } from "../state/scene.ts";
import { theme } from "../state/theme.ts";
import { openContextMenu } from "../state/menu.ts";
import { run, keysFor } from "../state/commands.ts";

export function SceneCanvas() {
	const ref = useRef<HTMLCanvasElement>(null);
	const groundRef = useRef<HTMLCanvasElement>(null);
	const glRef = useRef<HTMLCanvasElement>(null);
	useGizmo(sceneGizmo);
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
			renderSceneGround(gctx, W, H, dpr);
			let solid = false;
			if (is3d()) solid = drawLayers(glCanvas, sceneLayers(), sc.light.value, sc.ambient.value, { W, H, dpr, pan: view.pan.value, zoom: view.zoom.value, turn: viewXf3(sc.turn.value) });
			else {
				const gl = glCanvas.getContext("webgl");
				gl?.clear(gl.COLOR_BUFFER_BIT);
			}
			renderScene(ctx, W, H, dpr, is3d() && !solid);
		};
		const request = () => {
			if (!raf) raf = requestAnimationFrame(draw);
		};
		const ro = new ResizeObserver(size);
		ro.observe(canvas);
		size();
		const stop = effect(() => {
			void sc.rev.value;
			void sc.sel.value;
			void sc.also.value;
			void modal3.value;
			void sc.hover.value;
			void sc.time.value;
			void sc.turn.value;
			void sc.loaded.value;
			void sc.patterns.value;
			void view.pan.value;
			void view.zoom.value;
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
		const mods = (e: PointerEvent) => ({ shift: e.shiftKey, alt: e.altKey });
		const menu = (e: PointerEvent) => {
			e.preventDefault();
			const some = !!sc.sel.value;
			openContextMenu(e.clientX, e.clientY, [
				{ label: "Duplicate", keys: keysFor("edit.duplicate"), disabled: !some, run: () => run("edit.duplicate") },
				{ label: "Raise (paints later)", keys: "]", disabled: !some, run: () => run("edit.raise") },
				{ label: "Lower (paints earlier)", keys: "[", disabled: !some, run: () => run("edit.lower") },
				{ label: "Delete", keys: "⌫", disabled: !some, danger: true, sep: true, run: () => run("edit.delete") },
				{ label: "Zoom to fit", keys: keysFor("view.fit"), sep: true, run: () => run("view.fit") },
			]);
		};
		const down = (e: PointerEvent) => {
			canvas.setPointerCapture(e.pointerId);
			const s = local(e);
			// a right click puts a transform under way back, before it is a menu
			if (e.button === 2) return gizmoCancel() ? (e.preventDefault(), request()) : menu(e);
			// in a 3D scene the middle button orbits (⇧ pans); in a 2D one it pans
			if (is3d() && ((e.button === 1 && !e.shiftKey) || (e.button === 0 && e.altKey))) {
				orbiting = true;
				orbitLast = s;
				orbitStart();
				canvas.classList.add("grab");
				return;
			}
			if (e.button === 1 || (e.button === 0 && sc.space)) {
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
			if (panning) {
				const z = view.zoom.value;
				const [px, py] = view.pan.value;
				view.pan.value = [px - (s[0] - panLast[0]) / z, py - (s[1] - panLast[1]) / z];
				panLast = s;
				return;
			}
			if (orbiting) {
				orbitDrag(s[0] - orbitLast[0], s[1] - orbitLast[1], e.metaKey || e.ctrlKey);
				orbitLast = s;
				return;
			}
			onMove(toWorld(s, W, H), mods(e));
			request();
		};
		const up = (e: PointerEvent) => {
			if (orbiting) {
				orbiting = false;
				canvas.classList.remove("grab");
				return;
			}
			if (panning) {
				panning = false;
				canvas.classList.remove("grab");
				return;
			}
			if (sx.down) onUp(toWorld(local(e), W, H), e.shiftKey);
			request();
		};
		const leave = () => {
			sx.cursor = null;
			if (sc.hover.value) sc.hover.value = null;
			request();
		};
		const wheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = canvas.getBoundingClientRect();
			const s: Vec2 = [e.clientX - r.left, e.clientY - r.top];
			wheelNav(e, s, W, H, is3d() ? orbitDrag : undefined);
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
			<canvas ref={ref} class="select" />
		</>
	);
}
