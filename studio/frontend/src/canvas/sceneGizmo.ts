// The scene screen's gizmo: the chosen nodes, moved, turned and sized
// along the world's axes by the same engine the model screen uses
// (gizmo3.ts). A node's place and turn live in its parent's frame, so
// every amount is carried there from the view. Several nodes move as
// one; each turns and sizes about its own origin.

import { quatMul, quatAxis, quatFromEuler, quatToEuler, viewXf3, xfApply, xfInvert, xf3Apply, xf3ApplyDir, xf3Invert, xf3Det, type Vec2, type Vec3, type Xf, type Xf3 } from "@fastart/core";
import { sc, flattened, is3d, nodeAt, setNode, endGesture, selectedRoots } from "../state/scene.ts";
import type { GizmoProvider, GizmoTarget } from "./gizmo3.ts";

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
const unit = (a: Vec3): Vec3 => {
	const l = Math.hypot(a[0], a[1], a[2]) || 1;
	return [a[0] / l, a[1] / l, a[2] / l];
};
const view = (): Xf3 => viewXf3(is3d() ? sc.turn.value : [0, 0, 0]);

/** Where a node's origin is: in the world (a 3D scene) and on the canvas. */
export function nodeOrigin(path: string): { world: Vec3; at: Vec2 } | null {
	const w = flattened().worlds.get(path);
	if (!w) return null;
	if (is3d()) {
		const world = xf3Apply(w as Xf3, [0, 0, 0]);
		const v = xf3Apply(view(), world);
		return { world, at: [v[0], v[1]] };
	}
	const p = xfApply(w as Xf, [0, 0]);
	return { world: [p[0], p[1], 0], at: p };
}

function target(): GizmoTarget | null {
	if (sc.playing.value) return null;
	const three = is3d();
	const { frames } = flattened();
	// a node inside another chosen one rides it: only the outermost are transformed
	const items = selectedRoots().flatMap((path) => {
		const n = nodeAt(path);
		const frame = frames.get(path);
		const o = nodeOrigin(path);
		if (!n || !frame || !o) return [];
		const rot = n.rotate;
		return [{ path, frame, at: [...(n.at ?? (three ? [0, 0, 0] : [0, 0]))], rotate: rot, scale: n.scale ?? 1, origin: o.at }];
	});
	if (!items.length) return null;
	const centre: Vec2 = [items.reduce((s, i) => s + i.origin[0], 0) / items.length, items.reduce((s, i) => s + i.origin[1], 0) / items.length];
	return {
		centre,
		// a 2D scene turns only about the view
		rings: three ? [0, 1, 2] : [2],
		axisSize: false,
		apply(op, axisView, amount, dView) {
			const Vinv = xf3Invert(view());
			for (const it of items) {
				if (op === "size") {
					setNode(it.path, { scale: Math.max(0.001, r3(it.scale * amount)) }, "gizmo");
				} else if (op === "move") {
					if (three) {
						const d = xf3ApplyDir(xf3Invert(it.frame as Xf3), xf3ApplyDir(Vinv, dView));
						setNode(it.path, { at: [r3(it.at[0] + d[0]), r3(it.at[1] + d[1]), r3((it.at[2] ?? 0) + d[2])] }, "gizmo");
					} else {
						const inv = xfInvert(it.frame as Xf);
						const o = xfApply(inv, [0, 0]);
						const d = xfApply(inv, [dView[0], dView[1]]);
						setNode(it.path, { at: [r3(it.at[0] + d[0] - o[0]), r3(it.at[1] + d[1] - o[1])] }, "gizmo");
					}
				} else if (three) {
					const f = xf3Invert(it.frame as Xf3);
					const n = unit(xf3ApplyDir(f, xf3ApplyDir(Vinv, axisView ?? [0, 0, 1])));
					const base: Vec3 = Array.isArray(it.rotate) ? ([...it.rotate] as Vec3) : [0, 0, typeof it.rotate === "number" ? it.rotate : 0];
					const q = quatMul(quatAxis(n, amount * (xf3Det(f) < 0 ? -1 : 1)), quatFromEuler(base));
					const e = quatToEuler(q).map(r4) as Vec3;
					setNode(it.path, { rotate: e.every((x) => x === 0) ? undefined : e }, "gizmo");
				} else {
					// in the plane there is one turn, and X or Y held means nothing to it
					const base = typeof it.rotate === "number" ? it.rotate : 0;
					setNode(it.path, { rotate: r4(base + amount) || undefined }, "gizmo");
				}
			}
		},
	};
}

export const sceneGizmo: GizmoProvider = { view, target, endGesture };
