// The editor store. One document at a time, mutated in place; every
// change bumps `rev` so panels re-render, snapshots the previous state
// for undo, and schedules the live flush to disk.
//
// Saving is a checkpoint, not a copy: the file on disk mirrors the doc a
// beat after every change (a game hot-reloading it sees the experiment
// live); Save marks the checkpoint; leaving any other way rolls the disk
// back to it. The checkpoint also lives beside the file as <name>.fart~.

import { signal, batch } from "@preact/signals";
import {
	parseDoc,
	validate,
	stringifyDoc,
	resolvePalettes,
	bakeTris,
	type Doc,
	type Shape,
	type Part,
	type State,
	type StatePart,
	type Token,
	type Vec2,
	type Issue,
	type Rgba,
	type Clip,
	type Constraint,
	type Ease,
	sampleClip,
	solveChain,
} from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { project } from "./project.ts";
import { dirname, joinRel } from "./paths.ts";
import { local, clearLocal } from "./local.ts";

export type Tool = "select" | "circle" | "line" | "poly" | "rect";
export type Pending = "none" | "pivot" | "anchor";

/** A shape by address: part index, shape index. */
export interface Ref {
	p: number;
	s: number;
}

export const ed = {
	doc: signal<Doc>({ version: 1 }),
	rev: signal(0),
	path: signal<string | null>(null),
	/** every token in lookup order: shared refs first, local last */
	tokens: signal<Token[]>([]),
	/** the tokens palette_refs supplied, read-only here */
	shared: signal<Token[]>([]),
	issues: signal<Issue[]>([]),
	tool: signal<Tool>("select"),
	curPart: signal(0),
	curTok: signal(0),
	curState: signal(-1),
	/** a clip being previewed; -1 none. Clip and state are exclusive. */
	curClip: signal(-1),
	clipTime: signal(0),
	playing: signal(false),
	curKey: signal(-1),
	sel: signal<Ref[]>([]),
	hover: signal<Ref | null>(null),
	collide: signal(false),
	colSel: signal(-1),
	pending: signal<Pending>("none"),
	polyPts: signal<Vec2[]>([]),
	dirty: signal(false),
	canUndo: signal(false),
	canRedo: signal(false),
};

let undoStack: string[] = [];
let redoStack: string[] = [];
let base = ""; // the doc as of the last real save: the rollback point
let lastFlush = ""; // the doc as last written to disk
let flushTimer: number | undefined;
let mergeKey: string | null = null;

const FLUSH_MS = 350;
const UNDO_MAX = 200;

// ------------------------------------------------------------- access

export function doc(): Doc {
	return ed.doc.value;
}
export function parts(): Part[] {
	return ed.doc.value.parts ?? [];
}
export function states(): State[] {
	return ed.doc.value.states ?? [];
}
export function palette(): Token[] {
	return ed.doc.value.palette ?? [];
}
export function curPart(): Part | undefined {
	return parts()[ed.curPart.value];
}
export function curState(): State | undefined {
	return states()[ed.curState.value];
}
export function clips(): Clip[] {
	return ed.doc.value.clips ?? [];
}
export function constraints(): Constraint[] {
	return ed.doc.value.constraints ?? [];
}
export function curClip(): Clip | undefined {
	return clips()[ed.curClip.value];
}
/** The pose list the canvas draws: a clip frame, a state's parts, or nothing (rest). */
export function frame(): StatePart[] | undefined {
	const c = curClip();
	if (c) return sampleClip(ed.doc.value, c, ed.clipTime.value);
	return curState()?.parts;
}
export function curTokName(): string {
	return palette()[ed.curTok.value]?.name ?? palette()[0]?.name ?? "ink";
}
export function shapeAt(r: Ref | null): Shape | undefined {
	if (!r) return undefined;
	return parts()[r.p]?.shapes?.[r.s];
}
export function primary(): Ref | null {
	const s = ed.sel.value;
	return s.length ? s[s.length - 1] : null;
}
export function selShape(): Shape | undefined {
	return shapeAt(primary());
}
export function colShape(): Shape | undefined {
	return ed.doc.value.collision?.[ed.colSel.value];
}
export function poseOfCur(): StatePart | undefined {
	const st = curState();
	const p = curPart();
	if (!st || !p) return undefined;
	return st.parts.find((sp) => sp.part === p.name);
}
export function rgbaOf(name: string): Rgba {
	const t = ed.tokens.value;
	for (let i = t.length - 1; i >= 0; i--) if (t[i].name === name) return t[i].rgb;
	return [255, 0, 255, 255];
}

