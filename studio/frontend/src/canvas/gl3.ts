// The solids of the model, drawn with WebGL under the 2D overlay: flat
// shaded triangles with a depth buffer, so a ball half sunk in a face
// shows its front half whichever way the model is turned. Everything is
// worked out in JS per frame (the models are small): view-space
// positions through each part's map, one colour per triangle from the
// same light the projector uses; the shader only places and paints.

import { colorOf, shadeColor, shapesOf3, triangulateFace, v3cross, v3dot, v3norm, v3sub, xf3Apply, xf3Det, xf3Scale, type Doc3, type FramePart, type Token, type Vec3 } from "@fastart/core";

const VS = `attribute vec3 p; attribute vec4 c; uniform vec3 u; uniform vec2 h; varying vec4 vc;
void main() { gl_Position = vec4((p.x - u.x) * u.z / h.x, -(p.y - u.y) * u.z / h.y, p.z / 4000.0, 1.0); vc = c; }`;
const FS = `precision mediump float; varying vec4 vc; void main() { gl_FragColor = vc; }`;

interface Gl {
	gl: WebGLRenderingContext;
	prog: WebGLProgram;
	pBuf: WebGLBuffer;
	cBuf: WebGLBuffer;
	pLoc: number;
	cLoc: number;
	uLoc: WebGLUniformLocation;
	hLoc: WebGLUniformLocation;
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
		pLoc: gl.getAttribLocation(prog, "p"),
		cLoc: gl.getAttribLocation(prog, "c"),
		uLoc: gl.getUniformLocation(prog, "u")!,
		hLoc: gl.getUniformLocation(prog, "h")!,
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

/** The model's solids in view space, into the canvas. */
export function drawSolids(canvas: HTMLCanvasElement, doc: Doc3, fps: FramePart[], tokens: readonly Token[], light: Vec3, ambient: number, view: { W: number; H: number; dpr: number; pan: [number, number]; zoom: number }): boolean {
	const g = setup(canvas);
	if (!g) return false;
	const { gl } = g;
	const l = v3norm(light);
	const pos: number[] = [];
	const col: number[] = [];
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
		const [r, gg, bb, al] = shadeColor(rgb, (ambient + (1 - ambient) * lit) * (shade ?? 1));
		pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
		const cc = [r / 255, gg / 255, bb / 255, al / 255];
		col.push(...cc, ...cc, ...cc);
	};
	for (const fp of fps) {
		const F = fp.F;
		const flip = xf3Det(F) < 0;
		const s = xf3Scale(F);
		for (const sh of shapesOf3(doc, fp.part)) {
			const rgb = colorOf(tokens, sh.color ?? "");
			if (sh.kind === "mesh") {
				const pts = sh.points.map((p) => xf3Apply(F, p));
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
	if (!pos.length) return true;
	gl.useProgram(g.prog);
	gl.bindBuffer(gl.ARRAY_BUFFER, g.pBuf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(g.pLoc);
	gl.vertexAttribPointer(g.pLoc, 3, gl.FLOAT, false, 0, 0);
	gl.bindBuffer(gl.ARRAY_BUFFER, g.cBuf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);
	gl.enableVertexAttribArray(g.cLoc);
	gl.vertexAttribPointer(g.cLoc, 4, gl.FLOAT, false, 0, 0);
	gl.uniform3f(g.uLoc, view.pan[0], view.pan[1], view.zoom);
	gl.uniform2f(g.hLoc, view.W / 2, view.H / 2);
	gl.drawArrays(gl.TRIANGLES, 0, pos.length / 3);
	return true;
}
