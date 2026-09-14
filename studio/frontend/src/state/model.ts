// The model store: a 3D file (space: "3d") open in the model screen. The
// same shape as the editor store, with a third coordinate: the document,
// which part, state and clip are current, the selection, the tool, and
// the view (a turn laid on the model; the camera's pan and zoom are the
// 2D view's). Edits land on disk within a moment; ⌘S is the checkpoint.

import { signal, batch } from "@preact/signals";
import {
	parseDoc,
	validate,
	stringifyDoc,
	resolvePalettes,
	bakeTris3,
	sampleClip3,
	projectDoc,
	projectFrame,
	setHull,
	quatAxis,
	quatFromEuler,
	quatMul,
	quatToEuler,
	stringifyDoc as text3,
	xf3Invert,
	xf3Apply,
	xf3ApplyDir,
	xf3Det,
	VIEWS,
	DEFAULT_LIGHT,
	DEFAULT_AMBIENT,
	type Doc3,
	type Part3,
	type Shape3,
	type State3,
	type StatePart3,
	type Clip3,
	type Token,
	type Vec2,
	type Vec3,
	type Ease,
	type FramePart,
	type Issue,
	type Rgba,
} from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { project, refreshFiles } from "./project.ts";
import { dirname, joinRel } from "./paths.ts";
import { clearLocal } from "./local.ts";

export type Tool3 = "select" | "rect" | "circle" | "line" | "poly";
/** A shape of a part. */
export interface Sel3 {
	part: number;
	shape: number;
}

export const md = {
	doc: signal<Doc3>({ version: 1, space: "3d" }),
	path: signal<string | null>(null),
	rev: signal(0),
	tool: signal<Tool3>("select"),
	/** the view: a turn laid on the model, [x, y, z] radians */
	turn: signal<Vec3>([0, 0, 0]),
	/** the named view the turn is, "" once orbited */
	viewName: signal("front"),
	light: signal<Vec3>(DEFAULT_LIGHT),
	ambient: signal(DEFAULT_AMBIENT),
	/** draw silhouettes in the viewport */
	outline: signal(false),
	/** show the collision solids as wireframes, posed with the frame (1.4) */
	collide: signal(false),
	/** how deep a new box, prism, ball or rod is, along the view axis */
	thick: signal(2),
	curPart: signal(0),
	curState: signal(0),
	curClip: signal(-1),
	curKey: signal(-1),
	clipTime: signal(0),
	playing: signal(false),
	sel: signal<Sel3 | null>(null),
	/** a corner of the selected mesh */
	vert: signal<number | null>(null),
	hover: signal<Sel3 | null>(null),
	/** a polygon being drawn, in view space */
	polyPts: signal<Vec2[]>([]),
	pending: signal<"none" | "pivot">("none"),
	tokens: signal<Token[]>([]),
	shared: signal<Token[]>([]),
	unresolved: signal<string[]>([]),
	issues: signal<Issue[]>([]),
	dirty: signal(false),
	written: signal(0),
	checkpointAt: signal(0),
	canUndo: signal(false),
	canRedo: signal(false),
	space: false,
};

// ------------------------------------------------------------- access

export function doc(): Doc3 {
	void md.rev.value;
	return md.doc.value;
}
export function parts(): Part3[] {
	return doc().parts ?? [];
}
export function states(): State3[] {
	return doc().states ?? [];
}
export function clips(): Clip3[] {
	return doc().clips ?? [];
}
export function palette(): Token[] {
	return doc().palette ?? [];
}
export function curPart(): Part3 | undefined {
	return parts()[md.curPart.value];
}
export function curState(): State3 | undefined {
	return states()[md.curState.value];
}
export function curClip(): Clip3 | undefined {
	return md.curClip.value >= 0 ? clips()[md.curClip.value] : undefined;
}
/** What the canvas shows: the clip's frame, else the state's parts. */
export function frame(): StatePart3[] | undefined {
	const c = curClip();
	if (c) return sampleClip3(doc(), c, md.clipTime.value);
	return curState()?.parts;
}
export function poseOfCur(): StatePart3 | undefined {
	const p = curPart();
	const st = curState();
	if (!p || !st) return undefined;
	return st.parts.find((sp) => sp.part === p.name);
}
export function selShape(): Shape3 | undefined {
	const s = md.sel.value;
	if (!s) return undefined;
	return parts()[s.part]?.shapes?.[s.shape];
}
export function freshName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** The frame projected under the view: what is drawn and picked, far first. */
let frameCache: { key: string; parts: FramePart[] } | null = null;
export function frameParts(): FramePart[] {
	const fr = frame();
	const key = [md.rev.value, md.turn.value.join(","), md.light.value.join(","), md.ambient.value, md.outline.value, md.curClip.value, md.clipTime.value, md.curState.value, JSON.stringify(fr ?? null)].join("|");
	if (frameCache && frameCache.key === key) return frameCache.parts;
	const out = projectFrame(md.doc.value, fr, { view: md.turn.value, light: md.light.value, ambient: md.ambient.value, outline: md.outline.value ? { color: "", w: 0 } : undefined });
	frameCache = { key, parts: out };
	return out;
}
export function framePartOf(i: number): FramePart | undefined {
	return frameParts().find((f) => f.index === i);
}

