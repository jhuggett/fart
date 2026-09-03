// The camera: world units to screen pixels. The canvas centre is where
// `pan` lands; `zoom` is pixels per unit.

import { signal } from "@preact/signals";
import type { Vec2 } from "@fastart/core";

export const view = {
	pan: signal<Vec2>([0, 0]),
	zoom: signal(10),
};

export function toScreen(p: Vec2, W: number, H: number): Vec2 {
	const [px, py] = view.pan.value;
	const z = view.zoom.value;
	return [(p[0] - px) * z + W / 2, (p[1] - py) * z + H / 2];
}

export function toWorld(s: Vec2, W: number, H: number): Vec2 {
	const [px, py] = view.pan.value;
	const z = view.zoom.value;
	return [(s[0] - W / 2) / z + px, (s[1] - H / 2) / z + py];
}

/** Zoom by a factor, keeping the world point under the cursor still. */
export function zoomAt(factor: number, cursor: Vec2, W: number, H: number) {
	const before = toWorld(cursor, W, H);
	view.zoom.value = Math.min(120, Math.max(0.5, view.zoom.value * factor));
	const after = toWorld(cursor, W, H);
	const [px, py] = view.pan.value;
	view.pan.value = [px + before[0] - after[0], py + before[1] - after[1]];
}
