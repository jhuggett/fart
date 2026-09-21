// The scene store: a .shart open in the scene screen. The scene, what it
// names (read through the project), the instances flattened for the
// canvas, which node is chosen, the view for a 3D scene, a clock for
// clips. Edits land on disk within a moment; ⌘S is the checkpoint.

import { signal, batch } from "@preact/signals";
import {
	flattenScene,
	loadScene,
	parseScene,
	refInfo,
	validateScene,
	VIEWS,
	DEFAULT_LIGHT,
	DEFAULT_AMBIENT,
	quatAxis,
	quatFromEuler,
	quatMul,
	quatToEuler,
	xfInvert,
	xfApply,
	xf3Invert,
	xf3ApplyDir,
	type Issue,
	type LoadedScene,
	type Placed,
	type Scene,
	type SceneNode,
	type Vec3,
	type Xf,
	type Xf3,
} from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { project } from "./project.ts";
import { dirname, joinRel, basename } from "./paths.ts";
import { loadPatterns, type TexturePattern } from "./textures.ts";

export const sc = {
	scene: signal<Scene>({ version: 1 }),
	loaded: signal<LoadedScene | null>(null),
	path: signal<string | null>(null),
	rev: signal(0),
	/** the chosen node, by path */
	sel: signal<string | null>(null),
	hover: signal<string | null>(null),
	turn: signal<Vec3>([0, 0, 0]),
	viewName: signal("front"),
	light: signal<Vec3>(DEFAULT_LIGHT),
	ambient: signal(DEFAULT_AMBIENT),
	/** the clock every clip's t is offset by */
	time: signal(0),
	playing: signal(false),
	/** textures of the placed documents, by the document's project path */
	patterns: signal<Map<string, Map<string, TexturePattern>>>(new Map()),
	issues: signal<Issue[]>([]),
	dirty: signal(false),
	written: signal(0),
	checkpointAt: signal(0),
	canUndo: signal(false),
	canRedo: signal(false),
	space: false,
};

export function scene(): Scene {
	void sc.rev.value;
	return sc.scene.value;
}
export function is3d(): boolean {
	return sc.scene.value.space === "3d";
}
export function nodeAt(path: string | null): SceneNode | undefined {
	if (!path) return undefined;
	let nodes = sc.scene.value.nodes ?? [];
	let node: SceneNode | undefined;
	for (const name of path.split("/")) {
		node = nodes.find((n) => n.name === name);
		if (!node) return undefined;
		nodes = node.children ?? [];
	}
	return node;
}
export function parentPath(path: string): string | null {
	const i = path.lastIndexOf("/");
	return i < 0 ? null : path.slice(0, i);
}
function siblingsOf(path: string, d: Scene): SceneNode[] {
	const pp = parentPath(path);
	if (pp === null) return (d.nodes ??= []);
	const parent = nodeAtIn(d, pp);
	return parent ? (parent.children ??= []) : [];
}
function nodeAtIn(d: Scene, path: string): SceneNode | undefined {
	let nodes = d.nodes ?? [];
	let node: SceneNode | undefined;
	for (const name of path.split("/")) {
		node = nodes.find((n) => n.name === name);
		if (!node) return undefined;
		nodes = node.children ?? [];
	}
	return node;
}

/** The flattened scene at the clock, with every node's world map and frame. */
let cache: { key: string; placed: Placed[]; worlds: Map<string, Xf | Xf3>; frames: Map<string, Xf | Xf3> } | null = null;
export function flattened(): { placed: Placed[]; worlds: Map<string, Xf | Xf3>; frames: Map<string, Xf | Xf3> } {
	const loaded = sc.loaded.value;
	const key = `${sc.rev.value}|${sc.time.value}|${loaded ? 1 : 0}`;
	if (cache && cache.key === key) return cache;
	if (!loaded) return { placed: [], worlds: new Map(), frames: new Map() };
	const worlds = new Map<string, Xf | Xf3>();
	const frames = new Map<string, Xf | Xf3>();
	const placed = flattenScene(loaded, { time: sc.time.value, worlds, frames });
	cache = { key, placed, worlds, frames };
	return cache;
}
/** The project path of an instance's file. */
export function docPathOf(p: Placed): string {
	const rel = sc.path.value ?? "";
	return joinRel(dirname(rel), p.node.ref ? joinSceneRef(p) : "");
}
function joinSceneRef(p: Placed): string {
	// the path carries the nesting; the loaded scene tree knows each ref's dir
	const loaded = sc.loaded.value;
	if (!loaded) return p.node.ref ?? "";
	let cur: LoadedScene = loaded;
	const names = p.path.split("/");
	for (let i = 0; i < names.length - 1; i++) {
		const node = nodeAtIn(cur.scene, names.slice(0, i + 1).join("/"));
		void node;
	}
	// walk the loaded scenes by the refs on the path
	let dir = "";
	let scene = loaded;
	let nodes = scene.scene.nodes ?? [];
	for (let i = 0; i < names.length; i++) {
		const n = nodes.find((x) => x.name === names[i]);
		if (!n) break;
		if (i === names.length - 1) return dir + (n.ref ?? "");
		if (n.ref?.endsWith(".shart")) {
			const inner = scene.refs.get(n.ref);
			if (inner?.kind === "shart") {
				dir = inner.scene.dir;
				scene = inner.scene;
				nodes = scene.scene.nodes ?? [];
				continue;
			}
		}
		nodes = n.children ?? [];
	}
	return dir + (p.node.ref ?? "");
}

