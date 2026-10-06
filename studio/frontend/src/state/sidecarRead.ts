// Reading a compiled sidecar (format 1.8, `name.fart.glb`): the
// triangles a document's shapes would generate, already generated, with
// each group's palette token kept by name so a recolour needs no
// rebuild. The reader hands them back in each part's own rest space,
// the frame the studio's renderer poses, and says whose bytes the
// sidecar was made from. It also paints them (a flat-lit painter for
// thumbnails and the Ask panel's renders) and finds what a point of the
// canvas lies over.
//
// No imports: this file runs under node --test and inside a worker.

type V3 = [number, number, number];
/** rows of a 3×3 and a translation, as core's Xf3 */
type X12 = readonly number[];

/** The triangles of one shape that paint one token. */
export interface CompiledPrim {
	shape: number;
	token: string;
	/** the texture's name, on a textured shape */
	texture?: string;
	/** x, y, z per vertex in the part's rest space, three vertices a triangle */
	pos: Float32Array;
	/** unit normals, one per vertex, the same frame */
	nor: Float32Array;
	/** the shape's shade times the point's, per vertex */
	shade: Float32Array;
	/** pattern coordinates per vertex (0…1 a tile), on a textured shape */
	uv?: Float32Array;
}
export interface CompiledPart {
	prims: CompiledPrim[];
	/** a sphere that holds it (rest space) */
	centre: V3;
	radius: number;
	triangles: number;
}
export interface Compiled {
	/** by part index; null for a part that draws nothing */
	parts: (CompiledPart | null)[];
	/** the hash of the source this was made from */
	of: string;
	generator: string;
	triangles: number;
}

/** FNV-1a, 64 bits, over bytes: sixteen hex digits, as the format's `of` is. Two 32-bit halves, no big numbers: a large file hashes in a blink. */
export function hashBytes(bytes: Uint8Array): string {
	let hi = 0xcbf29ce4;
	let lo = 0x84222325;
	for (let i = 0; i < bytes.length; i++) {
		lo = (lo ^ bytes[i]) >>> 0;
		// × 0x100000001b3 = (h << 40) + h × 0x1b3, kept to 64 bits
		const l = lo * 0x1b3;
		const carry = Math.floor(l / 4294967296);
		hi = (Math.imul(hi, 0x1b3) + carry + ((lo << 8) >>> 0)) >>> 0;
		lo = l >>> 0;
	}
	return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

interface Gltf {
	asset?: { extras?: { fart?: { of?: unknown; generator?: unknown } } };
	nodes?: { name?: string; mesh?: number; extras?: { pivot?: number[] } }[];
	meshes?: { name?: string; primitives?: { attributes?: Record<string, number>; mode?: number; extras?: { shape?: number; token?: string; texture?: string } }[] }[];
	accessors?: { bufferView?: number; byteOffset?: number; count?: number; type?: string; componentType?: number }[];
	bufferViews?: { byteOffset?: number; byteLength?: number }[];
}

/** The two chunks of a binary glTF: its JSON, and its bytes. Null when the bytes are not one. */
function chunks(glb: Uint8Array): { json: Gltf; bin: Uint8Array } | null {
	if (glb.length < 20) return null;
	const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
	if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) return null;
	const len = dv.getUint32(12, true);
	if (20 + len > glb.length) return null;
	let json: Gltf;
	try {
		json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + len))) as Gltf;
	} catch {
		return null;
	}
	const at = 20 + len;
	if (at + 8 > glb.length || dv.getUint32(at + 4, true) !== 0x004e4942) return { json, bin: new Uint8Array(0) };
	const n = dv.getUint32(at, true);
	return { json, bin: glb.subarray(at + 8, Math.min(glb.length, at + 8 + n)) };
}

/** What a sidecar says it was made from, and by what; null when the bytes are no sidecar. */
export function sidecarStamp(glb: Uint8Array): { of: string; generator: string } | null {
	const f = chunks(glb)?.json.asset?.extras?.fart;
	return f && typeof f.of === "string" ? { of: f.of, generator: String(f.generator ?? "") } : null;
}

