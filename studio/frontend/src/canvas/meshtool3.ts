// Mesh operations by hand, on the model canvas: E extrudes what is
// chosen, I insets it, K cuts a loop, and the pointer says by how much
// (the way G T S take their amount). A typed number is the amount,
// Return or a click keeps it, Esc or a right click puts it back. One undo
// step either way, and none at all when it is put back. From a button or
// the palette, with no pointer over the canvas, the operation is simply
// done with a sensible amount; either way its numbers stay open in the
// inspector until something else changes.

import { signal } from "@preact/signals";
import { xf3Apply, xf3ApplyDir, type Vec2, type Vec3 } from "@fastart/core";
import { md, selShapePosed, framePartOf, startOp, adjustOp, cancelOp, liveOp, endGesture, meshRefusal, type OpKind } from "../state/model.ts";
import { MeshError, faceNormal, type V3 } from "../state/meshops.ts";
import { project } from "../state/project.ts";

type Hand = "extrude" | "inset" | "loopcut";

/** What the status bar reads while an operation follows the pointer. */
export const meshModal = signal<{ kind: Hand; typed: string; value: number } | null>(null);

interface Live {
	kind: Hand;
	start: Vec2;
	cursor: Vec2;
	typed: string;
	shift: boolean;
	/** how a canvas movement reads as an amount: along this direction, per its squared length (null: sideways) */
	along: Vec2 | null;
}
let live: Live | null = null;

const DEFAULTS: Record<OpKind, Record<string, number>> = {
	extrude: { amount: 0.5 },
	inset: { amount: 0.2, raise: 0 },
	loopcut: { at: 0.5 },
	merge: { distance: 0.01 },
	creaseAngle: { angle: 30, value: 1 },
};
const FIELD: Record<Hand, string> = { extrude: "amount", inset: "amount", loopcut: "at" };
const LABEL: Record<Hand, string> = { extrude: "Extrude", inset: "Inset", loopcut: "Loop cut" };

export const meshActive = () => live !== null;

/** Which way on the canvas the pointer should travel for the amount to grow, for what is chosen. */
function direction(kind: Hand): Vec2 | null {
	const s = md.sel.value;
	const sh = selShapePosed();
	const fp = s ? framePartOf(s.part) : undefined;
	if (!s || !sh || sh.kind !== "mesh" || !fp) return null;
	if (kind === "extrude" && md.pick.value === "face") {
		// the chosen faces' normal, as the view shows it
		let n: Vec3 = [0, 0, 0];
		for (const f of md.faces.value) {
			const face = sh.faces[f];
			if (!face) continue;
			const fn = faceNormal(sh.points as V3[], face);
			const l = Math.hypot(fn[0], fn[1], fn[2]) || 1;
			n = [n[0] + fn[0] / l, n[1] + fn[1] / l, n[2] + fn[2] / l];
		}
		const l = Math.hypot(n[0], n[1], n[2]);
		if (l < 1e-6) return null;
		const v = xf3ApplyDir(fp.F, [n[0] / l, n[1] / l, n[2] / l]);
		return Math.hypot(v[0], v[1]) > 0.25 ? [v[0], v[1]] : null;
	}
	if (kind === "loopcut") {
		const e = md.edges.value[md.edges.value.length - 1];
		if (!e || !sh.points[e[0]] || !sh.points[e[1]]) return null;
		const a = xf3Apply(fp.F, sh.points[e[0]]);
		const b = xf3Apply(fp.F, sh.points[e[1]]);
		const v: Vec2 = [b[0] - a[0], b[1] - a[1]];
		return Math.hypot(v[0], v[1]) > 1e-3 ? v : null;
	}
	return null;
}

