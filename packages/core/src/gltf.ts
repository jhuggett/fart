// glTF 2.0 export (1.3): a 3D document as a .glb for engines that will
// not parse JSON meshes. One node per part (children under parents, the
// pivot as the node's origin), one mesh per part with a primitive per
// shape (flat triangles, face normals, the token's colour times the shade
// as COLOR_0), one plain material, and a linear animation per clip,
// sampled at a frame rate with targets reached. Y-up, as glTF wants.

import type { Doc3, Token, Vec3 } from "./types.ts";
import { colorOf, shadeColor } from "./palette.ts";
import { flattenPart, yUp } from "./solids.ts";
import { pivotOf3, quatFromEuler, sampleClip3, sampleTargets3, clipDuration3, type Quat } from "./space3.ts";
import { solveTargets3 } from "./ik3.ts";

export interface GltfOptions {
	/** the resolved palette; the document's own when absent */
	tokens?: readonly Token[];
	/** animation samples per second, default 24 */
	fps?: number;
}

const FLOAT = 5126;
const ARRAY_BUFFER = 34962;

/** A rotation in the format's frame, seen from y-up (a half turn about x either side). */
function quatYUp(q: Quat): Quat {
	return [q[0], -q[1], -q[2], q[3]];
}

/** The document as a binary glTF. */
export function toGlb(doc: Doc3, opts: GltfOptions = {}): Uint8Array {
	const tokens = opts.tokens ?? doc.palette ?? [];
	const fps = opts.fps && opts.fps > 0 ? opts.fps : 24;
	const parts = doc.parts ?? [];
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	const bufferViews: Record<string, unknown>[] = [];
	const accessors: Record<string, unknown>[] = [];
	const pushView = (data: Float32Array, target?: number): number => {
		const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		const pad = (4 - (bytes.length % 4)) % 4;
		chunks.push(bytes);
		if (pad) chunks.push(new Uint8Array(pad));
		const view: Record<string, unknown> = { buffer: 0, byteOffset: byteLength, byteLength: bytes.length };
		if (target !== undefined) view.target = target;
		bufferViews.push(view);
		byteLength += bytes.length + pad;
		return bufferViews.length - 1;
	};
	const pushAccessor = (data: Float32Array, type: "SCALAR" | "VEC3" | "VEC4", target?: number, bounds = false): number => {
		const view = pushView(data, target);
		const n = type === "SCALAR" ? 1 : type === "VEC3" ? 3 : 4;
		const acc: Record<string, unknown> = { bufferView: view, componentType: FLOAT, count: data.length / n, type };
		if (bounds) {
			const min = new Array(n).fill(Infinity);
			const max = new Array(n).fill(-Infinity);
			for (let i = 0; i < data.length; i++) {
				min[i % n] = Math.min(min[i % n], data[i]);
				max[i % n] = Math.max(max[i % n], data[i]);
			}
			acc.min = min;
			acc.max = max;
		}
		accessors.push(acc);
		return accessors.length - 1;
	};

	// meshes: one per part with geometry of its own; `like` parts share the source's
	const meshes: Record<string, unknown>[] = [];
	const meshOf = new Map<string, number>();
	for (const part of parts) {
		const src = part.like && parts.some((p) => p.name === part.like) ? part.like : part.name;
		if (meshOf.has(src)) {
			meshOf.set(part.name, meshOf.get(src)!);
			continue;
		}
		const srcPart = parts.find((p) => p.name === src)!;
		const pivot = pivotOf3(srcPart);
		const primitives: Record<string, unknown>[] = [];
		for (const tm of flattenPart(doc, srcPart)) {
			if (!tm.count) continue;
			const pos = new Float32Array(tm.positions.length);
			const nor = new Float32Array(tm.normals.length);
			for (let i = 0; i < tm.positions.length; i += 3) {
				const p = yUp([tm.positions[i] - pivot[0], tm.positions[i + 1] - pivot[1], tm.positions[i + 2] - pivot[2]]);
				const n = yUp([tm.normals[i], tm.normals[i + 1], tm.normals[i + 2]]);
				pos.set(p, i);
				nor.set(n, i);
			}
			const rgba = shadeColor(colorOf(tokens, tm.color ?? ""), tm.shade);
			const col = new Float32Array((tm.positions.length / 3) * 4);
			for (let v = 0; v < tm.positions.length / 3; v++) col.set([rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3] / 255], v * 4);
			primitives.push({
				attributes: { POSITION: pushAccessor(pos, "VEC3", ARRAY_BUFFER, true), NORMAL: pushAccessor(nor, "VEC3", ARRAY_BUFFER), COLOR_0: pushAccessor(col, "VEC4", ARRAY_BUFFER) },
				material: 0,
				mode: 4,
			});
		}
		if (primitives.length) {
			meshes.push({ name: src, primitives });
			meshOf.set(src, meshes.length - 1);
			if (part.name !== src) meshOf.set(part.name, meshes.length - 1);
		}
	}

	// nodes: a part's origin is its pivot; a child's translation is from its parent's pivot
	const index = new Map(parts.map((p, i) => [p.name, i]));
	const parentPivot = (p: (typeof parts)[number]): Vec3 => {
		const par = p.parent ? parts.find((q) => q.name === p.parent) : undefined;
		return par ? pivotOf3(par) : [0, 0, 0];
	};
	const nodes: Record<string, unknown>[] = parts.map((p) => {
		const pv = pivotOf3(p);
		const pp = parentPivot(p);
		const node: Record<string, unknown> = { name: p.name, translation: yUp([pv[0] - pp[0], pv[1] - pp[1], pv[2] - pp[2]]) };
		const m = meshOf.get(p.name);
		if (m !== undefined) node.mesh = m;
		return node;
	});
	parts.forEach((p, i) => {
		if (!p.parent || !index.has(p.parent)) return;
		const par = nodes[index.get(p.parent)!];
		(par.children as number[] | undefined) ? (par.children as number[]).push(i) : (par.children = [i]);
	});
	const roots = parts.map((_, i) => i).filter((i) => !parts[i].parent || !index.has(parts[i].parent!));

	// animations: every clip, sampled; a part left out of a frame stands at rest
	const animations: Record<string, unknown>[] = [];
	for (const clip of doc.clips ?? []) {
		const dur = clipDuration3(clip);
		const n = Math.max(2, Math.ceil(dur * fps) + 1);
		const times = new Float32Array(n);
		const tr = parts.map(() => new Float32Array(n * 3));
		const ro = parts.map(() => new Float32Array(n * 4));
		const sc = parts.map(() => new Float32Array(n * 3));
		for (let k = 0; k < n; k++) {
			const t = (k / (n - 1)) * dur;
			times[k] = t;
			const poses = sampleClip3(doc, clip, t);
			const tg = sampleTargets3(doc, clip, t);
			if (tg.length) solveTargets3(doc, poses, tg);
			parts.forEach((p, i) => {
				const sp = poses.find((x) => x.part === p.name);
				const pv = pivotOf3(p);
				const pp = parentPivot(p);
				const off = sp?.offset ?? pv;
				const s = sp?.scale === undefined || sp.scale === 0 ? 1 : sp.scale;
				tr[i].set(yUp([off[0] - pp[0], off[1] - pp[1], off[2] - pp[2]]), k * 3);
				ro[i].set(quatYUp(quatFromEuler(sp?.rotate ?? [0, 0, 0])), k * 4);
				sc[i].set([sp?.mirror ? -s : s, s, s], k * 3);
			});
		}
		const timeAcc = pushAccessor(times, "SCALAR", undefined, true);
		const samplers: Record<string, unknown>[] = [];
		const channels: Record<string, unknown>[] = [];
		parts.forEach((_, i) => {
			for (const [path, data, type] of [["translation", tr[i], "VEC3"], ["rotation", ro[i], "VEC4"], ["scale", sc[i], "VEC3"]] as const) {
				samplers.push({ input: timeAcc, output: pushAccessor(data, type), interpolation: "LINEAR" });
				channels.push({ sampler: samplers.length - 1, target: { node: i, path } });
			}
		});
		animations.push({ name: clip.name, samplers, channels });
	}

	const gltf: Record<string, unknown> = {
		asset: { version: "2.0", generator: "fastart" },
		scene: 0,
		scenes: [{ name: doc.name ?? "fart", nodes: roots }],
		nodes,
		meshes,
		materials: [{ name: "flat", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: false }],
		accessors,
		bufferViews,
		buffers: [{ byteLength }],
	};
	if (animations.length) gltf.animations = animations;

	// the container: header, a JSON chunk padded with spaces, a BIN chunk padded with zeros
	const json = new TextEncoder().encode(JSON.stringify(gltf));
	const jsonPad = (4 - (json.length % 4)) % 4;
	const bin = new Uint8Array(byteLength);
	let off = 0;
	for (const c of chunks) {
		bin.set(c, off);
		off += c.length;
	}
	const total = 12 + 8 + json.length + jsonPad + 8 + byteLength;
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, json.length + jsonPad, true);
	dv.setUint32(16, 0x4e4f534a, true);
	out.set(json, 20);
	out.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);
	const binAt = 20 + json.length + jsonPad;
	dv.setUint32(binAt, byteLength, true);
	dv.setUint32(binAt + 4, 0x004e4942, true);
	out.set(bin, binAt + 8);
	return out;
}