// ------------------------------------------------------------- undo, disk

interface Snap {
	doc: string;
	state: number;
	clip: number;
}
let undoStack: Snap[] = [];
let redoStack: Snap[] = [];
let checkpoint = "";
let lastFlush = "";
let writes: Promise<void> = Promise.resolve();
let flushTimer: number | undefined;
let mergeKey: string | null = null;
const FLUSH_MS = 350;
const UNDO_MAX = 200;

function docText(): string {
	return JSON.stringify(md.doc.value);
}
function snapshot(): Snap {
	return { doc: docText(), state: md.curState.value, clip: md.curClip.value };
}
function root(): string {
	return project.root.value ?? "";
}
function touch() {
	batch(() => {
		md.rev.value++;
		md.dirty.value = docText() !== checkpoint;
		md.tokens.value = [...md.shared.value, ...palette()];
		md.canUndo.value = undoStack.length > 0;
		md.canRedo.value = redoStack.length > 0;
	});
	scheduleFlush();
}
export function pushUndo() {
	undoStack.push(snapshot());
	if (undoStack.length > UNDO_MAX) undoStack.shift();
	redoStack = [];
}
/** Apply a change; `merge` names a gesture so a drag is one undo step. */
export function mutate(fn: (d: Doc3) => void, merge?: string) {
	if (!merge || mergeKey !== merge) {
		pushUndo();
		mergeKey = merge ?? null;
	}
	fn(md.doc.value);
	touch();
}
export function endGesture() {
	mergeKey = null;
}
function restore(snap: Snap) {
	batch(() => {
		md.doc.value = JSON.parse(snap.doc) as Doc3;
		md.curState.value = Math.min(snap.state, Math.max(0, states().length - 1));
		md.curClip.value = snap.clip < clips().length ? snap.clip : -1;
		md.sel.value = null;
		md.vert.value = null;
		md.hover.value = null;
		md.polyPts.value = [];
	});
	clampCursors();
	touch();
}
export function undo() {
	const s = undoStack.pop();
	if (!s) return;
	redoStack.push(snapshot());
	mergeKey = null;
	restore(s);
}
export function redo() {
	const s = redoStack.pop();
	if (!s) return;
	undoStack.push(snapshot());
	mergeKey = null;
	restore(s);
}
function clampCursors() {
	md.curPart.value = Math.min(md.curPart.value, Math.max(0, parts().length - 1));
	md.curState.value = Math.min(md.curState.value, Math.max(0, states().length - 1));
	if (md.curClip.value >= clips().length) md.curClip.value = -1;
	const s = md.sel.value;
	if (s && !parts()[s.part]?.shapes?.[s.shape]) md.sel.value = null;
}