/** thrown inside the reader for an accessor that is not what the layout promises */
const BAD = new Error("not a sidecar");
const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * A sidecar as triangles in each part's rest space. `parts` are the
 * document's, in its order (node i is part i): a part drawn `like`
 * another has its source's mesh, whose positions are relative to the
 * source's pivot. Null when the bytes are not a sidecar of this shape.
 */
export function readCompiled(glb: Uint8Array, parts: readonly { name: string; like?: string; pivot?: readonly number[] }[]): Compiled | null {
	const c = chunks(glb);
	const fart = c?.json.asset?.extras?.fart;
	if (!c || !fart || typeof fart.of !== "string") return null;
	const { json, bin } = c;
	const nodes = json.nodes ?? [];
	if (nodes.length !== parts.length) return null;
	const floats = (index: number | undefined, size: number): Float32Array | null => {
		const acc = index === undefined ? undefined : json.accessors?.[index];
		const view = acc?.bufferView === undefined ? undefined : json.bufferViews?.[acc.bufferView];
		if (!acc || !view || acc.componentType !== 5126 || SIZES[acc.type ?? ""] !== size) return null;
		const at = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
		const n = (acc.count ?? 0) * size;
		if (at + n * 4 > bin.length) return null;
		// a copy: the chunk need not sit on a four-byte boundary of its buffer
		return new Float32Array(bin.slice(at, at + n * 4).buffer);
	};
	const built = new Map<number, CompiledPart | null>();
	const meshOf = (m: number, pivot: readonly number[]): CompiledPart | null => {
		if (built.has(m)) return built.get(m)!;
		const prims: CompiledPrim[] = [];
		const lo: V3 = [Infinity, Infinity, Infinity];
		const hi: V3 = [-Infinity, -Infinity, -Infinity];
		let triangles = 0;
		for (const p of json.meshes?.[m]?.primitives ?? []) {
			if ((p.mode ?? 4) !== 4) continue;
			const pos = floats(p.attributes?.POSITION, 3);
			const nor = floats(p.attributes?.NORMAL, 3);
			if (!pos || !nor || nor.length !== pos.length || pos.length % 9 !== 0) throw BAD;
			const n = pos.length / 3;
			const shade = floats(p.attributes?._SHADE, 1) ?? new Float32Array(n).fill(1);
			if (shade.length !== n) throw BAD;
			// glTF is y-up and pivot-relative: a rest point is pivot + (x, −y, −z)
			for (let i = 0; i < pos.length; i += 3) {
				pos[i] = pivot[0] + pos[i];
				pos[i + 1] = pivot[1] - pos[i + 1];
				pos[i + 2] = pivot[2] - pos[i + 2];
				nor[i + 1] = -nor[i + 1];
				nor[i + 2] = -nor[i + 2];
				for (let k = 0; k < 3; k++) {
					if (pos[i + k] < lo[k]) lo[k] = pos[i + k];
					if (pos[i + k] > hi[k]) hi[k] = pos[i + k];
				}
			}
			const prim: CompiledPrim = { shape: p.extras?.shape ?? 0, token: p.extras?.token ?? "", pos, nor, shade };
			const uv = p.extras?.texture ? floats(p.attributes?.TEXCOORD_0, 2) : null;
			if (p.extras?.texture && uv && uv.length === n * 2) {
				prim.texture = p.extras.texture;
				prim.uv = uv;
			}
			prims.push(prim);
			triangles += n / 3;
		}
		const some = triangles > 0;
		const part: CompiledPart | null = some ? { prims, centre: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2], radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2, triangles } : null;
		built.set(m, part);
		return part;
	};
	const out: (CompiledPart | null)[] = [];
	let triangles = 0;
	for (let i = 0; i < parts.length; i++) {
		const m = nodes[i].mesh;
		if (m === undefined) {
			out.push(null);
			continue;
		}
		// the mesh is its source part's: relative to that part's pivot
		const owner = parts[i].like ? (parts.find((p) => p.name === parts[i].like && !p.like) ?? parts[i]) : parts[i];
		let part: CompiledPart | null;
		try {
			part = meshOf(m, owner.pivot ?? [0, 0, 0]);
		} catch (e) {
			if (e === BAD) return null;
			throw e;
		}
		out.push(part);
		if (part) triangles += part.triangles;
	}
	return { parts: out, of: fart.of, generator: String(fart.generator ?? ""), triangles };
}

