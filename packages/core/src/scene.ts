// Scenes (.shart, a Scene Hierarchy of Art): a tree of placed instances
// of .fart files and other scenes. This module validates a scene, loads
// what it names, and flattens it into the list a renderer draws: each
// instance with its document, its tokens (the file's, the scenes'
// palettes, the node's), its pose list, and its world map. See
// spec/SHART.md.

import type { Anchor, Anchor3, Doc, Doc3, StatePart, StatePart3, Token, Vec2, Vec3 } from "./types.ts";
import type { Issue, Report } from "./validate.ts";
import { parseDoc } from "./parse.ts";
import { applyPalette, resolvePalettes, type RefReader } from "./palette.ts";
import { anchorsOf, attachXf, stateOf, worldTransforms, xfMul, XF_ID, type Xf } from "./geometry.ts";
import { sampleClip, sampleTargets } from "./clips.ts";
import { solveTargets } from "./ik.ts";
import { anchorsOf3, attachXf3, quatFromEuler, quatToMat, sampleClip3, sampleTargets3, stateOf3, worldTransforms3, xf3Mul, XF3_ID, type Xf3 } from "./space3.ts";
import { solveTargets3 } from "./ik3.ts";
import { collisionWorld, collisionWorld3, type Collider, type Collider3 } from "./collision.ts";
import { xfApply } from "./geometry.ts";
import { xf3Apply, xf3ApplyDir, xf3Scale } from "./space3.ts";