function writeDoc(rel: string, text: string): Promise<void> {
	const job = writes.then(async () => {
		try {
			await shell.writeFile(root(), rel, text);
		} catch (e) {
			project.error.value = `could not write ${rel}: ${String(e)}`;
			throw e;
		}
	});
	writes = job.catch(() => {});
	return job;
}
function scheduleFlush() {
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = window.setTimeout(() => void flushNow(), FLUSH_MS);
}
export async function flushNow() {
	flushTimer = undefined;
	const rel = md.path.value;
	if (!rel) return;
	const snap = docText();
	if (snap === lastFlush) return;
	lastFlush = snap;
	try {
		await writeDoc(rel, text3(md.doc.value));
		md.written.value = Date.now();
	} catch {
		lastFlush = "";
	}
}
/** ⌘S: bake the meshes' tris, write, and keep the checkpoint. */
export async function save() {
	const rel = md.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	bakeTris3(md.doc.value);
	md.rev.value++;
	lastFlush = "";
	await flushNow();
	checkpoint = docText();
	await writeDoc(`${rel}~`, text3(md.doc.value));
	batch(() => {
		md.dirty.value = false;
		md.checkpointAt.value = Date.now();
	});
}
export async function revertToCheckpoint() {
	const rel = md.path.value;
	if (!rel || !checkpoint) return;
	pushUndo();
	mergeKey = null;
	restore({ doc: checkpoint, state: md.curState.value, clip: md.curClip.value });
}

function ensureDefaults(d: Doc3) {
	if (!d.parts?.length) d.parts = [{ name: "body", pivot: [0, 0, 0], shapes: [] }];
	if (!d.palette?.length) d.palette = [{ name: "ink", rgb: [200, 195, 185, 255] }];
	for (const p of d.parts) {
		if (!p.like) p.shapes ??= [];
		p.pivot ??= [0, 0, 0];
	}
	d.states ??= [];
	if (!d.states.length) d.states.push({ name: "default", parts: d.parts.map((p) => ({ part: p.name, offset: p.pivot ?? [0, 0, 0] })) });
}

async function resolveShared(d: Doc3, rel: string): Promise<{ shared: Token[]; unresolved: string[] }> {
	const dir = dirname(rel);
	const resolved = await resolvePalettes(d as unknown as Parameters<typeof resolvePalettes>[0], (ref) => shell.readFile(root(), joinRel(dir, ref)));
	return { shared: resolved.tokens.slice(0, resolved.tokens.length - (d.palette?.length ?? 0)), unresolved: resolved.unresolved };
}

function check(d: Doc3) {
	const r = validate(d, { refTokens: md.unresolved.value.length ? null : md.shared.value.map((t) => t.name) });
	md.issues.value = [...r.errors, ...r.warnings];
}

/** Open a 3D file in the model screen. The text was read by the caller. */
export async function openModel(rel: string, text: string): Promise<boolean> {
	if (md.path.value) await leaveModel();
	const { doc: parsed, report } = parseDoc(text);
	if (!parsed || parsed.space !== "3d") {
		project.error.value = `${rel}: ${report.errors[0]?.code ?? "?"} — ${report.errors[0]?.message ?? "not a 3D file"}`;
		return false;
	}
	const d = parsed as unknown as Doc3;
	ensureDefaults(d);
	delete d.resolved;
	const { shared, unresolved } = await resolveShared(d, rel);
	undoStack = [];
	redoStack = [];
	mergeKey = null;
	clearLocal();
	batch(() => {
		md.doc.value = d;
		md.path.value = rel;
		md.shared.value = shared;
		md.unresolved.value = unresolved;
		md.tokens.value = [...shared, ...(d.palette ?? [])];
		md.curPart.value = 0;
		md.curState.value = 0;
		md.curClip.value = -1;
		md.curKey.value = -1;
		md.clipTime.value = 0;
		md.playing.value = false;
		md.sel.value = null;
		md.vert.value = null;
		md.hover.value = null;
		md.polyPts.value = [];
		md.pending.value = "none";
		md.tool.value = "select";
		md.dirty.value = false;
		md.canUndo.value = false;
		md.canRedo.value = false;
		md.rev.value++;
	});
	check(d);
	lastFlush = docText();
	// the checkpoint beside it, or one made now
	const ck = await shell.readFile(root(), `${rel}~`);
	const ckParsed = ck === null ? null : parseDoc(ck).doc;
	if (ckParsed && ckParsed.space === "3d") {
		const c = ckParsed as unknown as Doc3;
		ensureDefaults(c);
		delete c.resolved;
		checkpoint = JSON.stringify(c);
	} else {
		checkpoint = docText();
		await writeDoc(`${rel}~`, text3(d));
	}
	md.dirty.value = docText() !== checkpoint;
	return true;
}

