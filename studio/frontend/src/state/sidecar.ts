// Compiled sidecars in the studio (format 1.8). Wherever a model is
// shown that is not the one being edited (a scene's instances, the
// mannequin, a tile's picture, a render Claude asks for of another
// file), it is drawn from `name.fart.glb`: the triangles its shapes
// would generate, already generated. A sidecar that is missing or was
// made from other bytes is built off the page's thread and written
// beside the file, then drawn from. They are derived build artifacts:
// never opened, never listed, no part of a checkpoint or of "saved".

import { signal } from "@preact/signals";
import { SIDECAR_GENERATOR } from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { dirname, joinRel, basename } from "./paths.ts";
import { hashBytes, readCompiled, sidecarStamp, type Compiled } from "./sidecarRead.ts";
import { choose, sheetOpen } from "./prompt.ts";
import { activity, logActivity } from "./activity.ts";
import type { SidecarJob, SidecarResult } from "./sidecarWorker.ts";

export type { Compiled, CompiledPart, CompiledPrim } from "./sidecarRead.ts";

const OFF_KEY = "fastart.sidecars";
function savedOn(): boolean {
	try {
		return localStorage.getItem(OFF_KEY) !== "off";
	} catch {
		return true;
	}
}

/** How one model came to be drawn: for scripts, the console and the timings. */
export interface SidecarLine {
	rel: string;
	/** kept: in memory already; read: a fresh sidecar from disk; built: made now and written; failed: generated from the JSON instead */
	how: "kept" | "read" | "built" | "failed";
	ms: number;
	triangles: number;
	why?: string;
}

export const sidecars = {
	/** off: every screen generates from the JSON as it always did (a way out, and what the timings compare against) */
	on: signal(savedOn()),
	log: [] as SidecarLine[],
	/** builds under way */
	building: signal(0),
};
export function setSidecars(on: boolean) {
	sidecars.on.value = on;
	try {
		if (on) localStorage.removeItem(OFF_KEY);
		else localStorage.setItem(OFF_KEY, "off");
	} catch {
		// the choice lasts the session
	}
}
const note = (line: SidecarLine) => {
	sidecars.log.push(line);
	if (sidecars.log.length > 400) sidecars.log.splice(0, 200);
};

// ------------------------------------------------------------- the builder

let worker: Worker | null = null;
let jobs = 0;
const waiting = new Map<number, (r: SidecarResult) => void>();
function inWorker(job: Omit<SidecarJob, "id">): Promise<SidecarResult> {
	if (!worker) {
		worker = new Worker(new URL("./sidecarWorker.ts", import.meta.url), { type: "module" });
		worker.onmessage = (e: MessageEvent<SidecarResult>) => {
			waiting.get(e.data.id)?.(e.data);
			waiting.delete(e.data.id);
		};
		worker.onerror = () => {
			// a worker that died takes its jobs with it: answer them empty, start afresh next time
			for (const [id, done] of waiting) done({ id, glb: null, ms: 0, why: "the builder stopped" });
			waiting.clear();
			worker = null;
		};
	}
	const id = ++jobs;
	return new Promise((resolve) => {
		waiting.set(id, resolve);
		worker!.postMessage({ ...job, id });
	});
}

/** The palette files a document names, read: the builder has no way to the disk. */
export async function readRefs(root: string, rel: string, text: string): Promise<Record<string, string>> {
	const refs: Record<string, string> = {};
	const dir = dirname(rel);
	const named = /"palette_refs"\s*:\s*\[([^\]]*)\]/.exec(text.slice(0, 65536));
	for (const m of named?.[1].matchAll(/"((?:[^"\\]|\\.)*)"/g) ?? []) {
		const t = await shell.readFile(root, joinRel(dir, m[1]));
		if (t !== null) refs[m[1]] = t;
	}
	return refs;
}

