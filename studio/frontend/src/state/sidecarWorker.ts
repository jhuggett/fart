// A model's compiled sidecar (format 1.8), made off the page's thread:
// generating every mesh of a big document (sweeps, modifiers,
// subdivision) takes seconds, and the window must not wait for it. The
// page posts the file's text and the palettes it draws from; back come
// the sidecar's bytes, for the page to write beside the file.

import { parseDoc, resolvePalettes, as3d, buildSidecar, type Doc } from "@fastart/core";

export interface SidecarJob {
	id: number;
	text: string;
	/** the palette files the document names, already read: ref → text */
	refs: Record<string, string>;
}
export interface SidecarResult {
	id: number;
	/** the sidecar, or null when the file is not a 3D document that can be built */
	glb: Uint8Array | null;
	ms: number;
	why?: string;
}

async function make(job: SidecarJob): Promise<SidecarResult> {
	const t0 = performance.now();
	const r = parseDoc(job.text);
	const doc: Doc | null = r.doc ?? null;
	const d3 = doc ? as3d(doc) : null;
	if (!doc || !d3) return { id: job.id, glb: null, ms: 0, why: r.report.errors[0]?.message ?? "not a 3D document" };
	const { tokens } = await resolvePalettes(doc, async (ref) => job.refs[ref] ?? null);
	// the hash is of the file's bytes as they are on disk: the text the page read, as UTF-8
	const glb = buildSidecar(d3, new TextEncoder().encode(job.text), { tokens });
	return { id: job.id, glb, ms: performance.now() - t0 };
}

self.onmessage = (e: MessageEvent<SidecarJob>) => {
	void make(e.data)
		.catch((err): SidecarResult => ({ id: e.data.id, glb: null, ms: 0, why: String(err) }))
		.then((r) => (self as unknown as Worker).postMessage(r, r.glb ? [r.glb.buffer as ArrayBuffer] : []));
};
