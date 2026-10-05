// Import glTF: a .glb or .gltf from anywhere on disk becomes a 3D .fart
// in the project. The importing is the core library's (importGltf); this
// reads the model (through the shell in the app, from the files chosen
// or dropped in a browser), writes the result and opens it. The sheet
// that asks how is ui/ImportGltf.tsx; Claude's tool is importTool here.

import { GltfError, gltfBufferUris, importGltf, snakeName, stringifyDoc, validate, type GltfImport, type GltfImportOptions } from "@fastart/core";
import { shell } from "../shell/shell.ts";
import { ASSET_NAME, NAME_HINT, goBrowse, openDoc, placed, project, refreshFiles } from "./project.ts";
import { logActivity } from "./activity.ts";
import { nav } from "./nav.ts";
import { openAsset } from "./sidebar.ts";

/** A model in hand: its bytes, and those of the files a .gltf keeps beside it. */
export interface GltfSource {
	/** the file's name, "helm.glb" */
	name: string;
	bytes: Uint8Array;
	buffers: Record<string, Uint8Array>;
}

/** What the sheet (or Claude) chose. */
export interface ImportChoices {
	/** scale by a factor, or to a height */
	size: "scale" | "height";
	scale: number;
	height: number;
	merge: boolean;
	splitMaterials: boolean;
	quads: boolean;
	shades: boolean;
}

export const DEFAULT_CHOICES: ImportChoices = { size: "scale", scale: 1, height: 24, merge: false, splitMaterials: false, quads: true, shades: true };

export const isGltfName = (name: string) => /\.(glb|gltf)$/i.test(name);
const baseOf = (path: string) => path.split(/[\\/]/).pop() ?? path;

