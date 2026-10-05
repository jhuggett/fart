// The solids of a model or a scene, drawn with WebGL under the 2D
// overlay: lit triangles with a depth buffer, so a ball half sunk in a
// face shows its front half whichever way the model is turned.
//
// A part's triangles are built once, in the part's own rest space, and
// kept on the GPU until the part's shapes, colours or textures change.
// A frame is then only uniforms: the view's turn, each part's map into
// the world, the pan and the zoom. Panning, zooming, orbiting and moving
// a node rebuild nothing, and a file placed two thousand times in a
// scene is one buffer drawn two thousand times. The light is worked out
// in the shader, from the same rule the projector uses.

import { asMesh, cageOf, cornerNormals, smoothNormals, colorOf, triangulateFace, meshUVs, shapesOf3Posed, worldTransforms3, v3cross, v3dot, v3norm, v3sub, xf3Det, xf3Mul, type Doc3, type Shape3, type StatePart3, type Token, type Vec2, type Vec3, type Xf3 } from "@fastart/core";
import type { TexturePattern } from "../state/textures.ts";

// p, n: position and normal in the part's rest space. c: the slot's colour. t: pattern coordinates.
// k: (the shape's own shade, 1 for a smooth corner normal). m0..m2: the part's map into the world (rows);
// v0..v2: the view's turn (rows). f: -1 under a mirror, for smooth normals. L: the light, a: ambient.
const VS = `attribute vec3 p; attribute vec3 n; attribute vec4 c; attribute vec2 t; attribute vec2 k;
uniform vec4 m0; uniform vec4 m1; uniform vec4 m2; uniform vec3 v0; uniform vec3 v1; uniform vec3 v2;
uniform float f; uniform vec3 L; uniform float a; uniform vec3 u; uniform vec2 h;
varying vec4 vc; varying vec2 vt; varying float vl;
void main() {
	vec4 q = vec4(p, 1.0);
	vec3 w = vec3(dot(m0, q), dot(m1, q), dot(m2, q));
	vec3 e = vec3(dot(v0, w), dot(v1, w), dot(v2, w));
	vec3 nw = vec3(dot(m0.xyz, n), dot(m1.xyz, n), dot(m2.xyz, n));
	vec3 ne = normalize(vec3(dot(v0, nw), dot(v1, nw), dot(v2, nw))) * (k.y > 0.5 ? f : 1.0);
	float light = (a + (1.0 - a) * max(0.0, dot(ne, L))) * k.x;
	gl_Position = vec4((e.x - u.x) * u.z / h.x, -(e.y - u.y) * u.z / h.y, e.z / 4000.0, 1.0);
	vc = vec4(min(c.rgb * light, vec3(1.0)), c.a); vt = t; vl = light;
}`;
// a textured triangle: the light on the token (vc), the map's colour laid over where it paints (paint) or multiplying it (mask)
const FS = `precision mediump float; varying vec4 vc; varying vec2 vt; varying float vl; uniform sampler2D s; uniform float tex; uniform float mask;
void main() {
	if (tex < 0.5) { gl_FragColor = vc; return; }
	vec4 m = texture2D(s, vt);
	if (mask > 0.5) { float v = dot(m.rgb, vec3(0.2126, 0.7152, 0.0722)) * m.a; gl_FragColor = vec4(vc.rgb * v, vc.a); return; }
	gl_FragColor = vec4(mix(vc.rgb, m.rgb * vl, m.a), vc.a);
}`;

/** floats per vertex: position 3, normal 3, colour 4, pattern 2, (shade, smooth) 2 */
const STRIDE = 14;

