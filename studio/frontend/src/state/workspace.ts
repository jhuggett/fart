// The studio's own notes about a document: what helps while modelling
// and is no part of the art. Reference images pinned to a view, the
// mannequin shown under the model, which meshes are edited in symmetry.
// Remembered per document on this device; never written into the .fart.

import { signal } from "@preact/signals";
import { shell } from "../shell/shell.ts";

/** The views an image can be pinned to. Side is the right view. */
export type RefView = "front" | "side" | "top";
export const REF_VIEWS: RefView[] = ["front", "side", "top"];

/** An image file of the project behind the model, in one view: its middle, its width in the canvas's units, how much of it shows. */
export interface RefImage {
	path: string;
	x: number;
	y: number;
	w: number;
	opacity: number;
}
/** Another model of the project shown under this one, dimmed, in one of its states. */
export interface Mannequin {
	path: string;
	state?: string;
}
export interface Work {
	refs?: Partial<Record<RefView, RefImage>>;
	mannequin?: Mannequin;
	/** meshes edited in symmetry across x, as "part/shape index" */
	mirror?: string[];
	/** pipes kept as mirrored twins across x: "part/shape index" to its twin's shape index, both ways */
	twins?: Record<string, number>;
}

export type Shading = "plain" | "clay";
const SHADING_KEY = "fastart.shading";
function savedShading(): Shading {
	try {
		return localStorage.getItem(SHADING_KEY) === "clay" ? "clay" : "plain";
	} catch {
		return "plain";
	}
}

/** The notes of the document that is open. */
export const work = signal<Work>({});
/** How the model canvas lights its solids: a preference of this device. */
export const shading = signal<Shading>(savedShading());
/** Bumped when a reference image finishes loading: the canvas draws again. */
export const refRev = signal(0);

let key: string | null = null;
const keyOf = (root: string, rel: string) => `fastart.work:${root}:${rel}`;

export function loadWork(root: string, rel: string) {
	key = keyOf(root, rel);
	let w: Work = {};
	try {
		const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as Work;
		if (raw && typeof raw === "object") w = raw;
	} catch {
		// notes that cannot be read are no notes
	}
	work.value = w;
}
export function leaveWork() {
	key = null;
	work.value = {};
}
/** Change the notes; they are kept at once. */
export function patchWork(fn: (w: Work) => void) {
	const next = JSON.parse(JSON.stringify(work.value)) as Work;
	fn(next);
	if (next.refs && !Object.keys(next.refs).length) delete next.refs;
	if (next.mirror && !next.mirror.length) delete next.mirror;
	if (next.twins && !Object.keys(next.twins).length) delete next.twins;
	work.value = next;
	if (!key) return;
	try {
		if (Object.keys(next).length) localStorage.setItem(key, JSON.stringify(next));
		else localStorage.removeItem(key);
	} catch {
		// the notes last the session
	}
}
export function setShading(s: Shading) {
	shading.value = s;
	try {
		localStorage.setItem(SHADING_KEY, s);
	} catch {
		// the choice lasts the session
	}
}

// ------------------------------------------------------------- symmetry

const mirrorKey = (part: string, shape: number) => `${part}/${shape}`;
export function mirrorOn(part: string, shape: number): boolean {
	return (work.value.mirror ?? []).includes(mirrorKey(part, shape));
}
export function setMirror(part: string, shape: number, on: boolean) {
	const k = mirrorKey(part, shape);
	patchWork((w) => {
		const rest = (w.mirror ?? []).filter((x) => x !== k);
		w.mirror = on ? [...rest, k] : rest;
	});
}

/** The shape a pipe is twinned with across x, by its index in the same part; null when it has none. */
export function twinOf(part: string, shape: number): number | null {
	const j = work.value.twins?.[mirrorKey(part, shape)];
	return typeof j === "number" ? j : null;
}
/** Pair two shapes of a part as mirrored twins, or (with null) let a shape's pairing go. */
export function setTwin(part: string, shape: number, twin: number | null) {
	patchWork((w) => {
		const t = (w.twins ??= {});
		const was = t[mirrorKey(part, shape)];
		delete t[mirrorKey(part, shape)];
		if (typeof was === "number") delete t[mirrorKey(part, was)];
		if (twin !== null) {
			t[mirrorKey(part, shape)] = twin;
			t[mirrorKey(part, twin)] = shape;
		}
	});
}

// ------------------------------------------------------------- reference images

/** The view a pin shows in, by the model screen's view name. */
export function refViewOf(viewName: string): RefView | null {
	if (viewName === "front") return "front";
	if (viewName === "right" || viewName === "side") return "side";
	if (viewName === "top") return "top";
	return null;
}

const images = new Map<string, { img: HTMLImageElement; ok: boolean; failed: boolean }>();
/** The image of a path, once it has loaded; asking starts the load. */
export function refImage(root: string, rel: string): HTMLImageElement | null {
	const k = `${root}:${rel}`;
	const have = images.get(k);
	if (have) return have.ok ? have.img : null;
	const entry = { img: new Image(), ok: false, failed: false };
	images.set(k, entry);
	void shell.readImage(root, rel).then((url) => {
		if (!url) {
			entry.failed = true;
			refRev.value++;
			return;
		}
		entry.img.onload = () => {
			entry.ok = true;
			refRev.value++;
		};
		entry.img.onerror = () => {
			entry.failed = true;
			refRev.value++;
		};
		entry.img.src = url;
	});
	return null;
}
/** A pinned image that could not be read (the file moved, or is no image). */
export function refFailed(root: string, rel: string): boolean {
	return !!images.get(`${root}:${rel}`)?.failed;
}
/** Forget what was loaded for a path: the file may have changed. */
export function refForget(root: string, rel: string) {
	images.delete(`${root}:${rel}`);
}

export function setRef(v: RefView, patch: Partial<RefImage> | null) {
	patchWork((w) => {
		w.refs ??= {};
		if (patch === null) delete w.refs[v];
		else w.refs[v] = { path: "", x: 0, y: 0, w: 20, opacity: 0.5, ...(w.refs[v] ?? {}), ...patch };
	});
}

export function setMannequin(m: Mannequin | null) {
	patchWork((w) => {
		if (m) w.mannequin = m;
		else delete w.mannequin;
	});
}
