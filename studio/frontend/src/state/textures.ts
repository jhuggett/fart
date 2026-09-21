// Textures in the studio (1.5): a document's textures resolved through
// the project (maps are files of the project, relative to the document),
// and each colour map rendered once into a small canvas the painters
// tile: the 2D canvas as a pattern, WebGL as a sampler.

import { resolveTextures, type Doc, type Doc3, type ResolvedTexture, type Texture, type TextureMap } from "@fastart/core";
import { drawDoc } from "../canvas/draw.ts";
import { shell } from "../shell/shell.ts";
import { project } from "./project.ts";
import { dirname, joinRel } from "./paths.ts";
import { parseDoc } from "@fastart/core";


/** pixels per drawing unit a rendered map aims for; the canvas is the power of two at or above it (WebGL repeats only those) */
export const MAP_PX = 16;

export interface TexturePattern {
	texture: Texture;
	resolved: ResolvedTexture;
	/** the colour map, one cell; null when it did not resolve */
	canvas: HTMLCanvasElement | null;
	/** pixels per drawing unit along x and y in the canvas */
	sx: number;
	sy: number;
	mode: TextureMap["mode"];
	/** bumped when the canvas is redrawn, so WebGL re-uploads */
	rev: number;
}

const pow2 = (n: number) => Math.max(8, 2 ** Math.ceil(Math.log2(Math.max(1, n))));

let revCounter = 0;

/** Render a map's drawing into one cell, tiled three by three so shapes crossing the edge wrap. */
export function renderMapCanvas(t: Texture, res: ResolvedTexture, map = "color"): { canvas: HTMLCanvasElement; sx: number; sy: number } | null {
	const m = res.maps[map];
	if (!m) return null;
	const [cw, ch] = t.cell;
	const w = pow2(cw * MAP_PX);
	const h = pow2(ch * MAP_PX);
	const sx = w / cw;
	const sy = h / ch;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	for (let oy = -1; oy <= 1; oy++) {
		for (let ox = -1; ox <= 1; ox++) {
			ctx.setTransform(sx, 0, 0, sy, ox * w, oy * h);
			drawDoc(ctx, m.doc, m.tokens, { pose: m.pose });
		}
	}
	return { canvas, sx, sy };
}

/** Every texture of a document, resolved and rendered. `rel` is the document's project path. */
export async function loadPatterns(doc: Doc | Doc3, rel: string): Promise<Map<string, TexturePattern>> {
	const out = new Map<string, TexturePattern>();
	const root = project.root.value;
	if (root === null || !doc.textures?.length) return out;
	const dir = dirname(rel);
	const read = (r: string) => shell.readFile(root, joinRel(dir, r));
	const resolved = await resolveTextures(doc, read, (text) => parseDoc(text).doc);
	for (const [name, res] of resolved) {
		const r = renderMapCanvas(res.texture, res);
		out.set(name, { texture: res.texture, resolved: res, canvas: r?.canvas ?? null, sx: r?.sx ?? MAP_PX, sy: r?.sy ?? MAP_PX, mode: res.maps.color?.map.mode, rev: ++revCounter });
	}
	return out;
}

/** The unresolved refs across a set of patterns, for the issues list. */
export function unresolvedOf(patterns: Map<string, TexturePattern>): string[] {
	return [...patterns.values()].flatMap((p) => p.resolved.unresolved);
}