export async function leaveModel() {
	const rel = md.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	await flushNow();
	await writes.catch(() => {});
	batch(() => {
		md.path.value = null;
		md.dirty.value = false;
		md.written.value = 0;
		md.checkpointAt.value = 0;
		md.playing.value = false;
	});
}

/** A whole document from outside (Claude): one undo step. */
export function applyExternalDoc(next: Doc3): string {
	const before = md.doc.value;
	const d = JSON.parse(JSON.stringify(next)) as Doc3;
	delete d.resolved;
	ensureDefaults(d);
	pushUndo();
	mergeKey = null;
	batch(() => {
		md.doc.value = d;
		clampCursors();
		md.sel.value = null;
		md.vert.value = null;
		md.hover.value = null;
		md.polyPts.value = [];
	});
	touch();
	check(d);
	const a = new Set((before.parts ?? []).map((p) => p.name));
	const b = (d.parts ?? []).map((p) => p.name);
	const added = b.filter((n) => !a.has(n));
	const removed = [...a].filter((n) => !b.includes(n));
	const bits = [];
	if (added.length) bits.push(`added ${added.join(", ")}`);
	if (removed.length) bits.push(`removed ${removed.join(", ")}`);
	return bits.join("; ") || "changed the document";
}

// ------------------------------------------------------------- the view

export function setView(name: string) {
	const t = VIEWS[name];
	if (!t) return;
	batch(() => {
		md.turn.value = [...t] as Vec3;
		md.viewName.value = name;
	});
}
/** Orbit: yaw and pitch in view space, laid over the current turn. */
export function orbit(yaw: number, pitch: number) {
	const q = quatMul(quatAxis([1, 0, 0], pitch), quatMul(quatAxis([0, 1, 0], yaw), quatFromEuler(md.turn.value)));
	batch(() => {
		md.turn.value = quatToEuler(q);
		md.viewName.value = "";
	});
}
export function setTurn(t: Vec3) {
	batch(() => {
		md.turn.value = t;
		md.viewName.value = Object.entries(VIEWS).find(([, v]) => v.every((x, i) => Math.abs(x - t[i]) < 1e-6))?.[0] ?? "";
	});
}

// ------------------------------------------------------------- parts

export function addPart(name: string): number {
	mutate((d) => {
		d.parts!.push({ name, pivot: [0, 0, 0], shapes: [] });
		for (const s of d.states ?? []) s.parts.push({ part: name, offset: [0, 0, 0] });
	});
	md.curPart.value = parts().length - 1;
	return md.curPart.value;
}
export function deletePart(i: number) {
	const p = parts()[i];
	if (!p || parts().length <= 1) return;
	mutate((d) => {
		d.parts!.splice(i, 1);
		for (const q of d.parts!) {
			if (q.parent === p.name) delete q.parent;
			if (q.like === p.name) {
				delete q.like;
				q.shapes = [];
			}
		}
		for (const s of d.states ?? []) s.parts = s.parts.filter((sp) => sp.part !== p.name);
		for (const c of d.clips ?? []) for (const k of c.keys) if (k.parts) k.parts = k.parts.filter((sp) => sp.part !== p.name);
	});
	batch(() => {
		md.sel.value = null;
		clampCursors();
	});
}
export function renamePart(i: number, name: string) {
	const p = parts()[i];
	if (!p || !name || parts().some((q) => q !== p && q.name === name)) return;
	const old = p.name;
	mutate((d) => {
		d.parts![i].name = name;
		for (const q of d.parts!) {
			if (q.parent === old) q.parent = name;
			if (q.like === old) q.like = name;
		}
		for (const s of d.states ?? []) for (const sp of s.parts) if (sp.part === old) sp.part = name;
		for (const c of d.clips ?? []) for (const k of c.keys) for (const sp of k.parts ?? []) if (sp.part === old) sp.part = name;
	});
}
export function parentCandidates(i: number): string[] {
	const ps = parts();
	const me = ps[i];
	if (!me) return [];
	const descends = (name: string): boolean => {
		let cur: Part3 | undefined = ps.find((p) => p.name === name);
		let guard = 0;
		while (cur && guard++ < 64) {
			if (cur.name === me.name) return true;
			cur = cur.parent ? ps.find((p) => p.name === cur!.parent) : undefined;
		}
		return false;
	};
	return ps.filter((p) => p !== me && !descends(p.name)).map((p) => p.name);
}
export function setParent(i: number, parent: string) {
	mutate((d) => {
		const p = d.parts![i];
		if (parent) p.parent = parent;
		else delete p.parent;
	});
}
export function setLike(i: number, like: string) {
	mutate((d) => {
		const p = d.parts![i];
		if (like) {
			p.like = like;
			delete p.shapes;
			delete p.anchors;
		} else {
			delete p.like;
			p.shapes = [];
		}
	});
	md.sel.value = null;
}
export function setPivot(i: number, v: Vec3) {
	mutate((d) => (d.parts![i].pivot = v), `pivot-${i}`);
}
export function setPivotAxis(i: number, axis: 0 | 1 | 2, v: number) {
	const pv = [...(parts()[i]?.pivot ?? [0, 0, 0])] as Vec3;
	pv[axis] = v;
	setPivot(i, pv);
}

