// The solids of the model, drawn with WebGL under the 2D overlay: flat
// shaded triangles with a depth buffer, so a ball half sunk in a face
// shows its front half whichever way the model is turned. Everything is
// worked out in JS per frame (the models are small): view-space
// positions through each part's map, one colour per triangle from the
// same light the projector uses; the shader only places and paints.

import { colorOf, shadeColor, shapesOf3, triangulateFace, meshUVs, v3cross, v3dot, v3norm, v3sub, xf3Apply, xf3Det, xf3Scale, type Doc3, type FramePart, type Token, type Vec2, type Vec3 } from "@fastart/core";
import type { TexturePattern } from "../state/textures.ts";

const VS = `attribute vec3 p; attribute vec4 c; attribute vec2 t; attribute float l; uniform vec3 u; uniform vec2 h; varying vec4 vc; varying vec2 vt; varying float vl;
void main() { gl_Position = vec4((p.x - u.x) * u.z / h.x, -(p.y - u.y) * u.z / h.y, p.z / 4000.0, 1.0); vc = c; vt = t; vl = l; }`;
// a textured triangle: the light on the token (vc), the map's colour laid over where it paints (paint) or multiplying it (mask)
const FS = `precision mediump float; varying vec4 vc; varying vec2 vt; varying float vl; uniform sampler2D s; uniform float tex; uniform float mask;
void main() {
	if (tex < 0.5) { gl_FragColor = vc; return; }
	vec4 m = texture2D(s, vt);
	if (mask > 0.5) { float v = dot(m.rgb, vec3(0.2126, 0.7152, 0.0722)) * m.a; gl_FragColor = vec4(vc.rgb * v, vc.a); return; }
	gl_FragColor = vec4(mix(vc.rgb, m.rgb * vl, m.a), vc.a);
}`;

interface Gl {
	gl: WebGLRenderingContext;
	prog: WebGLProgram;
	pBuf: WebGLBuffer;
	cBuf: WebGLBuffer;
	tBuf: WebGLBuffer;
	lBuf: WebGLBuffer;
	pLoc: number;
	cLoc: number;
	tLoc: number;
	lLoc: number;
	uLoc: WebGLUniformLocation;
	hLoc: WebGLUniformLocation;
	sLoc: WebGLUniformLocation;
	texLoc: WebGLUniformLocation;
	maskLoc: WebGLUniformLocation;
	/** uploaded colour maps, by texture name, with the pattern rev they came from */
	textures: Map<string, { tex: WebGLTexture; rev: number }>;
}
const ctxs = new WeakMap<HTMLCanvasElement, Gl | null>();

function setup(canvas: HTMLCanvasElement): Gl | null {
	const have = ctxs.get(canvas);
	if (have !== undefined) return have;
	const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, depth: true });
	if (!gl) {
		ctxs.set(canvas, null);
		return null;
	}
	const sh = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		return s;
	};
	const prog = gl.createProgram()!;
	gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
	gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
	gl.linkProgram(prog);
	const out: Gl = {
		gl,
		prog,
		pBuf: gl.createBuffer()!,
		cBuf: gl.createBuffer()!,
		tBuf: gl.createBuffer()!,
		lBuf: gl.createBuffer()!,
		pLoc: gl.getAttribLocation(prog, "p"),
		cLoc: gl.getAttribLocation(prog, "c"),
		tLoc: gl.getAttribLocation(prog, "t"),
		lLoc: gl.getAttribLocation(prog, "l"),
		uLoc: gl.getUniformLocation(prog, "u")!,
		hLoc: gl.getUniformLocation(prog, "h")!,
		sLoc: gl.getUniformLocation(prog, "s")!,
		texLoc: gl.getUniformLocation(prog, "tex")!,
		maskLoc: gl.getUniformLocation(prog, "mask")!,
		textures: new Map(),
	};
	ctxs.set(canvas, out);
	return out;
}

// templates: a unit sphere and a unit cylinder along z, as triangle index lists
const SPHERE = (() => {
	const R = 7;
	const S = 12;
	const pts: Vec3[] = [];
	for (let i = 0; i <= R; i++) {
		const ph = (i / R) * Math.PI;
		for (let j = 0; j < S; j++) {
			const th = (j / S) * Math.PI * 2;
			pts.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]);
		}
	}
	const tris: number[] = [];
	for (let i = 0; i < R; i++) {
		for (let j = 0; j < S; j++) {
			const a = i * S + j;
			const b = i * S + ((j + 1) % S);
			const c = (i + 1) * S + j;
			const d = (i + 1) * S + ((j + 1) % S);
			if (i > 0) tris.push(a, c, b);
			if (i < R - 1) tris.push(b, c, d);
		}
	}
	return { pts, tris };
})();
const CYL = (() => {
	const S = 10;
	const pts: Vec3[] = [];
	for (const z of [0, 1]) for (let j = 0; j < S; j++) pts.push([Math.cos((j / S) * Math.PI * 2), Math.sin((j / S) * Math.PI * 2), z]);
	pts.push([0, 0, 0], [0, 0, 1]);
	const tris: number[] = [];
	for (let j = 0; j < S; j++) {
		const a = j;
		const b = (j + 1) % S;
		tris.push(a, b, a + S, b, b + S, a + S);
		tris.push(2 * S, b, a); // the near cap
		tris.push(2 * S + 1, a + S, b + S); // the far cap
	}
	return { pts, tris };
})();

