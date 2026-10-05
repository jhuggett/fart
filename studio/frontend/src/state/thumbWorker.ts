// A file's picture and its index of names, made off the page's thread: a
// big model takes seconds to parse, project and paint, and the window must
// not wait for it. The page reads the text (and the palettes it draws
// from) and posts them here; back come the names and a PNG.

import { parseDoc, resolvePalettes, as3d, projectDoc, docBounds, buildSidecar, colorOf, viewXf3, worldTransforms3, xf3Mul, SIDECAR_GENERATOR, type Doc, type Doc3, type Token } from "@fastart/core";
import { drawThumb } from "../canvas/draw.ts";
import { hashBytes, paintCompiled, readCompiled, sidecarStamp, type CompiledIn, type Painter } from "./sidecarRead.ts";

export interface ThumbJob {
	id: number;
	text: string;
	/** the palette files the document names, already read: ref → text */
	refs: Record<string, string>;
	px: number;
	/** a 3D file's compiled sidecar as it is on disk (1.8), when it has one: the picture is painted from it */
	glb?: Uint8Array | null;
	/** paint a 3D file from its sidecar, building one when the one on disk is missing or stale */
	sidecar?: boolean;
}
export interface ThumbResult {
	id: number;
	/** names only; null when the file cannot be read as a document */
	index: Doc | null;
	space3d: boolean;
	/** the picture, or null when there is nothing drawn yet */
	image: Blob | null;
	/** a sidecar built here because the file had none that was fresh: for the page to write beside it */
	built?: Uint8Array;
	/** how a 3D file's picture was made: from its sidecar (read, or built first), or generated from the JSON */
	how?: "read" | "built" | "generated";
}

/** A 3D document's front view from its compiled triangles; null when they cannot be read. */
function paintSidecar(d3: Doc3, glb: Uint8Array, tokens: readonly Token[], px: number): OffscreenCanvas | null {
	const compiled = readCompiled(glb, d3.parts ?? []);
	if (!compiled) return null;
	const poses = d3.states?.[0]?.parts;
	const W = worldTransforms3(d3, poses ?? []);
	const V = viewXf3("front");
	const list: CompiledIn[] = [];
	(d3.parts ?? []).forEach((part, i) => {
		const c = compiled.parts[i];
		// a part the first state leaves out is not in the picture
		if (!c || (poses && !poses.some((sp) => sp.part === part.name))) return;
		const w = W.get(part.name);
		list.push({ part: c, F: w ? xf3Mul(V, w) : V });
	});
	const canvas = new OffscreenCanvas(px, px);
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	return paintCompiled(ctx as unknown as Painter, list, (t) => colorOf(tokens, t), px) > 0 ? canvas : null;
}

/** The names a file holds, without its geometry: what search and the menus read. */
function indexOf(doc: Doc): Doc {
	const out = { version: doc.version, name: doc.name } as Doc;
	if (doc.palette) out.palette = doc.palette.map((t) => ({ name: t.name, rgb: t.rgb }));
	if (doc.palette_refs) out.palette_refs = [...doc.palette_refs];
	if (doc.parts) out.parts = doc.parts.map((p) => ({ name: p.name })) as Doc["parts"];
	if (doc.states) out.states = doc.states.map((s) => ({ name: s.name, parts: [] }));
	if (doc.clips) out.clips = doc.clips.map((c) => ({ name: c.name, keys: [] })) as Doc["clips"];
	return out;
}

async function make(job: ThumbJob): Promise<ThumbResult> {
	const none: ThumbResult = { id: job.id, index: null, space3d: false, image: null };
	let doc: Doc | null = null;
	try {
		const r = parseDoc(job.text);
		doc = r.doc ?? (r.report.errors.every((e) => !["json", "version", "schema"].includes(e.code)) ? (JSON.parse(job.text) as Doc) : null);
	} catch {
		doc = null;
	}
	if (!doc) return none;
	const index = indexOf(doc);
	// a 3D file shows its front view
	const d3 = as3d(doc);
	if (d3 && job.sidecar) {
		// from its compiled sidecar: the one on disk when it is of these bytes, else one built now
		try {
			const { tokens } = await resolvePalettes(doc, async (ref) => job.refs[ref] ?? null);
			const bytes = new TextEncoder().encode(job.text);
			const stamp = job.glb ? sidecarStamp(job.glb) : null;
			const fresh = !!job.glb && !!stamp && stamp.of === hashBytes(bytes) && stamp.generator === SIDECAR_GENERATOR;
			const glb = fresh ? job.glb! : buildSidecar(d3, bytes, { tokens });
			const canvas = paintSidecar(d3, glb, tokens, job.px);
			if (canvas) return { id: job.id, index, space3d: true, image: await canvas.convertToBlob({ type: "image/png" }), how: fresh ? "read" : "built", ...(fresh ? {} : { built: glb }) };
			// nothing drawn yet: the kind's glyph, and a sidecar all the same
			if ((d3.parts ?? []).every((p) => !(p.shapes ?? []).length)) return { id: job.id, index, space3d: true, image: null, how: fresh ? "read" : "built", ...(fresh ? {} : { built: glb }) };
		} catch {
			// a file the builder cannot take is projected as ever, below
		}
	}
	if (d3) {
		try {
			doc = projectDoc(d3, { view: "front" });
		} catch {
			return { ...none, index, space3d: true };
		}
	}
	const { tokens } = await resolvePalettes(doc, async (ref) => job.refs[ref] ?? null);
	let image: Blob | null = null;
	// parts with nothing drawn yet keep the kind's glyph
	if (docBounds(doc) || !doc.parts?.length) {
		const canvas = new OffscreenCanvas(job.px, job.px);
		drawThumb(canvas as unknown as HTMLCanvasElement, doc, tokens, job.px);
		image = await canvas.convertToBlob({ type: "image/png" });
	}
	return { id: job.id, index, space3d: !!d3, image, ...(d3 ? { how: "generated" as const } : {}) };
}

self.onmessage = (e: MessageEvent<ThumbJob>) => {
	void make(e.data)
		.catch((): ThumbResult => ({ id: e.data.id, index: null, space3d: false, image: null }))
		.then((r) => (self as unknown as Worker).postMessage(r, r.built ? [r.built.buffer as ArrayBuffer] : []));
};