export interface SceneNode {
	name: string;
	/** a .fart (an instance) or a .shart (a scene placed whole); absent: a group */
	ref?: string;
	at?: number[];
	rotate?: number | Vec3;
	scale?: number;
	mirror?: boolean;
	state?: string;
	clip?: string;
	t?: number;
	palette?: string;
	attach?: { to: string; by?: string };
	children?: SceneNode[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

export interface Scene {
	version: 1;
	space?: "2d" | "3d";
	name?: string;
	palette_refs?: string[];
	nodes?: SceneNode[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

export const SHART_VERSION = 1;

// ------------------------------------------------------------- validation

export type SceneErrorCode = "json" | "version" | "schema" | "path" | "dup.node" | "space" | "ref.state" | "ref.clip" | "ref.anchor" | "cycle";

/** What a validator knows about a referenced file, when it has it. */
export type RefInfo = { kind: "fart"; space: "2d" | "3d"; states: string[]; clips: string[]; anchors: string[] } | { kind: "shart"; space: "2d" | "3d"; cycle?: boolean } | null;

export interface SceneValidateOptions {
	/** by ref as written; null for one that could not be read. Absent: no cross-file checks, an unresolved warning per ref. */
	refs?: Map<string, RefInfo>;
}

const KNOWN_TOP = ["version", "space", "name", "palette_refs", "nodes", "meta"];
const KNOWN_NODE = ["name", "ref", "at", "rotate", "scale", "mirror", "state", "clip", "t", "palette", "attach", "children", "meta"];
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isAbs = (p: string) => /^([A-Za-z]:|[/\\])/.test(p);

/** Validate a parsed scene: structure, then the cross-file checks the caller's refs allow. */
export function validateScene(input: unknown, opts: SceneValidateOptions = {}): Report {
	const errors: Issue[] = [];
	const warnings: Issue[] = [];
	const err = (code: SceneErrorCode, path: string, message: string) => errors.push({ code: code as Issue["code"], path, message });
	const warn = (code: "unknown" | "unresolved", path: string, message: string) => warnings.push({ code, path, message });
	const done = (): Report => ({ ok: errors.length === 0, errors, warnings });
	if (!isObj(input)) {
		err("schema", "", "a scene is a JSON object");
		return done();
	}
	const s = input;
	if (!("version" in s)) err("version", "/version", "version is required");
	else if (!Number.isInteger(s.version)) err("version", "/version", "version must be the integer 1");
	else if ((s.version as number) > SHART_VERSION) err("version", "/version", `version ${s.version} is newer than this reader (${SHART_VERSION})`);
	else if ((s.version as number) < 1) err("version", "/version", "version must be 1");
	if (errors.length) return done();
	let dim: 2 | 3 = 2;
	if ("space" in s) {
		if (s.space !== "2d" && s.space !== "3d") err("space", "/space", "space must be 2d or 3d");
		else if (s.space === "3d") dim = 3;
	}
	if (errors.length) return done();
	if ("name" in s && typeof s.name !== "string") err("schema", "/name", "expected a string");
	if ("palette_refs" in s) {
		if (!Array.isArray(s.palette_refs)) err("schema", "/palette_refs", "expected an array");
		else s.palette_refs.forEach((r, i) => {
			if (!isName(r)) err("schema", `/palette_refs/${i}`, "expected a non-empty string");
			else if (isAbs(r)) err("path", `/palette_refs/${i}`, "palette_refs are relative to the scene, never absolute");
		});
	}
	const refs = opts.refs;
	const unresolved = new Set<string>();
	const walk = (nodes: unknown, path: string, parentRef: string | undefined, depth: number) => {
		if (!Array.isArray(nodes)) {
			err("schema", path, "expected an array of nodes");
			return;
		}
		const names = new Set<string>();
		nodes.forEach((n, i) => {
			const np = `${path}/${i}`;
			if (!isObj(n)) {
				err("schema", np, "expected a node object");
				return;
			}
			if (!isName(n.name)) err("schema", `${np}/name`, "a node has a non-empty name");
			else if (names.has(n.name)) err("dup.node", `${np}/name`, `two siblings named "${n.name}"`);
			else names.add(n.name);
			let info: RefInfo | undefined;
			if ("ref" in n) {
				if (!isName(n.ref)) err("schema", `${np}/ref`, "expected a relative path");
				else if (isAbs(n.ref)) err("path", `${np}/ref`, "a ref is relative to the scene, never absolute");
				else if (refs) {
					info = refs.get(n.ref);
					if (info === undefined || info === null) {
						unresolved.add(n.ref);
						info = undefined;
					} else if (info.space !== (dim === 3 ? "3d" : "2d")) err("space", `${np}/ref`, `${n.ref} is ${info.space}; this scene is ${dim}d`);
					else if (info.kind === "shart" && info.cycle) err("cycle", `${np}/ref`, `${n.ref} reaches this scene again`);
				} else unresolved.add(n.ref);
			}
			if ("at" in n && !(Array.isArray(n.at) && n.at.length === dim && n.at.every(isNum))) err("schema", `${np}/at`, dim === 3 ? "expected [x, y, z]" : "expected [x, y]");
			if ("rotate" in n) {
				if (dim === 2 && !isNum(n.rotate)) err("schema", `${np}/rotate`, "a 2D turn is a number (radians)");
				if (dim === 3 && !(Array.isArray(n.rotate) && n.rotate.length === 3 && n.rotate.every(isNum))) err("schema", `${np}/rotate`, "a 3D turn is [x, y, z] radians");
			}
			if ("scale" in n && !(isNum(n.scale) && n.scale >= 0)) err("schema", `${np}/scale`, "expected a number >= 0");
			if ("mirror" in n && typeof n.mirror !== "boolean") err("schema", `${np}/mirror`, "expected true or false");
			if ("t" in n && !(isNum(n.t) && n.t >= 0)) err("schema", `${np}/t`, "expected a time >= 0");
			if ("state" in n && !isName(n.state)) err("schema", `${np}/state`, "expected a state name");
			if ("clip" in n && !isName(n.clip)) err("schema", `${np}/clip`, "expected a clip name");
			if ("state" in n && "clip" in n) err("schema", np, "a node shows a state or a clip, not both");
			if (info?.kind === "fart") {
				if (isName(n.state) && !info.states.includes(n.state)) err("ref.state", `${np}/state`, `${n.ref} has no state "${n.state}"`);
				if (isName(n.clip) && !info.clips.includes(n.clip)) err("ref.clip", `${np}/clip`, `${n.ref} has no clip "${n.clip}"`);
			}
			if ("palette" in n) {
				if (!isName(n.palette)) err("schema", `${np}/palette`, "expected a relative path");
				else if (isAbs(n.palette)) err("path", `${np}/palette`, "a palette is relative to the scene, never absolute");
			}
			if ("attach" in n) {
				const a = n.attach;
				if (!isObj(a) || !isName(a.to) || ("by" in a && !isName(a.by))) err("schema", `${np}/attach`, 'attach is {"to": anchor, "by"?: anchor}');
				else if (depth === 0) err("schema", `${np}/attach`, "a root node has nothing to attach to");
				else if (parentRef === undefined) err("ref.anchor", `${np}/attach`, "attach hangs from a parent that places a .fart; a group has no anchors");
				else if (refs) {
					const host = refs.get(parentRef);
					if (host?.kind === "shart") err("ref.anchor", `${np}/attach`, "attach hangs from a .fart; a scene has no anchors");
					else if (host?.kind === "fart" && !host.anchors.includes(a.to)) err("ref.anchor", `${np}/attach/to`, `${parentRef} has no anchor "${a.to}"`);
					if (info?.kind === "fart" && isName(a.by) && !info.anchors.includes(a.by)) err("ref.anchor", `${np}/attach/by`, `${n.ref} has no anchor "${a.by}"`);
					if (info?.kind === "shart") err("ref.anchor", `${np}/attach`, "a scene has no anchors to attach by");
				}
			}
			if ("meta" in n && !isObj(n.meta)) err("schema", `${np}/meta`, "expected an object");
			for (const k of Object.keys(n)) if (!KNOWN_NODE.includes(k)) warn("unknown", `${np}/${k}`, `"${k}" is not a shart 1 field; preserved, ignored`);
			if ("children" in n) walk(n.children, `${np}/children`, isName(n.ref) && n.ref.endsWith(".fart") ? n.ref : undefined, depth + 1);
		});
	};
	if ("nodes" in s) walk(s.nodes, "/nodes", undefined, 0);
	if ("meta" in s && !isObj(s.meta)) err("schema", "/meta", "expected an object");
	for (const k of Object.keys(s)) if (!KNOWN_TOP.includes(k)) warn("unknown", `/${k}`, `"${k}" is not a shart 1 field; preserved, ignored`);
	for (const r of unresolved) warn("unresolved", "/nodes", `${r} was not read, so its states, clips and anchors were not checked`);
	return done();
}

/** Parse and validate. `scene` is set when the report is ok; `raw` whenever the text was a JSON object, so a checker can still read what a broken scene names. */
export function parseScene(text: string, opts?: SceneValidateOptions): { scene: Scene | null; raw: Scene | null; report: Report } {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		return { scene: null, raw: null, report: { ok: false, errors: [{ code: "json", path: "", message: `not JSON: ${e instanceof Error ? e.message : String(e)}` }], warnings: [] } };
	}
	const report = validateScene(raw, opts);
	return { scene: report.ok ? (raw as Scene) : null, raw: isObj(raw) ? (raw as Scene) : null, report };
}

// ------------------------------------------------------------- loading

/** A referenced file, read: an art document with its own tokens, or a scene with its own loads. */
export type LoadedRef = { kind: "fart"; doc: Doc | Doc3; tokens: Token[]; unresolved: string[] } | { kind: "shart"; scene: LoadedScene } | null;

export interface LoadedScene {
	scene: Scene;
	/** the scene's path relative to the root's folder ("" for the root's own folder) */
	dir: string;
	/** by ref as written in this scene */
	refs: Map<string, LoadedRef>;
	/** the scene's palette_refs, each read (or null) */
	palettes: (Token[] | null)[];
	/** node palettes by path, each read (or null) */
	nodePalettes: Map<string, Token[] | null>;
	/** refs (as written) that could not be read */
	unresolved: string[];
	/** scene refs (as written) skipped because they reach this scene again */
	cycles: Set<string>;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
export function joinRef(dir: string, rel: string): string {
	const parts = (dir + rel).split("/");
	const out: string[] = [];
	for (const p of parts) {
		if (p === "" || p === ".") continue;
		if (p === ".." && out.length && out[out.length - 1] !== "..") out.pop();
		else out.push(p);
	}
	return out.join("/");
}

/**
 * Read everything a scene names, recursively: `read` takes a path
 * relative to the root scene's folder. A scene that reaches itself is
 * left out (the validator reports the cycle).
 */
/** `self` is the root scene's own file name, so a scene that names itself is a cycle too. */
export async function loadScene(scene: Scene, read: RefReader, dir = "", stack: string[] = [], self = ""): Promise<LoadedScene> {
	const out: LoadedScene = { scene, dir, refs: new Map(), palettes: [], nodePalettes: new Map(), unresolved: [], cycles: new Set() };
	const paletteOf = async (rel: string): Promise<Token[] | null> => {
		const text = await read(joinRef(dir, rel));
		const doc = text === null ? null : parseDoc(text).doc;
		return doc?.palette ?? null;
	};
	for (const ref of scene.palette_refs ?? []) {
		const p = await paletteOf(ref);
		if (!p) out.unresolved.push(ref);
		out.palettes.push(p);
	}
	const walk = async (nodes: SceneNode[], path: string) => {
		for (const n of nodes) {
			const np = path ? `${path}/${n.name}` : n.name;
			if (n.palette && !out.nodePalettes.has(np)) {
				const p = await paletteOf(n.palette);
				if (!p) out.unresolved.push(n.palette);
				out.nodePalettes.set(np, p);
			}
			if (n.ref && !out.refs.has(n.ref)) {
				const full = joinRef(dir, n.ref);
				if (n.ref.endsWith(".shart")) {
					if (stack.includes(full) || full === self) {
						out.refs.set(n.ref, null);
						out.cycles.add(n.ref);
					} else {
						const text = await read(full);
						const inner = text === null ? null : parseScene(text).scene;
						if (!inner) {
							out.refs.set(n.ref, null);
							out.unresolved.push(n.ref);
						} else out.refs.set(n.ref, { kind: "shart", scene: await loadScene(inner, read, dirOf(full), [...stack, self || "."], full) });
					}
				} else {
					const text = await read(full);
					const doc = text === null ? null : parseDoc(text).doc;
					if (!doc) {
						out.refs.set(n.ref, null);
						out.unresolved.push(n.ref);
					} else {
						const pal = await resolvePalettes(doc, (rel) => read(joinRef(dirOf(full), rel)));
						out.refs.set(n.ref, { kind: "fart", doc, tokens: pal.tokens, unresolved: pal.unresolved });
					}
				}
			}
			if (n.children) await walk(n.children, np);
		}
	};
	await walk(scene.nodes ?? [], "");
	return out;
}

/** What the validator wants to know about each ref, from a loaded scene. */
export function refInfo(loaded: LoadedScene): Map<string, RefInfo> {
	const out = new Map<string, RefInfo>();
	for (const [ref, r] of loaded.refs) {
		if (!r) {
			out.set(ref, loaded.cycles.has(ref) ? { kind: "shart", space: loaded.scene.space ?? "2d", cycle: true } : null);
			continue;
		}
		if (r.kind === "shart") out.set(ref, { kind: "shart", space: r.scene.scene.space ?? "2d" });
		else {
			const d = r.doc;
			const anchors = new Set<string>();
			for (const p of d.parts ?? []) {
				const src = p.like ? (d.parts ?? []).find((q) => q.name === p.like) : p;
				for (const a of (src?.anchors ?? []) as { name: string }[]) anchors.add(a.name);
			}
			out.set(ref, { kind: "fart", space: d.space === "3d" ? "3d" : "2d", states: (d.states ?? []).map((s) => s.name), clips: (d.clips ?? []).map((c) => c.name), anchors: [...anchors] });
		}
	}
	return out;
}

// ------------------------------------------------------------- flattening

/** One instance, ready to draw: its art, tokens, pose list and world map. */
export interface Placed {
	/** node names from the root, joined with "/" */
	path: string;
	node: SceneNode;
	doc: Doc | Doc3;
	tokens: Token[];
	/** the state's parts or the clip's frame; undefined draws every part at rest */
	poses: StatePart[] | StatePart3[] | undefined;
	/** the instance's world map: 2D or 3D by the scene's space */
	xf: Xf | Xf3;
	space: "2d" | "3d";
}

export interface FlattenOptions {
	/** seconds added to every clip's t: a viewer's clock */
	time?: number;
	/** filled when given: every node's world map (groups too), by path */
	worlds?: Map<string, Xf | Xf3>;
	/** filled when given: the frame each node's `at` lives in (its parent's world map, then any attach), by path */
	frames?: Map<string, Xf | Xf3>;
}

function localXf2(n: SceneNode): Xf {
	const at = (n.at ?? [0, 0]) as number[];
	const r = typeof n.rotate === "number" ? n.rotate : 0;
	const s = n.scale === undefined || n.scale === 0 ? 1 : n.scale;
	const c = Math.cos(r) * s;
	const sn = Math.sin(r) * s;
	const mx = n.mirror ? -1 : 1;
	return [c * mx, sn * mx, -sn, c, at[0], at[1]];
}
function localXf3(n: SceneNode): Xf3 {
	const at = (n.at ?? [0, 0, 0]) as number[];
	const e = Array.isArray(n.rotate) ? (n.rotate as Vec3) : ([0, 0, 0] as Vec3);
	const s = n.scale === undefined || n.scale === 0 ? 1 : n.scale;
	const m = quatToMat(quatFromEuler(e));
	const mx = n.mirror ? -1 : 1;
	return [m[0] * s * mx, m[1] * s, m[2] * s, m[3] * s * mx, m[4] * s, m[5] * s, m[6] * s * mx, m[7] * s, m[8] * s, at[0], at[1], at[2]];
}

/** The instance's pose list: its state, or its clip at t (targets reached). */
export function instancePoses(doc: Doc | Doc3, node: SceneNode, time = 0): StatePart[] | StatePart3[] | undefined {
	if (doc.space === "3d") {
		const d = doc as Doc3;
		if (node.clip) {
			const c = d.clips?.find((k) => k.name === node.clip);
			if (!c) return d.states?.[0]?.parts;
			const t = (node.t ?? 0) + time;
			const poses = sampleClip3(d, c, t);
			const tg = sampleTargets3(d, c, t);
			if (tg.length) solveTargets3(d, poses, tg);
			return poses;
		}
		if (node.state) return stateOf3(d, node.state)?.parts ?? d.states?.[0]?.parts;
		return d.states?.[0]?.parts;
	}
	const d = doc as Doc;
	if (node.clip) {
		const c = d.clips?.find((k) => k.name === node.clip);
		if (!c) return d.states?.[0]?.parts;
		const t = (node.t ?? 0) + time;
		const poses = sampleClip(d, c, t);
		const tg = sampleTargets(d, c, t);
		if (tg.length) solveTargets(d, poses, tg);
		return poses;
	}
	if (node.state) return stateOf(d, node.state)?.parts ?? d.states?.[0]?.parts;
	return d.states?.[0]?.parts;
}

/** An anchor of an art by name, through `like`, with the part it sits on. */
function findAnchor(doc: Doc | Doc3, name: string): { part: string; anchor: Anchor | Anchor3 } | null {
	for (const p of doc.parts ?? []) {
		const src = p.like ? (doc.parts ?? []).find((q) => q.name === p.like) : p;
		const a = (src?.anchors ?? []).find((x) => x.name === name);
		if (a) return { part: p.name, anchor: a as Anchor | Anchor3 };
	}
	return null;
}

/**
 * The scene as the list a renderer draws, in paint order (list order,
 * children after their parent). Each instance's tokens are its file's,
 * with the scenes' palettes and its own laid over; each world map
 * carries its ancestors' poses and any attach.
 */
export function flattenScene(loaded: LoadedScene, opts: FlattenOptions = {}, outerPalettes: (Token[] | null)[] = [], prefix = "", parentXf: Xf | Xf3 | null = null): Placed[] {
	const out: Placed[] = [];
	const space = loaded.scene.space === "3d" ? "3d" : "2d";
	const scenePalettes = [...(loaded.palettes ?? []), ...outerPalettes];
	const ID = space === "3d" ? XF3_ID : XF_ID;
	const mul = (a: Xf | Xf3, b: Xf | Xf3): Xf | Xf3 => (space === "3d" ? xf3Mul(a as Xf3, b as Xf3) : xfMul(a as Xf, b as Xf));
	const walk = (nodes: SceneNode[], path: string, parent: Xf | Xf3, host: Placed | null) => {
		for (const n of nodes) {
			const np = path ? `${path}/${n.name}` : n.name;
			const ref = n.ref ? loaded.refs.get(n.ref) : undefined;
			// the attach map: the host's posed anchor, and this art's own anchor
			let A: Xf | Xf3 = ID;
			if (n.attach && host) {
				const hostAnchor = findAnchor(host.doc, n.attach.to);
				if (hostAnchor) {
					const itemAnchor = ref?.kind === "fart" && n.attach.by ? findAnchor(ref.doc, n.attach.by)?.anchor : undefined;
					if (space === "3d") {
						const W = worldTransforms3(host.doc as Doc3, (host.poses as StatePart3[]) ?? []);
						const hostXf = W.get(hostAnchor.part) ?? XF3_ID;
						A = attachXf3(hostXf, hostAnchor.anchor as Anchor3, (itemAnchor as Anchor3) ?? { name: "", at: [0, 0, 0] });
					} else {
						const W = worldTransforms(host.doc as Doc, (host.poses as StatePart[]) ?? []);
						const hostXf = W.get(hostAnchor.part) ?? XF_ID;
						A = attachXf(hostXf, hostAnchor.anchor as Anchor, (itemAnchor as Anchor) ?? { name: "", at: [0, 0] });
					}
				}
			}
			const L = space === "3d" ? localXf3(n) : localXf2(n);
			const frame = mul(parent, A);
			const W = mul(frame, L);
			opts.worlds?.set(prefix + np, W);
			opts.frames?.set(prefix + np, frame);
			let placed: Placed | null = null;
			if (ref?.kind === "fart") {
				let tokens = ref.tokens;
				for (const p of scenePalettes) if (p) tokens = applyPalette(tokens, p);
				const own = loaded.nodePalettes.get(np);
				if (own) tokens = applyPalette(tokens, own);
				placed = { path: prefix + np, node: n, doc: ref.doc, tokens, poses: instancePoses(ref.doc, n, opts.time), xf: W, space };
				out.push(placed);
			} else if (ref?.kind === "shart") {
				out.push(...flattenScene(ref.scene, opts, scenePalettes, `${prefix}${np}/`, W));
			}
			if (n.children) walk(n.children, np, W, placed);
		}
	};
	walk(loaded.scene.nodes ?? [], "", parentXf ?? ID, null);
	return out;
}

/** Every instance's solids in scene space, with the node they came from. */
export function sceneCollision(placed: Placed[]): ({ path: string } & (Collider | Collider3))[] {
	const out: ({ path: string } & (Collider | Collider3))[] = [];
	for (const p of placed) {
		if (p.space === "3d") {
			const T = p.xf as Xf3;
			const s = xf3Scale(T);
			for (const c of collisionWorld3(p.doc as Doc3, p.poses as StatePart3[])) {
				if (c.kind === "ball") out.push({ path: p.path, ...c, at: xf3Apply(T, c.at), r: c.r * s });
				else if (c.kind === "rod") out.push({ path: p.path, ...c, a: xf3Apply(T, c.a), b: xf3Apply(T, c.b), w: c.w * s });
				else out.push({ path: p.path, ...c, points: c.points.map((q) => xf3Apply(T, q)) });
			}
			void xf3ApplyDir;
		} else {
			const T = p.xf as Xf;
			const s = Math.hypot(T[0], T[1]);
			for (const c of collisionWorld(p.doc as Doc, p.poses as StatePart[])) {
				if (c.kind === "circle") out.push({ path: p.path, ...c, at: xfApply(T, c.at), r: c.r * s });
				else if (c.kind === "line") out.push({ path: p.path, ...c, a: xfApply(T, c.a), b: xfApply(T, c.b), w: c.w * s });
				else out.push({ path: p.path, ...c, points: c.points.map((q) => xfApply(T, q)) });
			}
		}
	}
	return out;
}

/** Every art file a scene draws, by path relative to the root's folder: what a game preloads. */
export function sceneFiles(loaded: LoadedScene): string[] {
	const out = new Set<string>();
	for (const [ref, r] of loaded.refs) {
		if (r?.kind === "fart") out.add(joinRef(loaded.dir, ref));
		else if (r?.kind === "shart") for (const f of sceneFiles(r.scene)) out.add(f);
	}
	return [...out].sort();
}

export const sceneNodeCount = (scene: Scene): number => {
	let n = 0;
	const walk = (nodes: SceneNode[]) => {
		for (const x of nodes) {
			n++;
			if (x.children) walk(x.children);
		}
	};
	walk(scene.nodes ?? []);
	return n;
};
export type { Vec2 };
