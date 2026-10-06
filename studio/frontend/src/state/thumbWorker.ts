// A file's picture and its index of names, made off the page's thread: a
// big model takes seconds to parse, project and paint, and the window must
// not wait for it. The page reads the text (and the palettes it draws
// from) and posts them here; back come the names and a PNG.

import { parseDoc, resolvePalettes, as3d, projectDoc, docBounds, type Doc } from "@fastart/core";
import { drawThumb } from "../canvas/draw.ts";

export interface ThumbJob {
	id: number;
	text: string;
	/** the palette files the document names, already read: ref → text */
	refs: Record<string, string>;
	px: number;
}
export interface ThumbResult {
	id: number;
	/** names only; null when the file cannot be read as a document */
	index: Doc | null;
	space3d: boolean;
	/** the picture, or null when there is nothing drawn yet */
	image: Blob | null;
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
	return { id: job.id, index, space3d: !!d3, image };
}

self.onmessage = (e: MessageEvent<ThumbJob>) => {
	void make(e.data)
		.catch((): ThumbResult => ({ id: e.data.id, index: null, space3d: false, image: null }))
		.then((r) => (self as unknown as Worker).postMessage(r));
};