/** Build a document's sidecar from its text and write it beside the file. Null, with the reason, when it cannot be built. */
async function build(root: string, rel: string, text: string): Promise<{ glb: Uint8Array | null; why?: string }> {
	sidecars.building.value++;
	// the activity view says so while nothing else is using it: a big model takes a moment
	const mine = { message: `Compiling ${basename(rel)}`, progress: null };
	if (!activity.busy.value) activity.busy.value = mine;
	try {
		const r = await inWorker({ text, refs: await readRefs(root, rel, text) });
		if (!r.glb) return { glb: null, why: r.why };
		try {
			await shell.writeSidecar(root, rel, r.glb);
			void offerIgnore(root);
		} catch (e) {
			// it cannot be kept (a folder that cannot be written): it still draws this once
			return { glb: r.glb, why: String(e) };
		}
		return { glb: r.glb };
	} finally {
		sidecars.building.value--;
		if (activity.busy.value === mine) activity.busy.value = null;
	}
}

/** A sidecar built elsewhere (the thumbnail worker): written beside its document, and the offer made. */
export async function keepSidecar(root: string, rel: string, glb: Uint8Array): Promise<void> {
	try {
		await shell.writeSidecar(root, rel, glb);
		kept.delete(`${root}:${rel}`);
		note({ rel, how: "built", ms: 0, triangles: 0 });
		void offerIgnore(root);
	} catch {
		// it could not be kept: the picture is drawn all the same
	}
}

// ------------------------------------------------------------- the reader

interface Kept {
	text: string;
	compiled: Compiled | null;
}
const kept = new Map<string, Kept>();
const flying = new Map<string, { text: string; job: Promise<Compiled | null> }>();
const partsOf = (text: string): { name: string; like?: string; pivot?: number[] }[] | null => {
	try {
		const d = JSON.parse(text) as { space?: string; parts?: { name: string; like?: string; pivot?: number[] }[] };
		return d.space === "3d" ? (d.parts ?? []) : null;
	} catch {
		return null;
	}
};

/**
 * A 3D document's triangles from its sidecar: read when the sidecar on
 * disk is of these very bytes, else built now (off the page's thread),
 * written beside the file and read. `text` is the document as it is on
 * disk. Null when sidecars are off, the file is not a 3D document, or
 * the build failed: the caller then generates from the JSON as before.
 */
export function sidecarOf(root: string, rel: string, text: string): Promise<Compiled | null> {
	if (!sidecars.on.value || !rel.endsWith(".fart")) return Promise.resolve(null);
	const key = `${root}:${rel}`;
	const have = kept.get(key);
	if (have && have.text === text) {
		note({ rel, how: "kept", ms: 0, triangles: have.compiled?.triangles ?? 0 });
		return Promise.resolve(have.compiled);
	}
	const fly = flying.get(key);
	if (fly && fly.text === text) return fly.job;
	const job = (async (): Promise<Compiled | null> => {
		const t0 = performance.now();
		const parts = partsOf(text);
		if (!parts) return null;
		const of = hashBytes(new TextEncoder().encode(text));
		let compiled: Compiled | null = null;
		let how: SidecarLine["how"] = "read";
		let why: string | undefined;
		const onDisk = await shell.readSidecar(root, rel).catch(() => null);
		const stamp = onDisk ? sidecarStamp(onDisk) : null;
		// a sidecar is used only when it is its source's: the hash of these bytes, by this generator
		if (onDisk && stamp && stamp.of === of && stamp.generator === SIDECAR_GENERATOR) compiled = readCompiled(onDisk, parts);
		if (!compiled) {
			how = "built";
			const made = await build(root, rel, text);
			why = made.why;
			compiled = made.glb ? readCompiled(made.glb, parts) : null;
			if (!compiled) how = "failed";
		}
		kept.set(key, { text, compiled });
		if (kept.size > 64) kept.delete(kept.keys().next().value!);
		note({ rel, how, ms: performance.now() - t0, triangles: compiled?.triangles ?? 0, ...(why ? { why } : {}) });
		return compiled;
	})().finally(() => {
		if (flying.get(key)?.job === job) flying.delete(key);
	});
	flying.set(key, { text, job });
	return job;
}

