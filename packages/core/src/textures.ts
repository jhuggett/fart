// Textures (1.5): maps that are drawings, tiled over a cell. Resolving a
// texture reads its maps' drawings and palettes; box mapping gives a
// mesh its pattern coordinates; a small software rasteriser turns any
// map into pixels, the same way in every reader, so a bake and a game
// agree; and the 2D mapping's affine form is what fills and projections
// use.

import type { Doc, Doc3, Mapping2, Shape, StatePart, Texture, TextureMap, Token, Vec2 } from "./types.ts";
import { applyPalette, colorOf, resolvePalettes, shadeColor, type RefReader } from "./palette.ts";
import { drawList, shapeDistance, shapesOf, xfApply, xfInvert, type Xf } from "./geometry.ts";
import { boxUV, meshUVs } from "./solids.ts";
export { boxUV, meshUVs };

/** A map, read: its drawing, the tokens to draw it with, and the pose to draw. */
export interface ResolvedMap {
	map: TextureMap;
	doc: Doc;
	tokens: Token[];
	pose: string | readonly StatePart[] | undefined;
}
export interface ResolvedTexture {
	texture: Texture;
	maps: Record<string, ResolvedMap>;
	/** refs that could not be read */
	unresolved: string[];
}

/** Read a texture's maps through `read` (paths relative to the document that names them). */
export async function resolveTexture(texture: Texture, read: RefReader, parse: (text: string) => Doc | null): Promise<ResolvedTexture> {
	const out: ResolvedTexture = { texture, maps: {}, unresolved: [] };
	for (const [name, map] of Object.entries(texture.maps)) {
		const text = await read(map.ref);
		const doc = text === null ? null : parse(text);
		if (!doc || doc.space === "3d") {
			out.unresolved.push(map.ref);
			continue;
		}
		// the drawing's own tokens, through its refs (relative to the drawing), then the map's palette laid over
		const dir = map.ref.includes("/") ? map.ref.slice(0, map.ref.lastIndexOf("/") + 1) : "";
		let { tokens } = await resolvePalettes(doc, (rel) => read(dir + rel));
		if (map.palette) {
			const pt = await read(map.palette);
			const pd = pt === null ? null : parse(pt);
			if (pd?.palette) tokens = applyPalette(tokens, pd.palette);
			else out.unresolved.push(map.palette);
		}
		const pose = map.state ?? doc.states?.[0]?.name;
		out.maps[name] = { map, doc, tokens, pose };
	}
	return out;
}

/** Every texture of a document, resolved. */
export async function resolveTextures(doc: Doc | Doc3, read: RefReader, parse: (text: string) => Doc | null): Promise<Map<string, ResolvedTexture>> {
	const out = new Map<string, ResolvedTexture>();
	for (const t of doc.textures ?? []) out.set(t.name, await resolveTexture(t, read, parse));
	return out;
}

// ------------------------------------------------------------- mapping

/** A 2D mapping as the affine map from pattern coordinates to the shape's space. */
export function mappingXf(m: Mapping2 | undefined): Xf {
	if (m?.xf) return [...m.xf] as Xf;
	const at = m?.at ?? [0, 0];
	const a = m?.angle ?? 0;
	const s = m?.scale === undefined || m.scale === 0 ? 1 : m.scale;
	const c = Math.cos(a) * s;
	const sn = Math.sin(a) * s;
	return [c, sn, -sn, c, at[0], at[1]];
}

/** The 2D affine from pattern coordinates to a plane, from three corners with known coordinates on both sides. */
export function affineFrom(uv: readonly Vec2[], xy: readonly Vec2[]): Xf | null {
	// solve M · [u v 1] = [x y] for M (2×3) from three corners
	const [u0, v0] = uv[0];
	const [u1, v1] = uv[1];
	const [u2, v2] = uv[2];
	const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
	if (Math.abs(det) < 1e-12) return null;
	const inv = [(v2 - v0) / det, -(v1 - v0) / det, -(u2 - u0) / det, (u1 - u0) / det]; // inverse of [[u1-u0, u2-u0],[v1-v0, v2-v0]]
	const [x0, y0] = xy[0];
	const dx1 = xy[1][0] - x0;
	const dy1 = xy[1][1] - y0;
	const dx2 = xy[2][0] - x0;
	const dy2 = xy[2][1] - y0;
	// [dx1 dx2] = [a c] · [[u1-u0, u2-u0],[v1-v0, v2-v0]]  →  [a c] = [dx1 dx2] · inv
	const a = dx1 * inv[0] + dx2 * inv[1];
	const c = dx1 * inv[2] + dx2 * inv[3];
	const b = dy1 * inv[0] + dy2 * inv[1];
	const d = dy1 * inv[2] + dy2 * inv[3];
	const e = x0 - (a * u0 + c * v0);
	const f = y0 - (b * u0 + d * v0);
	const r = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
	return [r(a), r(b), r(c), r(d), r(e), r(f)];
}