/** A batch of triangles: one per texture (or none), drawn in turn. */
interface Batch {
	texture: string | null;
	pos: number[];
	col: number[];
	uv: number[];
	lit: number[];
}

/** One document's parts in a frame, with the tokens to paint them. */
export interface SolidLayer {
	doc: Doc3;
	fps: FramePart[];
	tokens: readonly Token[];
	patterns?: Map<string, TexturePattern>;
}

/** The model's solids in view space, into the canvas. Textured shapes (1.5) sample their rendered colour maps. */
export function drawSolids(canvas: HTMLCanvasElement, doc: Doc3, fps: FramePart[], tokens: readonly Token[], light: Vec3, ambient: number, view: { W: number; H: number; dpr: number; pan: [number, number]; zoom: number }, patterns?: Map<string, TexturePattern>): boolean {
	return drawLayers(canvas, [{ doc, fps, tokens, patterns }], light, ambient, view);
}

/** Several documents' solids in one frame (a scene), one depth buffer. */
export function drawLayers(canvas: HTMLCanvasElement, layers: SolidLayer[], light: Vec3, ambient: number, view: { W: number; H: number; dpr: number; pan: [number, number]; zoom: number }): boolean {
	const g = setup(canvas);
	if (!g) return false;
	const { gl } = g;
	const l = v3norm(light);
	const batches = new Map<string | null, Batch>();
	const batchOf = (name: string | null): Batch => {
		let b = batches.get(name);
		if (!b) {
			b = { texture: name, pos: [], col: [], uv: [], lit: [] };
			batches.set(name, b);
		}
		return b;
	};
	let cur = batchOf(null);
	let curUV: [Vec2, Vec2, Vec2] | null = null;
	const pos = { push: (...xs: number[]) => cur.pos.push(...xs) };
	const col = { push: (...xs: number[]) => cur.col.push(...xs) };
	/**
	 * One triangle. A mesh face's winding is the format's promise, so it is
	 * culled when turned away; a ball's or a rod's normal is oriented away
	 * from `out` (its centre, or the nearest point of its axis) and drawn
	 * whichever way it faces: the depth buffer sorts it out.
	 */
	const tri = (a: Vec3, b: Vec3, c: Vec3, rgb: [number, number, number, number], shade: number | undefined, flip: boolean, out?: Vec3) => {
		let n = v3cross(v3sub(b, a), v3sub(c, a));
		if (out) {
			const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
			if (v3dot(n, v3sub(mid, out)) < 0) n = [-n[0], -n[1], -n[2]];
		} else {
			if (flip) n = [-n[0], -n[1], -n[2]];
			if (n[2] >= 0) return; // turned away
		}
		const lit = Math.max(0, v3dot(v3norm(n), l));
		const light = (ambient + (1 - ambient) * lit) * (shade ?? 1);
		const [r, gg, bb, al] = shadeColor(rgb, light);
		pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
		const cc = [r / 255, gg / 255, bb / 255, al / 255];
		col.push(...cc, ...cc, ...cc);
		cur.lit.push(light, light, light);
		if (curUV) cur.uv.push(...curUV[0], ...curUV[1], ...curUV[2]);
		else cur.uv.push(0, 0, 0, 0, 0, 0);
	};
	const patternOf = new Map<string, TexturePattern>();
	for (const layer of layers) for (const fp of layer.fps) {
		const { doc, tokens, patterns } = layer;
		const F = fp.F;
		const flip = xf3Det(F) < 0;
		const s = xf3Scale(F);
		for (const sh of shapesOf3(doc, fp.part)) {
			const rgb = colorOf(tokens, sh.color ?? "");
			const pattern = sh.texture ? patterns?.get(sh.texture) : undefined;
			const cell = pattern?.texture.cell ?? [1, 1];
			// a texture name is per document; key the batch by the pattern's identity
			const key = pattern?.canvas ? `${sh.texture}@${pattern.rev}` : null;
			if (key && !patternOf.has(key)) patternOf.set(key, pattern!);
			cur = batchOf(key);
			curUV = null;
			if (sh.kind === "mesh") {
				const pts = sh.points.map((p) => xf3Apply(F, p));
				if (pattern?.canvas) {
					// per face, so a corner's pattern coordinates are known (box mapped or explicit)
					const uvs = meshUVs(sh);
					sh.faces.forEach((f, fi) => {
						const ft = triangulateFace(sh.points, f);
						const uvOf = (idx: number): Vec2 => {
							const ci = f.indexOf(idx);
							const uv = uvs[fi][ci] ?? [0, 0];
							return [uv[0] / cell[0], uv[1] / cell[1]];
						};
						for (let i = 0; i + 2 < ft.length; i += 3) {
							curUV = [uvOf(ft[i]), uvOf(ft[i + 1]), uvOf(ft[i + 2])];
							tri(pts[ft[i]], pts[ft[i + 1]], pts[ft[i + 2]], rgb, sh.shade, flip);
						}
					});
					curUV = null;
					continue;
				}
				let tris = sh.tris;
				if (!tris || tris.length % 3 !== 0 || tris.some((i) => i >= pts.length)) {
					tris = [];
					for (const f of sh.faces) tris.push(...triangulateFace(sh.points, f));
				}
				for (let i = 0; i + 2 < tris.length; i += 3) tri(pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]], rgb, sh.shade, flip);
			} else if (sh.kind === "ball") {
				const c = xf3Apply(F, sh.at);
				const r = sh.r * s;
				const pts = SPHERE.pts.map((p): Vec3 => [c[0] + p[0] * r, c[1] + p[1] * r, c[2] + p[2] * r]);
				for (let i = 0; i + 2 < SPHERE.tris.length; i += 3) tri(pts[SPHERE.tris[i]], pts[SPHERE.tris[i + 1]], pts[SPHERE.tris[i + 2]], rgb, sh.shade, false, c);
			} else {
				const a = xf3Apply(F, sh.a);
				const b = xf3Apply(F, sh.b);
				const d = v3sub(b, a);
				const len = Math.hypot(d[0], d[1], d[2]);
				if (len < 1e-6) continue;
				const w = v3norm(d);
				// a frame around the axis
				const seed: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
				const u = v3norm(v3cross(w, seed));
				const v = v3cross(w, u);
				const r = (sh.w * s) / 2;
				const pts = CYL.pts.map((p): Vec3 => [
					a[0] + (u[0] * p[0] + v[0] * p[1]) * r + w[0] * p[2] * len,
					a[1] + (u[1] * p[0] + v[1] * p[1]) * r + w[1] * p[2] * len,
					a[2] + (u[2] * p[0] + v[2] * p[1]) * r + w[2] * p[2] * len,
				]);
				for (let i = 0; i + 2 < CYL.tris.length; i += 3) {
					const t0 = pts[CYL.tris[i]];
					const t1 = pts[CYL.tris[i + 1]];
					const t2 = pts[CYL.tris[i + 2]];
					// the nearest point of the axis to the triangle's middle, so the caps face out too
					const mid: Vec3 = [(t0[0] + t1[0] + t2[0]) / 3, (t0[1] + t1[1] + t2[1]) / 3, (t0[2] + t1[2] + t2[2]) / 3];
					let k = v3dot(v3sub(mid, a), w) / len;
					k = k <= 0.02 ? -0.5 : k >= 0.98 ? 1.5 : k; // a cap's reference sits beyond its end
					const on: Vec3 = [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k];
					tri(t0, t1, t2, rgb, sh.shade, false, on);
				}
			}
		}
	}
	const w = Math.round(view.W * view.dpr);
	const h = Math.round(view.H * view.dpr);
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	gl.viewport(0, 0, w, h);
	gl.clearColor(0, 0, 0, 0);
	gl.enable(gl.DEPTH_TEST);
	gl.depthFunc(gl.LEQUAL);
	gl.disable(gl.CULL_FACE);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.useProgram(g.prog);
	gl.uniform3f(g.uLoc, view.pan[0], view.pan[1], view.zoom);
	gl.uniform2f(g.hLoc, view.W / 2, view.H / 2);
	gl.uniform1i(g.sLoc, 0);
	for (const b of batches.values()) {
		if (!b.pos.length) continue;
		const pattern = b.texture ? patternOf.get(b.texture) : undefined;
		if (b.texture && pattern?.canvas) {
			// the colour map as a wrapping texture, uploaded when its render changes
			let have = g.textures.get(b.texture);
			if (!have || have.rev !== pattern.rev) {
				const tex = have?.tex ?? gl.createTexture()!;
				gl.bindTexture(gl.TEXTURE_2D, tex);
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pattern.canvas);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				have = { tex, rev: pattern.rev };
				g.textures.set(b.texture, have);
			}
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, have.tex);
			gl.uniform1f(g.texLoc, 1);
			gl.uniform1f(g.maskLoc, pattern.mode === "mask" ? 1 : 0);
		} else {
			gl.uniform1f(g.texLoc, 0);
			gl.uniform1f(g.maskLoc, 0);
		}
		const attr = (buf: WebGLBuffer, loc: number, data: number[], n: number) => {
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
		};
		attr(g.pBuf, g.pLoc, b.pos, 3);
		attr(g.cBuf, g.cLoc, b.col, 4);
		attr(g.tBuf, g.tLoc, b.uv, 2);
		attr(g.lBuf, g.lLoc, b.lit, 1);
		gl.drawArrays(gl.TRIANGLES, 0, b.pos.length / 3);
	}
	return true;
}