/**
 * The model being edited has just been checkpointed as `text`: its
 * sidecar is rebuilt behind the scenes, for whatever shows it next. The
 * editor itself goes on drawing from the live cage.
 */
export function afterCheckpoint(root: string, rel: string, text: string): void {
	if (!sidecars.on.value || !rel.endsWith(".fart")) return;
	kept.delete(`${root}:${rel}`);
	const t0 = performance.now();
	void build(root, rel, text)
		.then((made) => note({ rel, how: made.glb ? "built" : "failed", ms: performance.now() - t0, triangles: 0, ...(made.why ? { why: made.why } : {}) }))
		.catch(() => {});
}

/** How a document's sidecar stands on disk, without building anything. */
export async function sidecarState(root: string, rel: string, text: string): Promise<"fresh" | "stale" | "missing"> {
	const onDisk = await shell.readSidecar(root, rel).catch(() => null);
	if (!onDisk) return "missing";
	const stamp = sidecarStamp(onDisk);
	return stamp && stamp.of === hashBytes(new TextEncoder().encode(text)) && stamp.generator === SIDECAR_GENERATOR ? "fresh" : "stale";
}

/**
 * Build the sidecars of these documents (project paths): one that is
 * fresh already is left alone unless `force`. Answers with what was done
 * to each.
 */
export async function buildSidecars(root: string, rels: readonly string[], force = false): Promise<{ path: string; did: "built" | "fresh" | "skipped" | "failed"; bytes?: number; why?: string }[]> {
	const out: { path: string; did: "built" | "fresh" | "skipped" | "failed"; bytes?: number; why?: string }[] = [];
	for (const rel of rels) {
		const text = await shell.readFile(root, rel);
		if (text === null) {
			out.push({ path: rel, did: "failed", why: "the file is not there" });
			continue;
		}
		if (!partsOf(text)) {
			out.push({ path: rel, did: "skipped", why: "only a 3D document has a sidecar" });
			continue;
		}
		if (!force && (await sidecarState(root, rel, text)) === "fresh") {
			out.push({ path: rel, did: "fresh" });
			continue;
		}
		kept.delete(`${root}:${rel}`);
		const made = await build(root, rel, text);
		// (a build that could not be written is no build: the file on disk is what was asked for)
		if (made.glb && !made.why) out.push({ path: rel, did: "built", bytes: made.glb.length });
		else out.push({ path: rel, did: "failed", why: made.why ?? "it could not be built" });
	}
	return out;
}

// ------------------------------------------------------------- git

const ASKED = "fastart.sidecarIgnore:";
let asking = false;

/**
 * Once per project, and only when a sidecar has just been written into
 * a repository that would commit it: offer the line that keeps them out.
 * Never done without asking, never asked twice.
 */
async function offerIgnore(root: string): Promise<void> {
	if (asking) return;
	try {
		if (localStorage.getItem(ASKED + root)) return;
	} catch {
		return;
	}
	asking = true;
	try {
		if ((await shell.sidecarIgnore(root)) !== "offer") return;
		// not over another sheet: it waits its turn
		for (let i = 0; i < 240 && sheetOpen(); i++) await new Promise((r) => setTimeout(r, 500));
		if (sheetOpen()) return;
		try {
			localStorage.setItem(ASKED + root, "1");
		} catch {
			// asked again next session, then
		}
		const answer = await choose(
			"Keep compiled models out of git?",
			`Uranus keeps a compiled copy of each 3D model beside it (name.fart.glb), so a scene, a mannequin or a tile draws it at once. They are made from the .fart and made again whenever it changes, so they need not be committed. Add *.fart.glb to ${basename(root)}'s .gitignore?`,
			[
				{ id: "cancel", label: "Not now" },
				{ id: "ok", label: "Add to .gitignore", primary: true },
			],
		);
		if (answer !== "ok") return;
		await shell.ignoreSidecars(root);
		logActivity("Added *.fart.glb to .gitignore", "git-branch");
	} catch {
		// the offer is a courtesy: a failure to make it is not the user's problem
	} finally {
		asking = false;
	}
}
