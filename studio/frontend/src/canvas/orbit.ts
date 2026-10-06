// Turning a 3D view the way 3D tools do. The orbit is a turntable: a
// sideways drag spins the model about the world's up axis, an up-down
// drag tilts the view, and the horizon never rolls or flips over. (The
// old free tumble, yaw and pitch both in view space, is still there for
// when a model has to be looked at askew.) The wheel tells a mouse from a
// trackpad: a mouse wheel zooms at the cursor, two fingers turn the view
// (⇧ pans), a pinch zooms.

import { quatMul, quatAxis, quatFromEuler, quatToEuler, viewXf3, xf3ApplyDir, VIEWS, type Vec2, type Vec3 } from "@fastart/core";
import { view, zoomAt } from "./view.ts";

const UP: Vec3 = [0, 1, 0];
/** where the world's up axis points on the canvas (its y): the sign is which way up the view is */
const upright = (turn: Vec3) => xf3ApplyDir(viewXf3(turn), UP)[1];

/** A view turned by a yaw and a pitch. `free` tumbles in view space; otherwise it is a turntable. */
export function turned(turn: Vec3, yaw: number, pitch: number, free = false): Vec3 {
	const q = quatFromEuler(turn);
	if (free) return quatToEuler(quatMul(quatAxis([1, 0, 0], pitch), quatMul(quatAxis([0, 1, 0], yaw), q)));
	// yaw about the world's own up axis, pitch about the screen's horizontal
	const spun = quatMul(q, quatAxis(UP, yaw));
	const tilted = quatToEuler(quatMul(quatAxis([1, 0, 0], pitch), spun));
	// tilting past straight up or straight down would turn the model on its head: stop there
	const was = upright(turn);
	if (Math.abs(was) > 1e-4 && upright(tilted) * was < 0) return quatToEuler(spun);
	return tilted;
}

/** The view from the other side: front for back, left for right, or half a turn of a free view. */
export function opposite(turn: Vec3, name: string): { name: string; turn: Vec3 } {
	const pairs: Record<string, string> = { front: "back", back: "front", left: "right", right: "left", side: "left", top: "bottom", bottom: "top" };
	const other = pairs[name];
	if (other) return { name: other, turn: [...VIEWS[other]] as Vec3 };
	return { name: "", turn: turned(turn, Math.PI, 0) };
}

/** A wheel event from a mouse's wheel (steps), as opposed to two fingers on a trackpad (a stream). */
function fromMouse(e: WheelEvent): boolean {
	if (e.deltaMode !== 0) return true;
	const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
	return e.deltaX === 0 && typeof legacy === "number" && legacy !== 0 && legacy % 120 === 0;
}

/**
 * The wheel on a 3D canvas. `orbit` turns the view by a movement in
 * pixels; without it (a 2D scene) two fingers pan, as they always did.
 */
export function wheelNav(e: WheelEvent, at: Vec2, W: number, H: number, orbit?: (dx: number, dy: number, free: boolean) => void) {
	if (e.ctrlKey || e.metaKey) return zoomAt(Math.exp(-e.deltaY * 0.01), at, W, H);
	if (orbit && fromMouse(e)) return zoomAt(Math.exp(-e.deltaY * 0.0025), at, W, H);
	if (orbit && !e.shiftKey) return orbit(-e.deltaX, -e.deltaY, e.altKey);
	const z = view.zoom.value;
	const [px, py] = view.pan.value;
	view.pan.value = [px + e.deltaX / z, py + e.deltaY / z];
}