// ------------------------------------------------------------- states and poses

export function selectState(k: number) {
	batch(() => {
		md.curState.value = k;
		md.curClip.value = -1;
		md.playing.value = false;
	});
}
export function selectClip(k: number) {
	batch(() => {
		md.curClip.value = k;
		md.curKey.value = -1;
		md.clipTime.value = 0;
		md.sel.value = null;
		md.vert.value = null;
		md.polyPts.value = [];
	});
}
export function addState(name: string, from?: number) {
	const src = states()[from ?? md.curState.value];
	mutate((d) => {
		d.states!.push({ name, parts: src ? JSON.parse(JSON.stringify(src.parts)) : d.parts!.map((p) => ({ part: p.name, offset: p.pivot })) });
	});
	selectState(states().length - 1);
}
export function deleteState(k: number) {
	if (states().length <= 1) return;
	const name = states()[k]?.name;
	mutate((d) => {
		d.states!.splice(k, 1);
		for (const c of d.clips ?? []) c.keys = c.keys.filter((key) => key.state !== name);
		d.clips = (d.clips ?? []).filter((c) => c.keys.length > 0);
	});
	clampCursors();
}
export function renameState(k: number, name: string) {
	const s = states()[k];
	if (!s || !name || states().some((q) => q !== s && q.name === name)) return;
	const old = s.name;
	mutate((d) => {
		d.states![k].name = name;
		for (const c of d.clips ?? []) for (const key of c.keys) if (key.state === old) key.state = name;
	});
}
export function toggleMembership(k: number, part: string) {
	mutate((d) => {
		const s = d.states![k];
		const i = s.parts.findIndex((sp) => sp.part === part);
		if (i >= 0) s.parts.splice(i, 1);
		else {
			const p = d.parts!.find((q) => q.name === part);
			s.parts.push({ part, offset: p?.pivot ?? [0, 0, 0] });
		}
	});
}
export function movePartInState(part: string, later: boolean) {
	mutate((d) => {
		const s = d.states![md.curState.value];
		if (!s) return;
		const i = s.parts.findIndex((sp) => sp.part === part);
		const j = later ? i + 1 : i - 1;
		if (i < 0 || j < 0 || j >= s.parts.length) return;
		[s.parts[i], s.parts[j]] = [s.parts[j], s.parts[i]];
	});
}
export function setPose(sp: StatePart3, patch: Partial<StatePart3>, merge?: string) {
	mutate(() => {
		Object.assign(sp, patch);
		if (patch.mirror === false) delete sp.mirror;
	}, merge);
}
export function resetPose(sp: StatePart3) {
	const p = parts().find((q) => q.name === sp.part);
	mutate(() => {
		sp.offset = p?.pivot ? ([...p.pivot] as Vec3) : [0, 0, 0];
		delete sp.rotate;
		delete sp.scale;
		delete sp.mirror;
	});
}
/** A turn about an axis given in the parent's rest frame, laid over the pose's turn. */
export function turnPose(sp: StatePart3, axis: Vec3, angle: number, merge?: string) {
	const q = quatMul(quatAxis(axis, angle), quatFromEuler(sp.rotate ?? [0, 0, 0]));
	setPose(sp, { rotate: quatToEuler(q).map((x) => Math.round(x * 1e4) / 1e4) as Vec3 }, merge);
}