interface Gl {
	gl: WebGLRenderingContext;
	prog: WebGLProgram;
	attr: Record<"p" | "n" | "c" | "t" | "k", number>;
	uni: Record<"m0" | "m1" | "m2" | "v0" | "v1" | "v2" | "f" | "L" | "a" | "u" | "h" | "s" | "tex" | "mask", WebGLUniformLocation>;
	/** uploaded colour maps, by texture name, with the pattern rev they came from */
	textures: Map<string, { tex: WebGLTexture; rev: number }>;
	/** the vertex buffers on this context, and the frame each was last drawn in */
	buffers: Map<Batch, { buf: WebGLBuffer; used: number }>;
	frame: number;
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
	const a = (name: string) => gl.getAttribLocation(prog, name);
	const u = (name: string) => gl.getUniformLocation(prog, name)!;
	const out: Gl = {
		gl,
		prog,
		attr: { p: a("p"), n: a("n"), c: a("c"), t: a("t"), k: a("k") },
		uni: { m0: u("m0"), m1: u("m1"), m2: u("m2"), v0: u("v0"), v1: u("v1"), v2: u("v2"), f: u("f"), L: u("L"), a: u("a"), u: u("u"), h: u("h"), s: u("s"), tex: u("tex"), mask: u("mask") },
		textures: new Map(),
		buffers: new Map(),
		frame: 0,
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

/** The triangles of one part that share a texture (or none) and a culling rule, ready for the GPU. */
interface Batch {
	/** the texture's key (its name and its render's rev), null for plain colour */
	texture: string | null;
	pattern?: TexturePattern;
	/** mesh faces are one-sided (the winding is the format's promise); balls and rods are drawn whichever way they face */
	cull: boolean;
	data: Float32Array;
	count: number;
}
/** A part's shapes as triangles, and a sphere that holds them all (rest space). */
export interface PartMesh {
	batches: Batch[];
	centre: Vec3;
	radius: number;
	/** what the colours and textures were when it was built */
	stamp: string;
}

// built meshes, by the part's shapes (the array's identity: a document's own array while nothing reshapes it)
// and then by the colours that paint them (an instance with its own palette is its own mesh)
const built = new WeakMap<readonly Shape3[], Map<readonly Token[], PartMesh>>();

const stampOf = (solids: readonly Shape3[], tokens: readonly Token[], patterns?: Map<string, TexturePattern>): string => {
	let s = "";
	for (const sh of solids) {
		const c = colorOf(tokens, sh.color ?? "");
		s += `${c[0]},${c[1]},${c[2]},${c[3]}`;
		const p = sh.texture ? patterns?.get(sh.texture) : undefined;
		s += p?.canvas ? `@${sh.texture}:${p.rev};` : ";";
	}
	return s;
};

/** A part's mesh: built once and kept while its shapes, colours and textures stay as they are. */
export function partMesh(solids: readonly Shape3[], tokens: readonly Token[], patterns?: Map<string, TexturePattern>): PartMesh {
	let byTokens = built.get(solids);
	if (!byTokens) built.set(solids, (byTokens = new Map()));
	const stamp = stampOf(solids, tokens, patterns);
	const have = byTokens.get(tokens);
	if (have && have.stamp === stamp) return have;
	const mesh = build(solids, tokens, patterns, stamp);
	byTokens.set(tokens, mesh);
	return mesh;
}

function build(solids: readonly Shape3[], tokens: readonly Token[], patterns: Map<string, TexturePattern> | undefined, stamp: string): PartMesh {
	const lists = new Map<string, { texture: string | null; pattern?: TexturePattern; cull: boolean; v: number[] }>();
	let lo: Vec3 = [Infinity, Infinity, Infinity];
	let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const sh of solids) {
		const rgb = colorOf(tokens, sh.color ?? "");
		const col = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, rgb[3] / 255];
		const shade = sh.shade ?? 1;
		const pattern = sh.texture ? patterns?.get(sh.texture) : undefined;
		const cell = pattern?.texture.cell ?? [1, 1];
		// a texture name is per document; key the batch by the pattern's identity
		const texture = pattern?.canvas ? `${sh.texture}@${pattern.rev}` : null;
		const round = sh.kind === "ball" || sh.kind === "rod";
		const key = `${texture}|${round ? 0 : 1}`;
		let list = lists.get(key);
		if (!list) lists.set(key, (list = { texture, pattern: texture ? pattern : undefined, cull: !round, v: [] }));
		const v = list.v;
		const ZERO: Vec2 = [0, 0];
		/** One triangle: flat (its own normal, turned away from `out` when given) or with a normal per corner. */
		const tri = (a: Vec3, b: Vec3, c: Vec3, out?: Vec3, vn?: [Vec3, Vec3, Vec3], uv?: [Vec2, Vec2, Vec2]) => {
			let n = v3cross(v3sub(b, a), v3sub(c, a));
			if (out) {
				const mid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
				if (v3dot(n, v3sub(mid, out)) < 0) n = [-n[0], -n[1], -n[2]];
			}
			const corners = [a, b, c];
			for (let i = 0; i < 3; i++) {
				const p = corners[i];
				const nn = vn ? vn[i] : n;
				const t = uv ? uv[i] : ZERO;
				v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], col[0], col[1], col[2], col[3], t[0], t[1], shade, vn ? 1 : 0);
				if (p[0] < lo[0]) lo[0] = p[0];
				if (p[1] < lo[1]) lo[1] = p[1];
				if (p[2] < lo[2]) lo[2] = p[2];
				if (p[0] > hi[0]) hi[0] = p[0];
				if (p[1] > hi[1]) hi[1] = p[1];
				if (p[2] > hi[2]) hi[2] = p[2];
			}
		};
		if (sh.kind === "mesh" || sh.kind === "sweep") {
			// the surface a mesh or a sweep draws (1.7): subdivided when smooth, generated for a sweep
			const m = asMesh(sh);
			const cage = cageOf(sh);
			const pts = m.points;
			const cn = smoothNormals(cage) ? cornerNormals(m.points, m.faces, { angle: cage.angle, creases: (cage.smooth ?? 0) > 0 ? undefined : cage.creases }) : null;
			if (texture || cn) {
				// per face, so a corner's pattern coordinates and normal are known
				const uvs = texture ? meshUVs(sh) : null;
				m.faces.forEach((f, fi) => {
					const ft = triangulateFace(m.points, f);
					const at = (idx: number) => f.indexOf(idx);
					const uvOf = (idx: number): Vec2 => {
						const uv = uvs?.[fi]?.[at(idx)] ?? [0, 0];
						return [uv[0] / cell[0], uv[1] / cell[1]];
					};
					for (let i = 0; i + 2 < ft.length; i += 3) {
						const [i0, i1, i2] = [ft[i], ft[i + 1], ft[i + 2]];
						tri(pts[i0], pts[i1], pts[i2], undefined, cn ? [cn[fi][at(i0)], cn[fi][at(i1)], cn[fi][at(i2)]] : undefined, uvs ? [uvOf(i0), uvOf(i1), uvOf(i2)] : undefined);
					}
				});
				continue;
			}
			let tris = m.tris;
			if (!tris || tris.length % 3 !== 0 || tris.some((i) => i >= pts.length)) {
				tris = [];
				for (const f of m.faces) tris.push(...triangulateFace(m.points, f));
			}
			for (let i = 0; i + 2 < tris.length; i += 3) tri(pts[tris[i]], pts[tris[i + 1]], pts[tris[i + 2]]);
		} else if (sh.kind === "ball") {
			const c = sh.at;
			const pts = SPHERE.pts.map((p): Vec3 => [c[0] + p[0] * sh.r, c[1] + p[1] * sh.r, c[2] + p[2] * sh.r]);
			for (let i = 0; i + 2 < SPHERE.tris.length; i += 3) tri(pts[SPHERE.tris[i]], pts[SPHERE.tris[i + 1]], pts[SPHERE.tris[i + 2]], c);
		} else {
			const a = sh.a;
			const d = v3sub(sh.b, a);
			const len = Math.hypot(d[0], d[1], d[2]);
			if (len < 1e-6) continue;
			const w = v3norm(d);
			// a frame around the axis
			const seed: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
			const u = v3norm(v3cross(w, seed));
			const vv = v3cross(w, u);
			const r = sh.w / 2;
			const pts = CYL.pts.map((p): Vec3 => [
				a[0] + (u[0] * p[0] + vv[0] * p[1]) * r + w[0] * p[2] * len,
				a[1] + (u[1] * p[0] + vv[1] * p[1]) * r + w[1] * p[2] * len,
				a[2] + (u[2] * p[0] + vv[2] * p[1]) * r + w[2] * p[2] * len,
			]);
			for (let i = 0; i + 2 < CYL.tris.length; i += 3) {
				const t0 = pts[CYL.tris[i]];
				const t1 = pts[CYL.tris[i + 1]];
				const t2 = pts[CYL.tris[i + 2]];
				// the nearest point of the axis to the triangle's middle, so the caps face out too
				const mid: Vec3 = [(t0[0] + t1[0] + t2[0]) / 3, (t0[1] + t1[1] + t2[1]) / 3, (t0[2] + t1[2] + t2[2]) / 3];
				let k = v3dot(v3sub(mid, a), w) / len;
				k = k <= 0.02 ? -0.5 : k >= 0.98 ? 1.5 : k; // a cap's reference sits beyond its end
				tri(t0, t1, t2, [a[0] + d[0] * k, a[1] + d[1] * k, a[2] + d[2] * k]);
			}
		}
	}
	const some = Number.isFinite(lo[0]);
	const centre: Vec3 = some ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2] : [0, 0, 0];
	const radius = some ? Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 : 0;
	const batches: Batch[] = [...lists.values()].filter((l) => l.v.length).map((l) => ({ texture: l.texture, pattern: l.pattern, cull: l.cull, data: new Float32Array(l.v), count: l.v.length / STRIDE }));
	return { batches, centre, radius, stamp };
}