function fromBase64(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** A model's bytes by its path on this machine (uri ""), or a file it names beside itself. */
async function readAt(path: string, uri: string): Promise<Uint8Array> {
	if (shell.kind === "wails") {
		const m = await import("../../bindings/studio/projectservice.js");
		return fromBase64(await m.ReadImport(path, uri));
	}
	const r = await fetch("api/import/read", { method: "POST", body: new URLSearchParams({ path, uri }) });
	if (!r.ok) throw new Error((await r.text()).trim() || `HTTP ${r.status}`);
	return new Uint8Array(await r.arrayBuffer());
}

/** The model at a path on this machine, with what it keeps beside it. */
export async function sourceFromPath(path: string): Promise<GltfSource> {
	const bytes = await readAt(path, "");
	const buffers: Record<string, Uint8Array> = {};
	for (const uri of gltfBufferUris(bytes)) {
		try {
			buffers[uri] = await readAt(path, uri);
		} catch {
			// the importer says which file is missing
		}
	}
	return { name: baseOf(path), bytes, buffers };
}

/** The model among files chosen or dropped in a browser: the .glb or .gltf, and the others by name. */
export async function sourceFromFiles(files: readonly File[]): Promise<GltfSource | null> {
	const main = files.find((f) => isGltfName(f.name));
	if (!main) return null;
	const bytes = new Uint8Array(await main.arrayBuffer());
	const buffers: Record<string, Uint8Array> = {};
	for (const uri of gltfBufferUris(bytes)) {
		let want = uri;
		try {
			want = decodeURIComponent(uri);
		} catch {
			// as written
		}
		const f = files.find((x) => x.name === baseOf(want));
		if (f) buffers[uri] = new Uint8Array(await f.arrayBuffer());
	}
	return { name: main.name, bytes, buffers };
}

/** The platform's dialog in the app; a browser's own file chooser when served. Null when cancelled. */
export async function pickSource(): Promise<GltfSource | null> {
	if (shell.kind === "wails") {
		const m = await import("../../bindings/studio/projectservice.js");
		const path = await m.PickImport();
		return path ? sourceFromPath(path) : null;
	}
	const files = await new Promise<File[]>((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".glb,.gltf,.bin";
		input.multiple = true;
		input.dataset.importGltf = "1";
		input.style.display = "none";
		input.addEventListener("change", () => (resolve([...(input.files ?? [])]), input.remove()));
		input.addEventListener("cancel", () => (resolve([]), input.remove()));
		document.body.appendChild(input);
		input.click();
	});
	return sourceFromFiles(files);
}

export function optionsOf(c: ImportChoices): GltfImportOptions {
	return { ...(c.size === "height" ? { height: c.height } : { scale: c.scale }), merge: c.merge, splitMaterials: c.splitMaterials, quads: c.quads, shades: c.shades };
}

/** The import itself: the document, what was left out, the summary; or the word on why it cannot be read. */
export function runImport(src: GltfSource, c: ImportChoices): { result: GltfImport | null; error: string } {
	try {
		const result = importGltf(src.bytes, { ...optionsOf(c), buffers: src.buffers });
		const report = validate(result.doc);
		if (!report.ok) return { result: null, error: report.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("; ") };
		return { result, error: "" };
	} catch (e) {
		if (e instanceof GltfError) return { result: null, error: e.message };
		throw e;
	}
}

/** The name an import takes unless told otherwise: the file's, in the project's spelling. */
export function defaultName(src: GltfSource): string {
	return snakeName(src.name.replace(/\.(glb|gltf)$/i, ""), "model");
}

/** What is wrong with a name for the new asset, or null. */
export function nameProblem(name: string): string | null {
	return name.split("/").every((seg) => ASSET_NAME.test(seg)) ? null : NAME_HINT;
}

/** Where an import of this name lands: in the folder the browser shows, else where new assets go. */
export function targetFor(name: string, folder: string = nav.folder.value): string {
	if (name.includes("/")) return `${name}.fart`;
	return placed(folder ? `${folder}/${name}.fart` : `${name}.fart`);
}

/** Write the import into the project and open it in the model screen. The caller has asked about replacing. */
export async function writeImport(rel: string, result: GltfImport, from: string): Promise<boolean> {
	const root = project.root.value;
	if (root === null) return false;
	// the file being replaced may be the one on the canvas: put it down first
	if (openAsset() === rel && !(await goBrowse())) return false;
	const doc = { ...result.doc, name: rel.split("/").pop()!.replace(/\.fart$/, "") };
	await shell.writeFile(root, rel, stringifyDoc(doc));
	await refreshFiles();
	const s = result.summary;
	logActivity(`Imported ${from} as ${rel}: ${s.parts} part${s.parts === 1 ? "" : "s"}, ${s.faces} faces`, "box");
	return openDoc(rel);
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const say = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

/** import_gltf, for Claude: the same import by path, answered with the summary. */
export async function importTool(args: Record<string, unknown>): Promise<ToolResult> {
	if (project.root.value === null) return say("no project is open", true);
	const path = typeof args.path === "string" ? args.path : "";
	if (!path) return say("path is required: the .glb or .gltf on this machine", true);
	if (!isGltfName(path)) return say(`${baseOf(path)} is not a .glb or .gltf`, true);
	let src: GltfSource;
	try {
		src = await sourceFromPath(path);
	} catch (e) {
		return say(String(e).replace(/^Error: /, ""), true);
	}
	const num = (v: unknown) => (typeof v === "number" && v > 0 ? v : undefined);
	const choices: ImportChoices = {
		...DEFAULT_CHOICES,
		size: num(args.height) !== undefined ? "height" : "scale",
		scale: num(args.scale) ?? 1,
		height: num(args.height) ?? DEFAULT_CHOICES.height,
		merge: args.merge === true,
		splitMaterials: args.split_materials === true,
		quads: args.quads !== false,
		shades: args.shades !== false,
	};
	const name = typeof args.name === "string" && args.name.trim() ? args.name.trim().replace(/\.fart$/, "") : defaultName(src);
	const bad = nameProblem(name);
	if (bad) return say(`name "${name}": ${bad}`, true);
	const rel = targetFor(name, "");
	if (project.files.value.includes(rel) && args.overwrite !== true) return say(`${rel} already exists; pass overwrite: true to replace it, or another name`, true);
	const { result, error } = runImport(src, choices);
	if (!result) return say(`could not import ${src.name}: ${error}`, true);
	const opened = await writeImport(rel, result, src.name);
	return say(JSON.stringify({ wrote: rel, opened, summary: result.summary, warnings: result.warnings }));
}