// ------------------------------------------------------------- clips

export function addClip(name: string): boolean {
	const st = curState();
	if (!st) return false;
	mutate((d) => (d.clips ??= []).push({ name, keys: [{ t: 0, state: st.name }] }));
	selectClip(clips().length - 1);
	return true;
}
export function deleteClip(k: number) {
	mutate((d) => d.clips!.splice(k, 1));
	batch(() => {
		md.curClip.value = -1;
		clampCursors();
	});
}
export function renameClip(k: number, name: string) {
	if (!name || clips().some((c, i) => i !== k && c.name === name)) return;
	mutate((d) => (d.clips![k].name = name));
}
export function setClipLoop(k: number, loop: boolean) {
	mutate((d) => {
		if (loop) d.clips![k].loop = true;
		else delete d.clips![k].loop;
	});
}
export function seek(t: number) {
	md.clipTime.value = t;
}
export function addKey() {
	const c = curClip();
	const st = states()[md.curState.value];
	if (!c || !st) return;
	const t = Math.round(md.clipTime.value * 1000) / 1000;
	mutate((d) => {
		const clip = d.clips![md.curClip.value];
		let i = clip.keys.findIndex((k) => k.t >= t);
		if (i >= 0 && clip.keys[i].t === t) {
			clip.keys[i].state = st.name;
			delete clip.keys[i].parts;
		} else {
			if (i < 0) i = clip.keys.length;
			clip.keys.splice(i, 0, { t, state: st.name });
		}
		md.curKey.value = i;
	});
}
export function deleteKey(i: number) {
	const c = curClip();
	if (!c || c.keys.length <= 1) return;
	mutate((d) => d.clips![md.curClip.value].keys.splice(i, 1));
	md.curKey.value = -1;
}
export function setKeyTime(i: number, t: number) {
	mutate((d) => {
		const keys = d.clips![md.curClip.value].keys;
		keys[i].t = Math.max(0, t);
		const k = keys[i];
		keys.sort((a, b) => a.t - b.t);
		md.curKey.value = keys.indexOf(k);
	}, `key-time-${i}`);
}
export function setKeyState(i: number, state: string) {
	mutate((d) => {
		const k = d.clips![md.curClip.value].keys[i];
		k.state = state;
		delete k.parts;
	});
}
export function setKeyEase(i: number, e: Ease | undefined) {
	mutate((d) => {
		const k = d.clips![md.curClip.value].keys[i];
		if (e && e !== "linear") k.ease = e;
		else delete k.ease;
	});
}

// ------------------------------------------------------------- shapes