/** A part as it stands in a frame: its map from rest space (into the world, or straight into the view) and its shapes. */
export interface PosedPart {
	F: Xf3;
	solids: readonly Shape3[];
}

/**
 * A document's parts under a pose list, in the world: each part's map
 * and its shapes (a morph applied), with nothing projected. What this
 * renderer needs of a frame; the view is laid on by the shader.
 */
export function poseParts(doc: Doc3, poses: readonly StatePart3[] | undefined, instance?: Xf3): PosedPart[] {
	const parts = doc.parts ?? [];
	const list: readonly StatePart3[] = poses ?? parts.map((p) => ({ part: p.name }));
	const W = worldTransforms3(doc, poses ?? []);
	const out: PosedPart[] = [];
	for (const sp of list) {
		const part = parts.find((p) => p.name === sp.part);
		if (!part) continue;
		const w = W.get(sp.part);
		const F: Xf3 = instance ? (w ? xf3Mul(instance, w) : instance) : (w ?? IDENT);
		out.push({ F, solids: shapesOf3Posed(doc, part, sp) });
	}
	return out;
}
const IDENT: Xf3 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** One document's parts in a frame, with the tokens to paint them. */
export interface SolidLayer {
	fps: readonly PosedPart[];
	tokens: readonly Token[];
	patterns?: Map<string, TexturePattern>;
}