// ------------------------------------------------------------- rasterising

/** Pixels of a map: RGBA, row-major, `px` wide and `py` tall over one cell. */
export interface Raster {
	width: number;
	height: number;
	/** RGBA bytes */
	data: Uint8ClampedArray;
}

const lum = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * Rasterise one cell of a map, one sample per pixel at its centre, the
 * drawing's shapes in paint order over a clear ground. No engine needed:
 * this is the reference, and a game may do better with its own canvas.
 */
export function rasterizeMap(texture: Texture, res: ResolvedMap, px: number, py = px): Raster {
	const [cw, ch] = texture.cell;
	const data = new Uint8ClampedArray(px * py * 4);
	const items: { shape: Shape; xf: Xf; inv: Xf; scale: number; rgba: [number, number, number, number] }[] = [];
	for (const { part, xf, scale } of drawList(res.doc, res.pose)) {
		for (const sh of shapesOf(res.doc, part)) {
			items.push({ shape: sh, xf, inv: xfInvert(xf), scale, rgba: shadeColor(colorOf(res.tokens, sh.color ?? ""), sh.shade) });
		}
	}
	for (let y = 0; y < py; y++) {
		for (let x = 0; x < px; x++) {
			// the sample, in the drawing's space, wrapped into the cell
			const wx = ((x + 0.5) / px) * cw;
			const wy = ((y + 0.5) / py) * ch;
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (const it of items) {
				// tiling: test the sample and its neighbours a cell away, so shapes crossing the edge wrap
				let hit = false;
				for (let oy = -1; oy <= 1 && !hit; oy++) for (let ox = -1; ox <= 1 && !hit; ox++) {
					const local = xfApply(it.inv, [wx + ox * cw, wy + oy * ch]);
					if (shapeDistance(it.shape, local) <= 0) hit = true;
				}
				if (!hit) continue;
				const al = it.rgba[3] / 255;
				r = it.rgba[0] * al + r * (1 - al);
				g = it.rgba[1] * al + g * (1 - al);
				b = it.rgba[2] * al + b * (1 - al);
				a = al + a * (1 - al);
			}
			const o = (y * px + x) * 4;
			data[o] = r;
			data[o + 1] = g;
			data[o + 2] = b;
			data[o + 3] = a * 255;
		}
	}
	return { width: px, height: py, data };
}

/** A raster read as the scalar the format defines: luminance times alpha, per pixel, 0..1. */
export function rasterValues(r: Raster): Float32Array {
	const out = new Float32Array(r.width * r.height);
	for (let i = 0; i < out.length; i++) out[i] = lum(r.data[i * 4], r.data[i * 4 + 1], r.data[i * 4 + 2]) * (r.data[i * 4 + 3] / 255);
	return out;
}

/** The colour a textured shape shows at a pattern coordinate: the colour map over (or masking) the token. */
export function textureColor(base: [number, number, number, number], res: ResolvedMap | undefined, raster: Raster | undefined, texture: Texture, uv: Vec2): [number, number, number, number] {
	if (!res || !raster) return base;
	const [cw, ch] = texture.cell;
	const fx = ((uv[0] / cw) % 1 + 1) % 1;
	const fy = ((uv[1] / ch) % 1 + 1) % 1;
	const x = Math.min(raster.width - 1, Math.floor(fx * raster.width));
	const y = Math.min(raster.height - 1, Math.floor(fy * raster.height));
	const o = (y * raster.width + x) * 4;
	const a = raster.data[o + 3] / 255;
	if (res.map.mode === "mask") {
		const v = lum(raster.data[o], raster.data[o + 1], raster.data[o + 2]) * a;
		return [base[0] * v, base[1] * v, base[2] * v, base[3]];
	}
	return [raster.data[o] * a + base[0] * (1 - a), raster.data[o + 1] * a + base[1] * (1 - a), raster.data[o + 2] * a + base[2] * (1 - a), base[3]];
}