function amount(g: Live): number {
	const typed = g.typed !== "" && g.typed !== "-" && g.typed !== "." ? Number(g.typed) : NaN;
	const m: Vec2 = [g.cursor[0] - g.start[0], g.cursor[1] - g.start[1]];
	let v: number;
	if (Number.isFinite(typed)) v = typed;
	else {
		v = g.along ? (m[0] * g.along[0] + m[1] * g.along[1]) / (g.along[0] * g.along[0] + g.along[1] * g.along[1]) : m[0];
		if (g.kind === "loopcut") v += 0.5;
		if (g.shift) v = Math.round(v * 10) / 10;
	}
	if (g.kind === "inset") v = Math.max(0, v);
	if (g.kind === "loopcut") v = Math.max(0.02, Math.min(0.98, v));
	return Math.round(v * 1000) / 1000;
}

function update() {
	const g = live;
	if (!g) return;
	const v = amount(g);
	adjustOp({ [FIELD[g.kind]]: v });
	meshModal.value = { kind: g.kind, typed: g.typed, value: v };
}

/**
 * Do a mesh operation on what is chosen. With the pointer over the
 * canvas (`cursor`) it then follows the pointer until kept or put back;
 * without, it is done with its usual amount. False, with the reason in
 * the error line, when it cannot be done.
 */
export function meshOp(kind: OpKind, cursor: Vec2 | null, params?: Record<string, number>): boolean {
	if (live) finish(true);
	try {
		const why = meshRefusal();
		if (why) throw new MeshError(why);
		const hand = kind === "extrude" || kind === "inset" || kind === "loopcut" ? kind : null;
		const follow = !!hand && !!cursor && !params;
		const along = follow ? direction(hand) : null;
		endGesture();
		// by hand it starts from nothing and grows with the pointer
		const first = params ?? (follow ? { ...DEFAULTS[kind], [FIELD[hand!]]: hand === "loopcut" ? 0.5 : 0 } : DEFAULTS[kind]);
		startOp(kind, first);
		if (follow) {
			live = { kind: hand!, start: cursor!, cursor: cursor!, typed: "", shift: false, along };
			meshModal.value = { kind: hand!, typed: "", value: first[FIELD[hand!]] };
		}
		return true;
	} catch (e) {
		project.error.value = e instanceof MeshError ? e.message : String(e);
		return false;
	}
}

function finish(keep: boolean) {
	if (!live) return;
	live = null;
	meshModal.value = null;
	if (!keep) cancelOp();
	else if (liveOp()?.failed) cancelOp();
	endGesture();
}

export function meshMove(wm: Vec2, shift: boolean) {
	if (!live) return;
	live.cursor = wm;
	live.shift = shift;
	update();
}
/** A click while an operation follows the pointer keeps it. True when it was taken. */
export function meshDown(): boolean {
	if (!live) return false;
	finish(true);
	return true;
}
export function meshCancel(): boolean {
	if (!live) return false;
	finish(false);
	return true;
}

/** A key while an operation follows the pointer: digits type the amount, Return keeps, Esc puts back. True when the key was taken. */
export function meshKey(e: KeyboardEvent): boolean {
	const g = live;
	if (!g) return false;
	if (e.metaKey || e.ctrlKey || e.altKey) return false;
	const k = e.key;
	if (k === "Escape") finish(false);
	else if (k === "Enter") finish(true);
	else if (/^[0-9]$/.test(k) || (k === "." && !g.typed.includes(".")) || (k === "-" && g.typed === "")) {
		g.typed += k;
		update();
	} else if (k === "Backspace") {
		g.typed = g.typed.slice(0, -1);
		update();
	} else if (k === "Shift") return false;
	// every other key waits until the operation is kept or put back
	return true;
}

/** The status bar's line while an operation follows the pointer. */
export function meshStatus(): string | null {
	const m = meshModal.value;
	if (!m) return null;
	const shown = m.typed !== "" ? m.typed : String(m.value);
	const what = m.kind === "loopcut" ? "of the way along the edge" : m.kind === "inset" ? "in from the border" : "along the normal";
	return `${LABEL[m.kind]}: ${shown} ${what} · type a number · ⇧ snaps to tenths · Return or a click keeps · Esc puts back`;
}
