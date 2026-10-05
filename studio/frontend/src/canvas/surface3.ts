// What lies under the pointer on the model canvas, as a point of the
// drawn surface: the pipe tool's "on surface" lands its path there, a
// little off the surface along its normal, so a curl or a ridge can be
// drawn on a helm. The frame's solids are kept as one soup of triangles
// in view space (x and y on the canvas, z away), under a tree of boxes,
// and the pointer is a ray straight into the canvas.

import { asMesh, cageOf, xf3Apply, xf3Det, type FramePart, type Vec2, type Vec3 } from "@fastart/core";
import { frameParts, type Sel3 } from "../state/model.ts";
import { castRay, soupOf, soupTris, triNormal, type Soup, type V3 } from "../state/surfaceops.ts";

let cache: { fps: FramePart[]; skip: string; soup: Soup } | null = null;

function soupFor(skip: readonly Sel3[]): Soup {
	const fps = frameParts();
	const key = skip.map((s) => `${s.part}/${s.shape}`).join(",");
	if (cache && cache.fps === fps && cache.skip === key) return cache.soup;
	const tris: number[] = [];
	for (const fp of fps) {
		const flip = xf3Det(fp.F) < 0;
		fp.solids.forEach((sh, si) => {
			// (a part drawn like another shows its source's shapes: they are skipped by the source's index)
			if (!fp.part.like && skip.some((s) => s.part === fp.index && s.shape === si)) return;
			const m = sh.kind === "mesh" || sh.kind === "sweep" ? asMesh(sh) : cageOf(sh);
			const pts = m.points.map((p) => xf3Apply(fp.F, p)) as V3[];
			// a mirrored part turns its faces over on the canvas: wind them back, so "faces the viewer" means the same everywhere
			soupTris(pts, flip ? m.faces.map((f) => [...f].reverse()) : m.faces, tris);
		});
	}
	const soup = soupOf(new Float64Array(tris));
	cache = { fps, skip: key, soup };
	return soup;
}

/**
 * The nearest surface that faces the viewer under a canvas point: where
 * (in view space) and its unit normal there, toward the viewer. `skip`
 * leaves shapes out (the pipe being dragged, and its twin). Null over
 * empty canvas.
 */
export function surfaceUnder(wm: Vec2, skip: readonly Sel3[] = []): { at: Vec3; n: Vec3 } | null {
	const soup = soupFor(skip);
	const hit = castRay(soup, [wm[0], wm[1], -1e5], [0, 0, 1], Infinity, true);
	if (!hit) return null;
	const n = triNormal(soup, hit.tri);
	return { at: [wm[0], wm[1], -1e5 + hit.t], n };
}

/**
 * The surface a point of view space sits over, looked for along a
 * direction: from well outside it, back along `out` (a unit vector
 * away from the surface). What lies between two clicks of a pipe drawn
 * on a surface is found this way, so the pipe follows the surface and
 * does not cut the corner through it. Null when nothing is there.
 */
export function surfaceBelow(p: Vec3, out: Vec3, reach: number, skip: readonly Sel3[] = []): { at: Vec3; n: Vec3 } | null {
	const soup = soupFor(skip);
	const o: V3 = [p[0] + out[0] * reach, p[1] + out[1] * reach, p[2] + out[2] * reach];
	const d: V3 = [-out[0], -out[1], -out[2]];
	const hit = castRay(soup, o, d, reach * 2, true);
	if (!hit) return null;
	return { at: [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t], n: triNormal(soup, hit.tri) };
}