/** Part indices drawn right now: all of them, or the current pose's, minus the hidden. */
export function visibleParts(): number[] {
	const fr = frame();
	const ps = parts();
	const hidden = local.hidden.value;
	if (!fr) return ps.map((_, i) => i).filter((i) => !hidden.has(ps[i].name));
	const out: number[] = [];
	for (const sp of fr) {
		const i = ps.findIndex((p) => p.name === sp.part);
		if (i >= 0 && !hidden.has(ps[i].name)) out.push(i);
	}
	return out;
}

/** Parts a click may pick: visible and not locked. */
export function pickableParts(): number[] {
	const ps = parts();
	const locked = local.locked.value;
	return visibleParts().filter((i) => !locked.has(ps[i].name));
}

/** Move the selection by a step (the arrow keys). */
export function nudgeSel(d: Vec2) {
	const shapes = selShapes();
	if (!shapes.length) return;
	mutate(() => {
		for (const sh of shapes) moveShape(sh, d);
	}, "nudge");
}

/** Every shape of every pickable part. */
export function selectAll() {
	const ps = parts();
	const refs: Ref[] = [];
	for (const p of pickableParts()) (ps[p].shapes ?? []).forEach((_, s) => refs.push({ p, s }));
	ed.sel.value = refs;
}

/** A fresh name: "part 2", "state 3", whatever is free. */
export function freshName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) if (!set.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ------------------------------------------------------------- change

function snapshot(): string {
	const d = ed.doc.value;
	return JSON.stringify(d);
}

function touch() {
	batch(() => {
		ed.rev.value++;
		ed.dirty.value = true;
		ed.tokens.value = [...ed.shared.value, ...palette()];
		ed.canUndo.value = undoStack.length > 0;
		ed.canRedo.value = redoStack.length > 0;
	});
	scheduleFlush();
}

export function pushUndo() {
	undoStack.push(snapshot());
	if (undoStack.length > UNDO_MAX) undoStack.shift();
	redoStack = [];
}

/**
 * Apply a change. `merge` names a gesture (a slider drag, a handle drag):
 * the first change in a gesture snapshots for undo, the rest ride along,
 * so one drag is one undo step. endGesture() closes it.
 */
export function mutate(fn: (d: Doc) => void, merge?: string) {
	if (!merge || mergeKey !== merge) {
		pushUndo();
		mergeKey = merge ?? null;
	}
	fn(ed.doc.value);
	touch();
}

export function endGesture() {
	mergeKey = null;
}

function restore(snap: string) {
	batch(() => {
		ed.doc.value = JSON.parse(snap) as Doc;
		clampCursors();
		ed.sel.value = [];
		ed.colSel.value = -1;
		ed.hover.value = null;
	});
	mergeKey = null;
	touch();
}

export function undo() {
	const snap = undoStack.pop();
	if (snap === undefined) return;
	redoStack.push(snapshot());
	restore(snap);
}

export function redo() {
	const snap = redoStack.pop();
	if (snap === undefined) return;
	undoStack.push(snapshot());
	restore(snap);
}

function clampCursors() {
	const d = ed.doc.value;
	ed.curPart.value = Math.min(ed.curPart.value, Math.max((d.parts?.length ?? 1) - 1, 0));
	ed.curTok.value = Math.min(ed.curTok.value, Math.max((d.palette?.length ?? 1) - 1, 0));
	if (ed.curState.value >= (d.states?.length ?? 0)) ed.curState.value = -1;
	if (ed.curClip.value >= (d.clips?.length ?? 0)) ed.curClip.value = -1;
	const c = d.clips?.[ed.curClip.value];
	if (!c || ed.curKey.value >= c.keys.length) ed.curKey.value = c ? Math.min(ed.curKey.value, c.keys.length - 1) : -1;
}

// ------------------------------------------------------------- disk

function root(): string {
	return project.root.value ?? "";
}

async function writeDoc(rel: string, text: string) {
	try {
		await shell.writeFile(root(), rel, text);
	} catch (e) {
		project.error.value = `could not write ${rel}: ${String(e)}`;
	}
}

function scheduleFlush() {
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = window.setTimeout(() => void flushNow(), FLUSH_MS);
}

/** The live scratch: mirror the doc to disk if it moved since last time. */
export async function flushNow() {
	flushTimer = undefined;
	const rel = ed.path.value;
	if (!rel) return;
	const snap = snapshot();
	if (snap === lastFlush) return;
	lastFlush = snap;
	await writeDoc(rel, stringifyDoc(ed.doc.value));
}

function backupWrite(rel: string) {
	if (!base) return;
	void writeDoc(`${rel}~`, stringifyDoc(JSON.parse(base) as Doc));
}

export async function save() {
	const rel = ed.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	bakeTris(ed.doc.value);
	ed.rev.value++;
	const snap = snapshot();
	await writeDoc(rel, stringifyDoc(ed.doc.value));
	base = snap;
	lastFlush = snap;
	ed.dirty.value = false;
	backupWrite(rel);
}

/** Leaving without saving: the disk goes back to the checkpoint. */
export async function leaveFile() {
	const rel = ed.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	if (base && lastFlush !== base) {
		await writeDoc(rel, stringifyDoc(JSON.parse(base) as Doc));
	}
	ed.path.value = null;
	ed.dirty.value = false;
}

function ensureDefaults(d: Doc) {
	if (!d.parts?.length) d.parts = [{ name: "body", pivot: [0, 0], shapes: [] }];
	if (!d.palette?.length) d.palette = [{ name: "ink", rgb: [200, 195, 185, 255] }];
	for (const p of d.parts) {
		p.shapes ??= [];
		p.pivot ??= [0, 0];
	}
	d.states ??= [];
}

/** A file the format refuses outright: not JSON, wrong version, bad shape. */
const HARD = new Set(["json", "version", "schema", "path"]);

/**
 * Open a document (created if missing). Lenient past the hard errors: a
 * dangling token or part reference renders loud rather than refusing to
 * open, and the issues sit in the toolbar for you to fix.
 */
export async function openFile(rel: string): Promise<boolean> {
	if (ed.path.value) await leaveFile();
	const text = await shell.readFile(root(), rel);
	let d: Doc = { version: 1, name: rel.replace(/^.*\//, "").replace(/\.fart$/, "") };
	let issues: Issue[] = [];
	if (text !== null && text.trim().length) {
		const { doc: parsed, report } = parseDoc(text);
		if (parsed) d = parsed;
		else if (report.errors.some((e) => HARD.has(e.code))) {
			project.error.value = `${rel}: ${report.errors[0].code} — ${report.errors[0].message}`;
			return false;
		} else d = JSON.parse(text) as Doc;
		issues = [...report.errors, ...report.warnings];
	}
	ensureDefaults(d);
	delete d.resolved; // an old writer's cache, not a field
	const dir = dirname(rel);
	const resolved = await resolvePalettes(d, (ref) => shell.readFile(root(), joinRel(dir, ref)));
	const shared = resolved.tokens.slice(0, resolved.tokens.length - (d.palette?.length ?? 0));
	if (issues.length && d.palette_refs?.length) {
		// a second look, now that the shared tokens are known
		const r = validate(d, { refTokens: resolved.unresolved.length ? null : shared.map((t) => t.name) });
		issues = [...r.errors, ...r.warnings];
	}

	undoStack = [];
	redoStack = [];
	mergeKey = null;
	clearLocal();
	batch(() => {
		ed.doc.value = d;
		ed.path.value = rel;
		ed.shared.value = shared;
		ed.tokens.value = [...shared, ...(d.palette ?? [])];
		ed.issues.value = issues;
		ed.curPart.value = 0;
		ed.curTok.value = 0;
		ed.curState.value = -1;
		ed.curClip.value = -1;
		ed.curKey.value = -1;
		ed.clipTime.value = 0;
		ed.playing.value = false;
		ed.sel.value = [];
		ed.hover.value = null;
		ed.collide.value = false;
		ed.colSel.value = -1;
		ed.pending.value = "none";
		ed.polyPts.value = [];
		ed.dirty.value = false;
		ed.canUndo.value = false;
		ed.canRedo.value = false;
		ed.rev.value++;
	});
	base = snapshot();
	lastFlush = base;
	backupWrite(rel);
	return true;
}

// ------------------------------------------------------------- selection

export function selHas(r: Ref): boolean {
	return ed.sel.value.some((e) => e.p === r.p && e.s === r.s);
}
export function selOnly(r: Ref) {
	ed.sel.value = [r];
}
export function selClear() {
	ed.sel.value = [];
}
export function selToggle(r: Ref) {
	if (selHas(r)) ed.sel.value = ed.sel.value.filter((e) => !(e.p === r.p && e.s === r.s));
	else ed.sel.value = [...ed.sel.value, r];
}
export function selAdd(refs: Ref[]) {
	const cur = ed.sel.value;
	ed.sel.value = [...cur, ...refs.filter((r) => !cur.some((e) => e.p === r.p && e.s === r.s))];
}
export function selMakePrimary(r: Ref) {
	ed.sel.value = [...ed.sel.value.filter((e) => !(e.p === r.p && e.s === r.s)), r];
}
/** Live shapes for the selection (stale refs dropped). */
export function selShapes(): Shape[] {
	return ed.sel.value.map(shapeAt).filter((s): s is Shape => !!s);
}

// ------------------------------------------------------------- shape ops

export function moveShape(sh: Shape, d: Vec2) {
	switch (sh.kind) {
		case "circle":
			sh.at = [sh.at[0] + d[0], sh.at[1] + d[1]];
			break;
		case "line":
			sh.a = [sh.a[0] + d[0], sh.a[1] + d[1]];
			sh.b = [sh.b[0] + d[0], sh.b[1] + d[1]];
			break;
		case "poly":
			sh.points = sh.points.map((q) => [q[0] + d[0], q[1] + d[1]] as Vec2);
			break;
	}
}

export function scaleShape(sh: Shape, f: number, anchor: Vec2) {
	const sc = (q: Vec2): Vec2 => [anchor[0] + (q[0] - anchor[0]) * f, anchor[1] + (q[1] - anchor[1]) * f];
	switch (sh.kind) {
		case "circle":
			sh.at = sc(sh.at);
			sh.r *= f;
			break;
		case "line":
			sh.a = sc(sh.a);
			sh.b = sc(sh.b);
			sh.w *= f;
			break;
		case "poly":
			sh.points = sh.points.map(sc);
			break;
	}
}

export function cloneShape(sh: Shape): Shape {
	return JSON.parse(JSON.stringify(sh)) as Shape;
}

export function deleteSel() {
	if (ed.collide.value) {
		const i = ed.colSel.value;
		if (i < 0) return;
		mutate((d) => d.collision?.splice(i, 1));
		ed.colSel.value = -1;
		return;
	}
	const sel = ed.sel.value;
	if (!sel.length) return;
	mutate((d) => {
		// highest indices first so the rest stay valid
		const order = [...sel].sort((a, b) => (a.p - b.p) || (b.s - a.s));
		for (const r of order) d.parts?.[r.p]?.shapes?.splice(r.s, 1);
	});
	ed.sel.value = [];
	ed.hover.value = null;
}

/** Paint the current token onto the selection. */
export function paintSel(token: string) {
	const shapes = selShapes();
	if (!shapes.length) return;
	mutate(() => {
		for (const sh of shapes) sh.color = token;
	});
}

/** Move the selection into the current part (order kept, appended on top). */
export function selToPart() {
	const target = ed.curPart.value;
	const sel = ed.sel.value.filter((r) => r.p !== target);
	if (!sel.length) return;
	const moved: Ref[] = [];
	mutate((d) => {
		const ps = d.parts!;
		const taken: Shape[] = [];
		const order = [...sel].sort((a, b) => (a.p - b.p) || (a.s - b.s));
		for (const r of order) taken.push(ps[r.p].shapes![r.s]);
		for (const r of [...order].sort((a, b) => (a.p - b.p) || (b.s - a.s))) ps[r.p].shapes!.splice(r.s, 1);
		const dst = ps[target].shapes!;
		for (const sh of taken) {
			dst.push(sh);
			moved.push({ p: target, s: dst.length - 1 });
		}
	});
	ed.sel.value = [...ed.sel.value.filter((r) => r.p === target), ...moved];
}

/** Raise or lower the selection one step through each part's stack, keeping its internal order. */
export function selOrder(up: boolean) {
	const sel = ed.sel.value;
	if (!sel.length) return;
	const next: Ref[] = [];
	mutate((d) => {
		const byPart = new Map<number, number[]>();
		for (const r of sel) byPart.set(r.p, [...(byPart.get(r.p) ?? []), r.s]);
		for (const [p, idxs] of byPart) {
			const shapes = d.parts?.[p]?.shapes;
			if (!shapes) continue;
			const set = new Set(idxs);
			const n = shapes.length;
			// walk from the leading edge; a member swaps with a non-member neighbour
			if (up) {
				for (let i = n - 2; i >= 0; i--) {
					if (set.has(i) && !set.has(i + 1)) {
						[shapes[i], shapes[i + 1]] = [shapes[i + 1], shapes[i]];
						set.delete(i);
						set.add(i + 1);
					}
				}
			} else {
				for (let i = 1; i < n; i++) {
					if (set.has(i) && !set.has(i - 1)) {
						[shapes[i], shapes[i - 1]] = [shapes[i - 1], shapes[i]];
						set.delete(i);
						set.add(i - 1);
					}
				}
			}
			for (const s of set) next.push({ p, s });
		}
	});
	ed.sel.value = next;
}

// ------------------------------------------------------------- clipboard

interface Clipped {
	part: string;
	sh: Shape;
}
let clipboard: Clipped[] = [];
let pasteN = 0;

export function copySel() {
	const ps = parts();
	clipboard = ed.sel.value
		.filter((r) => ps[r.p]?.shapes?.[r.s])
		.map((r) => ({ part: ps[r.p].name, sh: cloneShape(ps[r.p].shapes![r.s]) }));
	pasteN = 0;
}

export function pasteClip() {
	if (!clipboard.length) return;
	pasteN++;
	const nudge = 0.8 * pasteN;
	const landed: Ref[] = [];
	mutate((d) => {
		const ps = d.parts!;
		for (const c of clipboard) {
			let pi = ps.findIndex((p) => p.name === c.part);
			if (pi < 0) pi = ed.curPart.value;
			const sh = cloneShape(c.sh);
			moveShape(sh, [nudge, nudge]);
			ps[pi].shapes!.push(sh);
			landed.push({ p: pi, s: ps[pi].shapes!.length - 1 });
		}
	});
	ed.sel.value = landed;
}

export function cutSel() {
	copySel();
	deleteSel();
}

export function dupSel() {
	const ps = parts();
	const src = ed.sel.value.filter((r) => ps[r.p]?.shapes?.[r.s]);
	if (!src.length) return;
	const landed: Ref[] = [];
	mutate((d) => {
		for (const r of src) {
			const shapes = d.parts![r.p].shapes!;
			const sh = cloneShape(shapes[r.s]);
			moveShape(sh, [0.8, 0.8]);
			shapes.push(sh);
			landed.push({ p: r.p, s: shapes.length - 1 });
		}
	});
	ed.sel.value = landed;
}

// ------------------------------------------------------------- parts

export function addPart(name: string): number {
	mutate((d) => d.parts!.push({ name, pivot: [0, 0], shapes: [] }));
	ed.curPart.value = parts().length - 1;
	return ed.curPart.value;
}

/** Duplicate the selection exactly in place (an Alt-drag begins with this). */
export function dupSelInPlace() {
	const ps = parts();
	const src = ed.sel.value.filter((r) => ps[r.p]?.shapes?.[r.s]);
	if (!src.length) return;
	const landed: Ref[] = [];
	mutate((d) => {
		for (const r of src) {
			const shapes = d.parts![r.p].shapes!;
			shapes.push(cloneShape(shapes[r.s]));
			landed.push({ p: r.p, s: shapes.length - 1 });
		}
	});
	ed.sel.value = landed;
}

/** Set one numeric property of a shape, from a field. */
export function setShapeNumber(sh: Shape, key: string, sub: 0 | 1 | null, value: number) {
	if (!Number.isFinite(value)) return;
	mutate(() => {
		const o = sh as unknown as Record<string, unknown>;
		if (sub === null) o[key] = value;
		else {
			const v = (o[key] as Vec2) ?? [0, 0];
			const nv: Vec2 = [v[0], v[1]];
			nv[sub] = value;
			o[key] = nv;
		}
	}, `field-${key}-${sub}`);
}

export function setPivotNumber(k: number, sub: 0 | 1, value: number) {
	if (!Number.isFinite(value)) return;
	mutate((d) => {
		const p = d.parts![k];
		const pv: Vec2 = [...(p.pivot ?? [0, 0])];
		pv[sub] = value;
		p.pivot = pv;
	}, `pivot-${sub}`);
}

export function setAnchorNumber(k: number, i: number, sub: 0 | 1, value: number) {
	if (!Number.isFinite(value)) return;
	mutate((d) => {
		const a = d.parts![k].anchors![i];
		const at: Vec2 = [...a.at];
		at[sub] = value;
		a.at = at;
	}, `anchor-${i}-${sub}`);
}

export function renameAnchor(k: number, i: number, name: string) {
	const p = parts()[k];
	const old = p?.anchors?.[i]?.name;
	if (old === undefined || old === name) return;
	mutate((d) => {
		d.parts![k].anchors![i].name = name;
		for (const c of d.constraints ?? []) if (c.end === `${p.name}/${old}`) c.end = `${p.name}/${name}`;
	});
}

export function setDocName(name: string) {
	mutate((d) => {
		if (name) d.name = name;
		else delete d.name;
	}, "docname");
}

export function deletePart(k: number) {
	const name = parts()[k]?.name;
	if (name === undefined) return;
	mutate((d) => {
		d.parts!.splice(k, 1);
		for (const st of d.states ?? []) st.parts = st.parts.filter((sp) => sp.part !== name);
		// children lose their parent; chains through it go with it
		for (const p of d.parts!) if (p.parent === name) delete p.parent;
		for (const c of d.clips ?? []) for (const k of c.keys) if (k.parts) k.parts = k.parts.filter((sp) => sp.part !== name);
		if (d.constraints) d.constraints = d.constraints.filter((c) => !c.chain.includes(name));
	});
	batch(() => {
		ed.sel.value = [];
		ed.hover.value = null;
		clampCursors();
	});
}

export function renamePart(k: number, name: string) {
	const old = parts()[k]?.name;
	if (old === undefined || old === name) return;
	mutate((d) => {
		d.parts![k].name = name;
		for (const st of d.states ?? []) for (const sp of st.parts) if (sp.part === old) sp.part = name;
		for (const p of d.parts!) if (p.parent === old) p.parent = name;
		for (const c of d.clips ?? []) for (const key of c.keys) for (const sp of key.parts ?? []) if (sp.part === old) sp.part = name;
		for (const c of d.constraints ?? []) {
			c.chain = c.chain.map((n) => (n === old ? name : n));
			if (c.end.startsWith(`${old}/`)) c.end = `${name}/${c.end.slice(old.length + 1)}`;
		}
	});
}

/** Names a part may be parented to: everything but itself and its descendants. */
export function parentCandidates(k: number): string[] {
	const ps = parts();
	const me = ps[k]?.name;
	if (me === undefined) return [];
	const isDescendant = (name: string): boolean => {
		const seen = new Set<string>();
		let cur: string | undefined = name;
		while (cur !== undefined && !seen.has(cur)) {
			if (cur === me) return true;
			seen.add(cur);
			cur = ps.find((p) => p.name === cur)?.parent;
		}
		return false;
	};
	return ps.filter((p) => p.name !== me && !isDescendant(p.name)).map((p) => p.name);
}

export function setParent(k: number, parent: string | undefined) {
	if (parent !== undefined && !parentCandidates(k).includes(parent)) return;
	mutate((d) => {
		if (parent === undefined) delete d.parts![k].parent;
		else d.parts![k].parent = parent;
	});
}

export function swapParts(a: number, b: number) {
	const ps = parts();
	if (a < 0 || b < 0 || a >= ps.length || b >= ps.length) return;
	mutate((d) => {
		const arr = d.parts!;
		[arr[a], arr[b]] = [arr[b], arr[a]];
	});
	const remap = (r: Ref): Ref => ({ p: r.p === a ? b : r.p === b ? a : r.p, s: r.s });
	batch(() => {
		ed.sel.value = ed.sel.value.map(remap);
		if (ed.curPart.value === a) ed.curPart.value = b;
		else if (ed.curPart.value === b) ed.curPart.value = a;
	});
}

export function setPivot(k: number, at: Vec2) {
	mutate((d) => {
		d.parts![k].pivot = at;
	});
}

export function addAnchor(k: number, name: string, at: Vec2) {
	mutate((d) => {
		const p = d.parts![k];
		(p.anchors ??= []).push({ name, at });
	});
}

export function deleteAnchor(k: number, i: number) {
	mutate((d) => d.parts![k].anchors?.splice(i, 1));
}

/** Whether a part is drawn by a state; toggling adds it (at rest) or drops it. */
export function toggleMembership(stateIdx: number, partName: string) {
	mutate((d) => {
		const st = d.states![stateIdx];
		const i = st.parts.findIndex((sp) => sp.part === partName);
		if (i >= 0) st.parts.splice(i, 1);
		else {
			const part = d.parts!.find((p) => p.name === partName);
			st.parts.push({ part: partName, offset: part?.pivot ?? [0, 0] });
		}
	});
}

// ------------------------------------------------------------- states

export function addState(name: string) {
	mutate((d) => {
		// identity pose: every part, offset on its own pivot
		const st: State = { name, parts: d.parts!.map((p) => ({ part: p.name, offset: p.pivot ?? [0, 0] })) };
		(d.states ??= []).push(st);
	});
	ed.curState.value = states().length - 1;
	ed.sel.value = [];
}

export function deleteState(k: number) {
	const name = states()[k]?.name;
	mutate((d) => {
		d.states!.splice(k, 1);
		// keys that named it go too; a clip left with nothing goes with them
		if (d.clips) {
			for (const c of d.clips) c.keys = c.keys.filter((key) => key.state !== name);
			d.clips = d.clips.filter((c) => c.keys.length > 0);
		}
	});
	clampCursors();
}

export function renameState(k: number, name: string) {
	const old = states()[k]?.name;
	mutate((d) => {
		d.states![k].name = name;
		for (const c of d.clips ?? []) for (const key of c.keys) if (key.state === old) key.state = name;
	});
}

// ------------------------------------------------------------- clips

export function selectClip(k: number) {
	batch(() => {
		ed.curClip.value = k;
		ed.curKey.value = k >= 0 ? 0 : -1;
		ed.clipTime.value = 0;
		ed.playing.value = false;
		if (k >= 0) ed.curState.value = -1;
		ed.sel.value = [];
		ed.hover.value = null;
	});
}

export function addClip(name: string): boolean {
	const st = curState() ?? states()[0];
	if (!st) return false;
	mutate((d) => (d.clips ??= []).push({ name, keys: [{ t: 0, state: st.name }] }));
	selectClip(clips().length - 1);
	return true;
}

export function deleteClip(k: number) {
	mutate((d) => d.clips!.splice(k, 1));
	if (ed.curClip.value === k) selectClip(-1);
	else clampCursors();
}

export function renameClip(k: number, name: string) {
	mutate((d) => {
		d.clips![k].name = name;
	});
}

export function setClipLoop(k: number, loop: boolean) {
	mutate((d) => {
		if (loop) d.clips![k].loop = true;
		else delete d.clips![k].loop;
	});
}

function sortKeys(c: Clip, follow?: Clip["keys"][number]): number {
	c.keys.sort((a, b) => a.t - b.t);
	return follow ? c.keys.indexOf(follow) : -1;
}

/** A key at the playhead, wearing the state of the key before it. */
export function addKey() {
	const c = curClip();
	if (!c) return;
	const t = Math.round(ed.clipTime.value * 100) / 100;
	const before = [...c.keys].reverse().find((k) => k.t <= t);
	const state = before?.state ?? states()[0]?.name;
	if (state === undefined) return;
	const key = { t, state };
	let idx = -1;
	mutate(() => {
		c.keys.push(key);
		idx = sortKeys(c, key);
	});
	ed.curKey.value = idx;
}

export function deleteKey(i: number) {
	const c = curClip();
	if (!c || c.keys.length <= 1) return;
	mutate(() => c.keys.splice(i, 1));
	ed.curKey.value = Math.min(i, c.keys.length - 1);
}

export function setKeyTime(i: number, t: number, merge?: string) {
	const c = curClip();
	if (!c) return;
	const key = c.keys[i];
	if (!key) return;
	let idx = i;
	mutate(() => {
		key.t = Math.max(0, t);
		idx = sortKeys(c, key);
	}, merge);
	ed.curKey.value = idx;
}

export function setKeyState(i: number, state: string) {
	const c = curClip();
	if (!c?.keys[i]) return;
	mutate(() => {
		const key = c.keys[i];
		key.state = state;
		delete key.parts;
	});
}

export function setKeyEase(i: number, e: Ease | undefined) {
	const c = curClip();
	if (!c?.keys[i]) return;
	mutate(() => {
		if (e && e !== "linear") c.keys[i].ease = e;
		else delete c.keys[i].ease;
	});
}

/** Seek the preview; the key under the playhead becomes current. */
export function seek(t: number) {
	const c = curClip();
	if (!c) return;
	ed.clipTime.value = Math.max(0, t);
	const at = c.keys.findIndex((k) => Math.abs(k.t - t) < 1e-6);
	if (at >= 0) ed.curKey.value = at;
}

// ------------------------------------------------------------- chains (IK)

export function addChain(name: string, chain: string[], end: string) {
	mutate((d) => (d.constraints ??= []).push({ name, chain, end }));
}

export function deleteChain(k: number) {
	mutate((d) => d.constraints!.splice(k, 1));
}

export function renameChain(k: number, name: string) {
	mutate((d) => {
		d.constraints![k].name = name;
	});
}

export function setChain(k: number, chain: string[], end: string) {
	mutate((d) => {
		d.constraints![k].chain = chain;
		d.constraints![k].end = end;
	});
}

export function setChainBend(k: number, bend: 1 | -1 | undefined) {
	mutate((d) => {
		if (bend) d.constraints![k].bend = bend;
		else delete d.constraints![k].bend;
	});
}

/** Pull a chain's end to a point in the current state; only rotations move. */
export function ikTo(c: Constraint, target: Vec2) {
	const st = curState();
	if (!st) return;
	mutate((d) => {
		solveChain(d, st.parts, c, target);
	}, "ik");
}

export function setPose(sp: StatePart, patch: Partial<StatePart>, merge?: string) {
	mutate(() => Object.assign(sp, patch), merge);
}

export function resetPose(sp: StatePart) {
	const part = parts().find((p) => p.name === sp.part);
	mutate(() => {
		sp.offset = part?.pivot ?? [0, 0];
		delete sp.rotate;
		delete sp.scale;
	});
}

// ------------------------------------------------------------- tokens

export function addToken(name: string) {
	mutate((d) => (d.palette ??= []).push({ name, rgb: [180, 180, 180, 255] }));
	ed.curTok.value = palette().length - 1;
}

export function deleteToken(k: number) {
	mutate((d) => d.palette!.splice(k, 1));
	clampCursors();
}

export function renameToken(k: number, name: string) {
	const old = palette()[k]?.name;
	if (old === undefined || old === name) return;
	mutate((d) => {
		d.palette![k].name = name;
		for (const p of d.parts ?? []) for (const sh of p.shapes ?? []) if (sh.color === old) sh.color = name;
		for (const sh of d.collision ?? []) if (sh.color === old) sh.color = name;
	});
}

export function setTokenColor(k: number, rgb: Rgba) {
	mutate((d) => {
		d.palette![k].rgb = rgb;
	}, `token-${k}`);
}