/** Add a shape to the current part and select it. */
export function addShape(sh: Shape3): Sel3 | null {
	const i = md.curPart.value;
	const p = parts()[i];
	if (!p || p.like) return null;
	mutate((d) => (d.parts![i].shapes ??= []).push(sh));
	const sel = { part: i, shape: (p.shapes?.length ?? 1) - 1 };
	batch(() => {
		md.sel.value = sel;
		md.vert.value = null;
	});
	return sel;
}
export function deleteSel() {
	const s = md.sel.value;
	if (!s) return;
	const v = md.vert.value;
	const sh = parts()[s.part]?.shapes?.[s.shape];
	if (sh && sh.kind === "mesh" && v !== null && sh.points.length > 4) {
		// drop a corner: faces lose it, faces left with two points go
		mutate((d) => {
			const m = d.parts![s.part].shapes![s.shape];
			if (m.kind !== "mesh") return;
			m.points.splice(v, 1);
			m.faces = m.faces.map((f) => f.filter((i) => i !== v).map((i) => (i > v ? i - 1 : i))).filter((f) => f.length >= 3);
			delete m.tris;
		});
		md.vert.value = null;
		return;
	}
	mutate((d) => d.parts![s.part].shapes!.splice(s.shape, 1));
	batch(() => {
		md.sel.value = null;
		md.vert.value = null;
	});
}
export function dupSel() {
	const s = md.sel.value;
	const sh = selShape();
	if (!s || !sh) return;
	mutate((d) => d.parts![s.part].shapes!.splice(s.shape + 1, 0, JSON.parse(JSON.stringify(sh))));
	md.sel.value = { part: s.part, shape: s.shape + 1 };
}
/** A copy of the selected shape reflected across x = 0 of the model, faces turned to stay outward. */
export function mirrorSel() {
	const s = md.sel.value;
	const sh = selShape();
	if (!s || !sh) return;
	const mx = (p: Vec3): Vec3 => [-p[0], p[1], p[2]];
	let copy: Shape3;
	if (sh.kind === "mesh") copy = { ...sh, points: sh.points.map(mx), faces: sh.faces.map((f) => [...f].reverse()), tris: undefined };
	else if (sh.kind === "ball") copy = { ...sh, at: mx(sh.at) };
	else copy = { ...sh, a: mx(sh.a), b: mx(sh.b) };
	if (copy.kind === "mesh") delete copy.tris;
	mutate((d) => d.parts![s.part].shapes!.splice(s.shape + 1, 0, copy));
	md.sel.value = { part: s.part, shape: s.shape + 1 };
}
export function paintSel(token: string) {
	const s = md.sel.value;
	if (!s) return;
	mutate((d) => (d.parts![s.part].shapes![s.shape].color = token));
}
export function setShapeNumber(s: Sel3, key: "shade" | "r" | "w", v: number) {
	mutate((d) => ((d.parts![s.part].shapes![s.shape] as unknown as Record<string, unknown>)[key] = v), `shape-${key}`);
}
export function setShapeCoord(s: Sel3, key: "at" | "a" | "b", axis: 0 | 1 | 2, v: number) {
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape] as unknown as Record<string, Vec3>;
		const p = [...sh[key]] as Vec3;
		p[axis] = v;
		sh[key] = p;
	}, `shape-${key}-${axis}`);
}
export function setVertexAxis(s: Sel3, vi: number, axis: 0 | 1 | 2, v: number) {
	mutate((d) => {
		const sh = d.parts![s.part].shapes![s.shape];
		if (sh.kind !== "mesh") return;
		const p = [...sh.points[vi]] as Vec3;
		p[axis] = v;
		sh.points[vi] = p;
		delete sh.tris;
	}, `vert-${vi}-${axis}`);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const round3 = (p: Vec3): Vec3 => [r3(p[0]), r3(p[1]), r3(p[2])];

/** Move the selected shape by a view-space displacement (the part's map undone). */
export function moveSelView(s: Sel3, dView: Vec3, merge = "move") {
	const fp = framePartOf(s.part);
	if (!fp) return;
	const inv = xf3Invert(fp.F);
	const d = xf3ApplyDir(inv, dView);
	mutate((doc) => {
		const sh = doc.parts![s.part].shapes![s.shape];
		const add = (p: Vec3): Vec3 => round3([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
		if (sh.kind === "mesh") sh.points = sh.points.map(add);
		else if (sh.kind === "ball") sh.at = add(sh.at);
		else {
			sh.a = add(sh.a);
			sh.b = add(sh.b);
		}
	}, merge);
}
/** Move one corner of the selected mesh by a view-space displacement. */
export function moveVertexView(s: Sel3, vi: number, dView: Vec3, merge = "vertex") {
	const fp = framePartOf(s.part);
	if (!fp) return;
	const d = xf3ApplyDir(xf3Invert(fp.F), dView);
	mutate((doc) => {
		const sh = doc.parts![s.part].shapes![s.shape];
		if (sh.kind !== "mesh") return;
		const p = sh.points[vi];
		sh.points[vi] = round3([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
		delete sh.tris;
	}, merge);
}

/** The depth (view z) new shapes go at: the selection's centre, else the current part's pivot. */
export function workDepth(): number {
	const s = md.sel.value;
	const fp = framePartOf(s ? s.part : md.curPart.value);
	if (!fp) return 0;
	const sh = s ? parts()[s.part]?.shapes?.[s.shape] : undefined;
	if (sh) {
		const pts = sh.kind === "mesh" ? sh.points : sh.kind === "ball" ? [sh.at] : [sh.a, sh.b];
		if (pts.length) return pts.reduce((acc, p) => acc + xf3Apply(fp.F, p)[2], 0) / pts.length;
	}
	return xf3Apply(fp.F, fp.part.pivot ?? [0, 0, 0])[2];
}

/** A view-space point (x, y at depth z) into the current part's rest space. */
export function viewToRest(partIndex: number, p: Vec3): Vec3 {
	const fp = framePartOf(partIndex);
	return round3(fp ? xf3Apply(xf3Invert(fp.F), p) : p);
}

/**
 * Extrude a polygon drawn in the view plane (view-space x, y) into a
 * mesh of the current part, `thick` deep about `depth`, faces wound
 * outward whichever way the part is turned.
 */
export function extrudeView(pts: Vec2[], depth: number, thick: number, color: string): Shape3 | null {
	const i = md.curPart.value;
	const fp = framePartOf(i);
	if (!fp || pts.length < 3) return null;
	const n = pts.length;
	const z0 = depth - thick / 2;
	const z1 = depth + thick / 2;
	const viewPts: Vec3[] = [...pts.map((q) => [q[0], q[1], z0] as Vec3), ...pts.map((q) => [q[0], q[1], z1] as Vec3)];
	// the profile's winding in view space decides which way the sides face
	let area = 0;
	for (let k = 0; k < n; k++) {
		const a = pts[k];
		const b = pts[(k + 1) % n];
		area += a[0] * b[1] - b[0] * a[1];
	}
	const ccw = area > 0; // y-down: a positive area is clockwise on screen, but it is the sign that matters
	const near = pts.map((_, k) => k); // z0 cap faces the viewer (−z)
	const far = pts.map((_, k) => k + n);
	// with y-down, x-right, z-away (right-handed), a loop with positive signed area has its normal along +z
	const faces: number[][] = [];
	faces.push(ccw ? [...near].reverse() : near); // normal −z
	faces.push(ccw ? far : [...far].reverse()); // normal +z
	for (let k = 0; k < n; k++) {
		const j = (k + 1) % n;
		const quad = [k, j, j + n, k + n];
		faces.push(ccw ? quad : [...quad].reverse());
	}
	const inv = xf3Invert(fp.F);
	const points = viewPts.map((p) => round3(xf3Apply(inv, p)));
	const flipped = xf3Det(inv) < 0;
	return { kind: "mesh", color, points, faces: flipped ? faces.map((f) => [...f].reverse()) : faces };
}

// ------------------------------------------------------------- tokens, document

export function addToken(name: string) {
	mutate((d) => (d.palette ??= []).push({ name, rgb: [200, 195, 185, 255] }));
}
export function deleteToken(i: number) {
	mutate((d) => d.palette!.splice(i, 1));
}
export function renameToken(i: number, name: string) {
	const t = palette()[i];
	if (!t || !name || palette().some((q) => q !== t && q.name === name)) return;
	const old = t.name;
	mutate((d) => {
		d.palette![i].name = name;
		for (const p of d.parts!) for (const sh of p.shapes ?? []) if (sh.color === old) sh.color = name;
	});
}
export function setTokenColor(i: number, rgb: Rgba) {
	mutate((d) => (d.palette![i].rgb = rgb), `token-${i}`);
}
export function setDocName(name: string) {
	mutate((d) => (d.name = name), "doc-name");
}
export function curTokName(): string {
	return md.tokens.value[md.tokens.value.length - 1]?.name ?? "ink";
}

/** A convex hull of the part's visible shapes into the document's collision, replacing the one it had (1.4). */
export function hullOfPart(i: number): boolean {
	const p = parts()[i];
	if (!p) return false;
	let ok = false;
	mutate((d) => {
		ok = setHull(d, p.name) !== null;
	});
	return ok;
}

/** Write the 2D views beside the model. Resolves with the files written. */
export async function projectViews(views: string[], outline: { color: string; w: number } | undefined): Promise<string[]> {
	const rel = md.path.value;
	if (!rel) return [];
	await flushNow();
	const stem = rel.replace(/\.fart$/, "");
	const out: string[] = [];
	for (const view of views) {
		const d = projectDoc(md.doc.value, { view, light: md.light.value, ambient: md.ambient.value, outline, from: rel.replace(/^.*\//, "") });
		if (outline && !(d.palette ?? []).some((t) => t.name === outline.color)) d.palette = [...(d.palette ?? []), { name: outline.color, rgb: [25, 22, 30, 255] }];
		const target = `${stem}-${view}.fart`;
		await writeDoc(target, stringifyDoc(d));
		out.push(target);
	}
	await refreshFiles();
	return out;
}