// ------------------------------------------------------------- in a frame

/** A part as a frame draws it: its triangles, and its map from rest space to the canvas (x, y on it, z away). */
export interface CompiledIn {
	part: CompiledPart;
	F: X12;
}

const apply = (F: X12, x: number, y: number, z: number): V3 => [F[0] * x + F[1] * y + F[2] * z + F[9], F[3] * x + F[4] * y + F[5] * z + F[10], F[6] * x + F[7] * y + F[8] * z + F[11]];
const det = (F: X12) => F[0] * (F[4] * F[8] - F[5] * F[7]) - F[1] * (F[3] * F[8] - F[5] * F[6]) + F[2] * (F[3] * F[7] - F[4] * F[6]);

/** The canvas bounds of compiled parts under their maps; null when there is nothing. */
export function compiledBounds(list: readonly CompiledIn[]): { lo: [number, number]; hi: [number, number] } | null {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const { part, F } of list) {
		for (const pr of part.prims) {
			const p = pr.pos;
			for (let i = 0; i < p.length; i += 3) {
				const x = F[0] * p[i] + F[1] * p[i + 1] + F[2] * p[i + 2] + F[9];
				const y = F[3] * p[i] + F[4] * p[i + 1] + F[5] * p[i + 2] + F[10];
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	return Number.isFinite(x0) ? { lo: [x0, y0], hi: [x1, y1] } : null;
}

/** How deep the nearest triangle that faces the viewer lies under a canvas point; null when none does. */
export function compiledHit(list: readonly CompiledIn[], at: readonly [number, number]): number | null {
	let best: number | null = null;
	const [px, py] = at;
	for (const { part, F } of list) {
		const flip = det(F) < 0;
		for (const pr of part.prims) {
			const p = pr.pos;
			for (let i = 0; i < p.length; i += 9) {
				const a = apply(F, p[i], p[i + 1], p[i + 2]);
				const b = apply(F, p[i + 3], p[i + 4], p[i + 5]);
				const c = apply(F, p[i + 6], p[i + 7], p[i + 8]);
				// which way the triangle turns on the canvas says whether it faces the viewer
				const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
				// (y runs down the canvas and z away: a triangle wound outward that faces the viewer turns with a negative area)
				if (Math.abs(area) < 1e-12 || area < 0 === flip) continue;
				const u = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / area;
				const v = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / area;
				const w = 1 - u - v;
				if (u < 0 || v < 0 || w < 0) continue;
				const z = u * a[2] + v * b[2] + w * c[2];
				if (best === null || z < best) best = z;
			}
		}
	}
	return best;
}

/** The little of a 2D context the painter needs: a canvas's, or an OffscreenCanvas's in a worker. */
export interface Painter {
	fillStyle: string | CanvasGradient | CanvasPattern;
	strokeStyle: string | CanvasGradient | CanvasPattern;
	lineWidth: number;
	lineJoin: CanvasLineJoin;
	beginPath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	closePath(): void;
	fill(): void;
	stroke(): void;
}

/**
 * Paint compiled parts into a square of `size` pixels, fitted with a
 * margin: the triangles that face the viewer, far to near, each lit by
 * the one flat light the projector uses and coloured by its token as
 * `colorOf` resolves it (rgba, 0…255). Returns how many were painted.
 */
export function paintCompiled(ctx: Painter, list: readonly CompiledIn[], colorOf: (token: string) => readonly number[], size: number, opts: { light?: readonly number[]; ambient?: number; pad?: number } = {}): number {
	const b = compiledBounds(list);
	if (!b) return 0;
	const L = opts.light ?? [-1, -2, -3];
	const ll = Math.hypot(L[0], L[1], L[2]) || 1;
	const light: V3 = [L[0] / ll, L[1] / ll, L[2] / ll];
	const ambient = Math.min(1, Math.max(0, opts.ambient ?? 0.4));
	const pad = opts.pad ?? 0.08;
	const span = Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], 1e-6);
	const s = (size * (1 - 2 * pad)) / span;
	const ox = size / 2 - ((b.lo[0] + b.hi[0]) / 2) * s;
	const oy = size / 2 - ((b.lo[1] + b.hi[1]) / 2) * s;
	// one list of what faces the viewer: six numbers of outline, a depth, a colour
	let total = 0;
	for (const { part } of list) total += part.triangles;
	const xy = new Float32Array(total * 6);
	const depth = new Float32Array(total);
	const css: string[] = [];
	const cssOf = new Map<string, string>();
	let n = 0;
	for (const { part, F } of list) {
		const flip = det(F) < 0;
		const scale = Math.cbrt(Math.abs(det(F))) || 1;
		for (const pr of part.prims) {
			const rgb = colorOf(pr.token);
			const p = pr.pos;
			const nr = pr.nor;
			for (let i = 0, t = 0; i < p.length; i += 9, t += 3) {
				const a = apply(F, p[i], p[i + 1], p[i + 2]);
				const bb = apply(F, p[i + 3], p[i + 4], p[i + 5]);
				const c = apply(F, p[i + 6], p[i + 7], p[i + 8]);
				const area = (bb[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (bb[1] - a[1]);
				if (area < 0 === flip || Math.abs(area) < 1e-12) continue;
				// the corner normals' mean, turned with the part: a smooth shape shades softly, a flat one by its face
				let nx = (nr[i] + nr[i + 3] + nr[i + 6]) / 3;
				let ny = (nr[i + 1] + nr[i + 4] + nr[i + 7]) / 3;
				let nz = (nr[i + 2] + nr[i + 5] + nr[i + 8]) / 3;
				const vx = (F[0] * nx + F[1] * ny + F[2] * nz) / scale;
				const vy = (F[3] * nx + F[4] * ny + F[5] * nz) / scale;
				const vz = (F[6] * nx + F[7] * ny + F[8] * nz) / scale;
				const k = flip ? -1 : 1;
				nx = vx * k;
				ny = vy * k;
				nz = vz * k;
				const nl = Math.hypot(nx, ny, nz) || 1;
				const lit = Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / nl);
				const own = (pr.shade[t] + pr.shade[t + 1] + pr.shade[t + 2]) / 3;
				const sh = Math.round((ambient + (1 - ambient) * lit) * own * 32) / 32;
				const key = `${pr.token}|${sh}`;
				let col = cssOf.get(key);
				if (!col) {
					col = `rgba(${Math.min(255, Math.round(rgb[0] * sh))},${Math.min(255, Math.round(rgb[1] * sh))},${Math.min(255, Math.round(rgb[2] * sh))},${(rgb[3] ?? 255) / 255})`;
					cssOf.set(key, col);
				}
				xy.set([a[0] * s + ox, a[1] * s + oy, bb[0] * s + ox, bb[1] * s + oy, c[0] * s + ox, c[1] * s + oy], n * 6);
				depth[n] = (a[2] + bb[2] + c[2]) / 3;
				css[n] = col;
				n++;
			}
		}
	}
	const order = new Uint32Array(n);
	for (let i = 0; i < n; i++) order[i] = i;
	order.sort((p, q) => depth[q] - depth[p]);
	ctx.lineWidth = 0.75;
	ctx.lineJoin = "round";
	// runs of one colour go down as one path: far fewer fills on a model of one or two tokens
	let run = "";
	const flush = () => {
		if (!run) return;
		ctx.fillStyle = run;
		ctx.strokeStyle = run;
		ctx.fill();
		// a hairline of the same colour closes the seams antialiasing leaves between neighbours
		ctx.stroke();
		run = "";
	};
	for (let k = 0; k < n; k++) {
		const i = order[k];
		if (css[i] !== run) {
			flush();
			run = css[i];
			ctx.beginPath();
		}
		const o = i * 6;
		ctx.moveTo(xy[o], xy[o + 1]);
		ctx.lineTo(xy[o + 2], xy[o + 3]);
		ctx.lineTo(xy[o + 4], xy[o + 5]);
		ctx.closePath();
	}
	flush();
	return n;
}