// ------------------------------------------------------------- undo, disk

interface Snap {
	scene: string;
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
const text = (s: Scene) => JSON.stringify(s, null, 2) + "\n";
const docText = () => JSON.stringify(sc.scene.value);
const root = () => project.root.value ?? "";

function touch() {
	batch(() => {
		sc.rev.value++;
		sc.dirty.value = docText() !== checkpoint;
		sc.canUndo.value = undoStack.length > 0;
		sc.canRedo.value = redoStack.length > 0;
	});
	scheduleFlush();
}
export function pushUndo() {
	undoStack.push({ scene: docText() });
	if (undoStack.length > UNDO_MAX) undoStack.shift();
	redoStack = [];
}
export function mutate(fn: (s: Scene) => void, merge?: string) {
	if (!merge || mergeKey !== merge) {
		pushUndo();
		mergeKey = merge ?? null;
	}
	const refsBefore = refsKey(sc.scene.value);
	fn(sc.scene.value);
	touch();
	if (refsKey(sc.scene.value) !== refsBefore) void reload();
}
export function endGesture() {
	mergeKey = null;
}
/** What a reload depends on: every ref, palette and palette_ref. */
function refsKey(s: Scene): string {
	const out: string[] = [...(s.palette_refs ?? [])];
	const walk = (nodes: SceneNode[]) => {
		for (const n of nodes) {
			out.push(n.ref ?? "", n.palette ?? "");
			if (n.children) walk(n.children);
		}
	};
	walk(s.nodes ?? []);
	return out.join("|");
}
function restore(snap: Snap) {
	sc.scene.value = JSON.parse(snap.scene) as Scene;
	if (sc.sel.value && !nodeAt(sc.sel.value)) sc.sel.value = null;
	touch();
	void reload();
}
export function undo() {
	const s = undoStack.pop();
	if (!s) return;
	redoStack.push({ scene: docText() });
	mergeKey = null;
	restore(s);
}
export function redo() {
	const s = redoStack.pop();
	if (!s) return;
	undoStack.push({ scene: docText() });
	mergeKey = null;
	restore(s);
}
function writeScene(rel: string, t: string): Promise<void> {
	const job = writes.then(async () => {
		try {
			await shell.writeFile(root(), rel, t);
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
	const rel = sc.path.value;
	if (!rel) return;
	const snap = docText();
	if (snap === lastFlush) return;
	lastFlush = snap;
	try {
		await writeScene(rel, text(sc.scene.value));
		sc.written.value = Date.now();
	} catch {
		lastFlush = "";
	}
}
export async function save() {
	const rel = sc.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	lastFlush = "";
	await flushNow();
	checkpoint = docText();
	await writeScene(`${rel}~`, text(sc.scene.value));
	batch(() => {
		sc.dirty.value = false;
		sc.checkpointAt.value = Date.now();
	});
}
export async function revertToCheckpoint() {
	if (!sc.path.value || !checkpoint) return;
	pushUndo();
	mergeKey = null;
	restore({ scene: checkpoint });
}

/** Read what the scene names, validate with it in hand, render textures. */
export async function reload() {
	const rel = sc.path.value;
	if (!rel) return;
	const r = root();
	const dir = dirname(rel);
	const read = (p: string) => shell.readFile(r, joinRel(dir, p));
	const loaded = await loadScene(sc.scene.value, read, "", [], basename(rel));
	if (sc.path.value !== rel) return;
	const report = validateScene(sc.scene.value, { refs: refInfo(loaded) });
	// textures of every placed document, by its project path
	const pats = new Map<string, Map<string, TexturePattern>>();
	const collect = async (ls: LoadedScene) => {
		for (const [ref, lr] of ls.refs) {
			if (lr?.kind === "fart") {
				const p = joinRel(dir, ls.dir + ref);
				if (!pats.has(p) && lr.doc.textures?.length) pats.set(p, await loadPatterns(lr.doc, p));
			} else if (lr?.kind === "shart") await collect(lr.scene);
		}
	};
	await collect(loaded);
	if (sc.path.value !== rel) return;
	batch(() => {
		sc.loaded.value = loaded;
		sc.patterns.value = pats;
		sc.issues.value = [...report.errors, ...report.warnings];
		sc.rev.value++;
	});
}

export async function openScene(rel: string, textIn: string): Promise<boolean> {
	if (sc.path.value) await leaveScene();
	const { raw, report } = parseScene(textIn);
	if (!raw) {
		project.error.value = `${rel}: ${report.errors[0]?.code ?? "?"} — ${report.errors[0]?.message ?? "not a scene"}`;
		return false;
	}
	if (report.errors.some((e) => e.code === "json" || e.code === "version")) {
		project.error.value = `${rel}: ${report.errors[0].code} — ${report.errors[0].message}`;
		return false;
	}
	raw.nodes ??= [];
	undoStack = [];
	redoStack = [];
	mergeKey = null;
	cache = null;
	batch(() => {
		sc.scene.value = raw;
		sc.path.value = rel;
		sc.loaded.value = null;
		sc.sel.value = null;
		sc.hover.value = null;
		sc.time.value = 0;
		sc.playing.value = false;
		sc.turn.value = [0, 0, 0];
		sc.viewName.value = "front";
		sc.dirty.value = false;
		sc.canUndo.value = false;
		sc.canRedo.value = false;
		sc.rev.value++;
	});
	lastFlush = docText();
	const ck = await shell.readFile(root(), `${rel}~`);
	const ckRaw = ck === null ? null : parseScene(ck).raw;
	if (ckRaw) checkpoint = JSON.stringify(ckRaw);
	else {
		checkpoint = docText();
		await writeScene(`${rel}~`, text(raw));
	}
	sc.dirty.value = docText() !== checkpoint;
	await reload();
	return true;
}

export async function leaveScene() {
	const rel = sc.path.value;
	if (!rel) return;
	if (flushTimer !== undefined) clearTimeout(flushTimer);
	flushTimer = undefined;
	await flushNow();
	await writes.catch(() => {});
	batch(() => {
		sc.path.value = null;
		sc.loaded.value = null;
		sc.dirty.value = false;
		sc.written.value = 0;
		sc.checkpointAt.value = 0;
		sc.playing.value = false;
	});
	cache = null;
}

// ------------------------------------------------------------- the view (3D)

export function setView(name: string) {
	const t = VIEWS[name];
	if (!t) return;
	batch(() => {
		sc.turn.value = [...t] as Vec3;
		sc.viewName.value = name;
	});
}
export function orbit(yaw: number, pitch: number) {
	const q = quatMul(quatAxis([1, 0, 0], pitch), quatMul(quatAxis([0, 1, 0], yaw), quatFromEuler(sc.turn.value)));
	batch(() => {
		sc.turn.value = quatToEuler(q);
		sc.viewName.value = "";
	});
}
export function setTurn(t: Vec3) {
	batch(() => {
		sc.turn.value = t;
		sc.viewName.value = Object.entries(VIEWS).find(([, v]) => v.every((x, i) => Math.abs(x - t[i]) < 1e-6))?.[0] ?? "";
	});
}

// ------------------------------------------------------------- edits

export function freshName(base: string, taken: Iterable<string>): string {
	const set = new Set(taken);
	if (!set.has(base)) return base;
	for (let i = 2; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}
export function setNode(path: string, patch: Partial<SceneNode>, merge?: string) {
	mutate((s) => {
		const n = nodeAtIn(s, path);
		if (!n) return;
		for (const [k, v] of Object.entries(patch)) {
			if (v === undefined || v === "" || v === null || (k === "mirror" && v === false) || (k === "scale" && v === 1) || (k === "t" && v === 0)) delete (n as Record<string, unknown>)[k];
			else (n as Record<string, unknown>)[k] = v;
		}
	}, merge);
}
export function renameNode(path: string, name: string) {
	const n = nodeAt(path);
	if (!n || !name || name.includes("/")) return;
	const sibs = siblingsOf(path, sc.scene.value);
	if (sibs.some((q) => q !== n && q.name === name)) return;
	mutate((s) => {
		const x = nodeAtIn(s, path);
		if (x) x.name = name;
	});
	const pp = parentPath(path);
	sc.sel.value = pp === null ? name : `${pp}/${name}`;
}
/** A node under `parent` (null: the root), named fresh. Returns its path. */
export function addNode(parent: string | null, node: Omit<SceneNode, "name">, base = "node"): string {
	let path = "";
	mutate((s) => {
		const list = parent === null ? (s.nodes ??= []) : (nodeAtIn(s, parent)!.children ??= []);
		const name = freshName(base, list.map((n) => n.name));
		list.push({ name, ...node });
		path = parent === null ? name : `${parent}/${name}`;
	});
	sc.sel.value = path;
	return path;
}
export function deleteNode(path: string) {
	mutate((s) => {
		const list = siblingsOf(path, s);
		const i = list.findIndex((n) => n.name === basename(path));
		if (i >= 0) list.splice(i, 1);
	});
	if (sc.sel.value === path || sc.sel.value?.startsWith(path + "/")) sc.sel.value = null;
}
export function duplicateNode(path: string): string | null {
	const n = nodeAt(path);
	if (!n) return null;
	const copy = JSON.parse(JSON.stringify(n)) as SceneNode;
	const pp = parentPath(path);
	return addNode(pp, { ...copy, name: undefined } as unknown as Omit<SceneNode, "name">, n.name);
}
/** Move a node among its siblings: later paints over (2D). */
export function moveNode(path: string, later: boolean) {
	mutate((s) => {
		const list = siblingsOf(path, s);
		const i = list.findIndex((n) => n.name === basename(path));
		const j = later ? i + 1 : i - 1;
		if (i < 0 || j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
	});
}
export function setSceneName(name: string) {
	mutate((s) => (s.name = name), "scene-name");
}
export function addPaletteRef(ref: string) {
	mutate((s) => (s.palette_refs ??= []).push(ref));
}
export function removePaletteRef(i: number) {
	mutate((s) => {
		s.palette_refs!.splice(i, 1);
		if (!s.palette_refs!.length) delete s.palette_refs;
	});
}

/** Move a node's `at` by a world displacement (the frame it lives in undone). */
export function nudgeNode(path: string, dWorld: number[], merge = "move") {
	const n = nodeAt(path);
	const frame = flattened().frames.get(path);
	if (!n || !frame) return;
	const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
	if (is3d()) {
		const inv = xf3Invert(frame as Xf3);
		const d = xf3ApplyDir(inv, [dWorld[0], dWorld[1], dWorld[2] ?? 0]);
		const at = (n.at ?? [0, 0, 0]) as number[];
		setNode(path, { at: [r3(at[0] + d[0]), r3(at[1] + d[1]), r3(at[2] + d[2])] }, merge);
	} else {
		const inv = xfInvert(frame as Xf);
		const o = xfApply(inv, [0, 0]);
		const d = xfApply(inv, [dWorld[0], dWorld[1]]);
		const at = (n.at ?? [0, 0]) as number[];
		setNode(path, { at: [r3(at[0] + d[0] - o[0]), r3(at[1] + d[1] - o[1])] }, merge);
	}
}

/** Files of the project a node of this scene may place: art of the same space, and other scenes. */
export function placeable(): { rel: string; kind: "fart" | "shart"; label: string }[] {
	const rel = sc.path.value ?? "";
	const dir = dirname(rel);
	const out: { rel: string; kind: "fart" | "shart"; label: string }[] = [];
	for (const [file, t] of project.thumbs.value) {
		if (file === rel) continue;
		if (t.scene) {
			if ((t.scene.scene.scene.space === "3d") === is3d()) out.push({ rel: relTo(dir, file), kind: "shart", label: file });
			continue;
		}
		if (!t.doc.parts || (t.space3d ?? false) !== is3d()) continue;
		out.push({ rel: relTo(dir, file), kind: "fart", label: file });
	}
	return out.sort((a, b) => a.label.localeCompare(b.label));
}
function relTo(fromDir: string, file: string): string {
	const a = fromDir ? fromDir.split("/") : [];
	const b = file.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}
/** The referenced art of a node, loaded, for pickers of states, clips and anchors. */
export function refDoc(path: string | null) {
	const n = nodeAt(path);
	const loaded = sc.loaded.value;
	if (!n?.ref || !loaded) return null;
	// nested scenes' nodes are not edited here; only the root's refs are looked up
	const r = loaded.refs.get(n.ref);
	return r?.kind === "fart" ? r.doc : null;
}
export function anchorsOfDoc(doc: { parts?: { name: string; like?: string; anchors?: { name: string }[] }[] } | null): string[] {
	if (!doc) return [];
	const out = new Set<string>();
	for (const p of doc.parts ?? []) {
		const src = p.like ? (doc.parts ?? []).find((q) => q.name === p.like) : p;
		for (const a of src?.anchors ?? []) out.add(a.name);
	}
	return [...out];
}