export interface GlView {
	W: number;
	H: number;
	dpr: number;
	pan: [number, number];
	zoom: number;
	/** the view's turn, when the parts' maps stop at the world (a scene); absent when they already include it */
	turn?: Xf3;
}

/** The model's solids, into the canvas: the frame's parts carry the view in their maps already. */
export function drawSolids(canvas: HTMLCanvasElement, _doc: Doc3, fps: readonly PosedPart[], tokens: readonly Token[], light: Vec3, ambient: number, view: GlView, patterns?: Map<string, TexturePattern>): boolean {
	return drawLayers(canvas, [{ fps, tokens, patterns }], light, ambient, view);
}

/** What the last frame cost the GPU: for scripts and the console. */
export const glStats = { draws: 0, triangles: 0, buffers: 0 };

/** Several documents' solids in one frame (a scene), one depth buffer. */
export function drawLayers(canvas: HTMLCanvasElement, layers: readonly SolidLayer[], light: Vec3, ambient: number, view: GlView): boolean {
	const g = setup(canvas);
	if (!g) return false;
	const { gl, attr, uni } = g;
	const frame = ++g.frame;
	glStats.draws = 0;
	glStats.triangles = 0;
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
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.useProgram(g.prog);
	const l = v3norm(light);
	const V = view.turn ?? IDENT;
	gl.uniform3f(uni.v0, V[0], V[1], V[2]);
	gl.uniform3f(uni.v1, V[3], V[4], V[5]);
	gl.uniform3f(uni.v2, V[6], V[7], V[8]);
	gl.uniform3f(uni.L, l[0], l[1], l[2]);
	gl.uniform1f(uni.a, ambient);
	gl.uniform3f(uni.u, view.pan[0], view.pan[1], view.zoom);
	gl.uniform2f(uni.h, view.W / 2, view.H / 2);
	gl.uniform1i(uni.s, 0);
	for (const loc of Object.values(attr)) gl.enableVertexAttribArray(loc);
	let bound: Batch | null = null;
	let tex: string | null | undefined;
	let culling: boolean | undefined;
	let front: number | undefined;
	for (const layer of layers) {
		for (const fp of layer.fps) {
			const mesh = partMesh(fp.solids, layer.tokens, layer.patterns);
			if (!mesh.batches.length) continue;
			const F = fp.F;
			const mirrored = xf3Det(F) < 0;
			gl.uniform4f(uni.m0, F[0], F[1], F[2], F[9]);
			gl.uniform4f(uni.m1, F[3], F[4], F[5], F[10]);
			gl.uniform4f(uni.m2, F[6], F[7], F[8], F[11]);
			gl.uniform1f(uni.f, mirrored ? -1 : 1);
			for (const b of mesh.batches) {
				if (b !== bound) {
					let have = g.buffers.get(b);
					if (!have) {
						have = { buf: gl.createBuffer()!, used: frame };
						gl.bindBuffer(gl.ARRAY_BUFFER, have.buf);
						gl.bufferData(gl.ARRAY_BUFFER, b.data, gl.STATIC_DRAW);
						g.buffers.set(b, have);
					} else gl.bindBuffer(gl.ARRAY_BUFFER, have.buf);
					have.used = frame;
					const B = STRIDE * 4;
					gl.vertexAttribPointer(attr.p, 3, gl.FLOAT, false, B, 0);
					gl.vertexAttribPointer(attr.n, 3, gl.FLOAT, false, B, 12);
					gl.vertexAttribPointer(attr.c, 4, gl.FLOAT, false, B, 24);
					gl.vertexAttribPointer(attr.t, 2, gl.FLOAT, false, B, 40);
					gl.vertexAttribPointer(attr.k, 2, gl.FLOAT, false, B, 48);
					bound = b;
				}
				if (b.texture !== tex) {
					tex = b.texture;
					if (b.texture && b.pattern?.canvas) {
						// the colour map as a wrapping texture, uploaded when its render changes
						let have = g.textures.get(b.texture);
						if (!have || have.rev !== b.pattern.rev) {
							const t = have?.tex ?? gl.createTexture()!;
							gl.bindTexture(gl.TEXTURE_2D, t);
							gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b.pattern.canvas);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
							gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
							have = { tex: t, rev: b.pattern.rev };
							g.textures.set(b.texture, have);
						}
						gl.activeTexture(gl.TEXTURE0);
						gl.bindTexture(gl.TEXTURE_2D, have.tex);
						gl.uniform1f(uni.tex, 1);
						gl.uniform1f(uni.mask, b.pattern.mode === "mask" ? 1 : 0);
					} else {
						gl.uniform1f(uni.tex, 0);
						gl.uniform1f(uni.mask, 0);
					}
				}
				// a face is drawn when it winds toward the viewer; a mirror reverses the winding
				if (b.cull !== culling) {
					culling = b.cull;
					if (culling) gl.enable(gl.CULL_FACE);
					else gl.disable(gl.CULL_FACE);
				}
				const ff = mirrored ? gl.CW : gl.CCW;
				if (b.cull && ff !== front) {
					front = ff;
					gl.frontFace(ff);
				}
				gl.drawArrays(gl.TRIANGLES, 0, b.count);
				glStats.draws++;
				glStats.triangles += b.count / 3;
			}
		}
	}
	glStats.buffers = g.buffers.size;
	// buffers nothing has drawn for a while (a file closed, a mesh reshaped) go back to the GPU
	if (frame % 240 === 0) {
		for (const [b, have] of g.buffers) {
			if (frame - have.used > 240) {
				gl.deleteBuffer(have.buf);
				g.buffers.delete(b);
			}
		}
	}
	return true;
}
