// The project: a folder, its files, the recents, and which screen is up.
// The editor store keeps the open document; this keeps everything around
// it and the ways a project gets opened (dialog, drop, argv, the Finder).

import { signal, batch } from "@preact/signals";
import { parseDoc, resolvePalettes, type Doc, type Token } from "@fastart/core";
import { shell, initShell, type ServeInfo, type Caps } from "../shell/shell.ts";
import { openFile, leaveFile, save, ed } from "./editor.ts";
import { ask, confirm } from "./prompt.ts";
import { basename, dirname, joinRel, under, stripExt } from "./paths.ts";

export type Screen = "welcome" | "browse" | "edit" | "docs";

export interface Thumb {
	doc: Doc;
	tokens: Token[];
}

export const project = {
	root: signal<string | null>(null),
	name: signal(""),
	home: signal(""),
	files: signal<string[]>([]),
	thumbs: signal<Map<string, Thumb>>(new Map()),
	recents: signal<string[]>([]),
	serve: signal<ServeInfo | null>(null),
	screen: signal<Screen>("welcome"),
	docsBack: signal<Screen>("welcome"),
	docsPage: signal<string>("guide"),
	error: signal<string | null>(null),
	busy: signal(false),
	/** what the machine can do with files; the menus read it */
	caps: signal<Caps>({ trash: false, reveal: "" }),
};

let errorTimer: number | undefined;
project.error.subscribe((e) => {
	if (errorTimer !== undefined) clearTimeout(errorTimer);
	if (e) errorTimer = window.setTimeout(() => (project.error.value = null), 6000);
});

export async function boot() {
	await initShell();
	void shell.caps().then((c) => (project.caps.value = c));
	if (shell.kind === "http") {
		const info = await shell.info();
		batch(() => {
			project.root.value = "";
			project.name.value = info.name;
		});
		await goBrowse();
		return;
	}
	project.home.value = await shell.home();
	project.recents.value = await shell.recents();
	shell.onOpenFiles(() => void drainOpens());
	shell.log(`boot: shell=${shell.kind} url=${location.href}`);
	// anything the page drops on the floor lands in the shell's log too
	window.addEventListener("unhandledrejection", (ev) => shell.log(`unhandled: ${String(ev.reason)}`));
	window.addEventListener("error", (ev) => shell.log(`error: ${ev.message} @ ${ev.filename}:${ev.lineno}`));
	if (await drainOpens()) return;
	const def = await shell.defaultRoot();
	if (def) await openProject(def);
	else project.screen.value = "welcome";
}

/** Anything the OS handed us: the first one opens. */
export async function drainOpens(): Promise<boolean> {
	const paths = await shell.drainOpenQueue();
	if (!paths.length) return false;
	return openPath(paths[0]);
}

export async function openProject(root: string) {
	let r = root;
	while (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
	if (ed.path.value) await leaveFile();
	batch(() => {
		project.root.value = r;
		project.name.value = basename(r);
	});
	project.recents.value = await shell.pushRecent(r);
	await goBrowse();
}

/**
 * A path from a drop, argv or the Finder: a folder becomes the project; a
 * .fart opens inside the project it already belongs to (the open one, else
 * the terminal's folder), or failing both, its own folder becomes one.
 */
export async function openPath(path: string): Promise<boolean> {
	if (await shell.isDir(path)) {
		await openProject(path);
		return true;
	}
	if (!path.endsWith(".fart")) return false;
	let root = dirname(path) || "/";
	const cur = project.root.value;
	if (cur && under(path, cur)) root = cur;
	else {
		const def = await shell.defaultRoot();
		if (def && under(path, def)) root = def;
	}
	const rel = root === "/" ? path.slice(1) : path.slice(root.length + 1);
	if (root !== cur) await openProject(root);
	return openDoc(rel);
}

export async function pickFolder() {
	try {
		const p = await shell.pickFolder();
		if (p) await openProject(p);
	} catch (e) {
		shell.log(`pickFolder failed: ${String(e)}`);
		project.error.value = `the folder dialog failed: ${String(e)}`;
	}
}

export async function forgetRecent(root: string) {
	project.recents.value = await shell.forgetRecent(root);
}

export async function goWelcome() {
	if (ed.path.value) await leaveFile();
	project.screen.value = "welcome";
}

export async function goBrowse() {
	if (ed.path.value) await leaveFile();
	project.screen.value = "browse";
	await refreshFiles();
}

export function goDocs(page?: string) {
	if (page) project.docsPage.value = page;
	if (project.screen.value !== "docs") project.docsBack.value = project.screen.value;
	project.screen.value = "docs";
}

export function leaveDocs() {
	project.screen.value = project.docsBack.value;
}

export async function refreshFiles() {
	const root = project.root.value;
	if (root === null) return;
	project.busy.value = true;
	const files = await shell.listFiles(root);
	project.files.value = files;
	const thumbs = new Map<string, Thumb>();
	await Promise.all(
		files.map(async (rel) => {
			const text = await shell.readFile(root, rel);
			if (text === null) return;
			let doc: Doc | null = null;
			try {
				const r = parseDoc(text);
				doc = r.doc ?? (r.report.errors.every((e) => !["json", "version", "schema"].includes(e.code)) ? (JSON.parse(text) as Doc) : null);
			} catch {
				doc = null;
			}
			if (!doc) return;
			const dir = dirname(rel);
			const { tokens } = await resolvePalettes(doc, (ref) => shell.readFile(root, joinRel(dir, ref)));
			thumbs.set(rel, { doc, tokens });
		}),
	);
	batch(() => {
		project.thumbs.value = thumbs;
		project.busy.value = false;
	});
}

export async function openDoc(rel: string): Promise<boolean> {
	const ok = await openFile(rel);
	if (ok) project.screen.value = "edit";
	return ok;
}

export async function newFile(name: string) {
	const rel = name.endsWith(".fart") ? name : `${name}.fart`;
	if (await openDoc(rel)) {
		await save();
		await refreshFiles();
	}
}

// ------------------------------------------------------------- file ops

/** Take a file out of the project, after a word: to the Trash where there is one. */
export async function deleteFile(rel: string) {
	const root = project.root.value;
	if (root === null) return;
	const name = stripExt(basename(rel));
	const trash = project.caps.value.trash;
	const ok = await confirm(trash ? `Move "${name}" to the Trash?` : `Delete "${name}"?`, {
		body: trash ? "Its checkpoint goes with it. The Trash can give it back." : "This cannot be undone.",
		ok: trash ? "Move to Trash" : "Delete",
		danger: true,
	});
	if (!ok) return;
	if (ed.path.value === rel) await goBrowse();
	try {
		await shell.removeFile(root, rel);
	} catch (e) {
		project.error.value = String(e);
	}
	await refreshFiles();
}

/**
 * Rename a file, asked inline. A plain name stays in its folder; a name
 * with a slash is a path from the project's root, so this moves too.
 */
export async function renameFile(rel: string) {
	const root = project.root.value;
	if (root === null) return;
	const stem = stripExt(basename(rel));
	const name = await ask(`Rename "${stem}"`, stem);
	if (!name || name === stem) return;
	const dir = dirname(rel);
	const bare = name.endsWith(".fart") ? name.slice(0, -5) : name;
	const to = `${name.includes("/") ? bare : dir ? `${dir}/${bare}` : bare}.fart`;
	if (to === rel) return;
	try {
		await shell.renameFile(root, rel, to);
		if (ed.path.value === rel) ed.path.value = to;
	} catch (e) {
		project.error.value = `could not rename: ${String(e)}`;
	}
	await refreshFiles();
}

/** A copy beside the original ("hero copy"). */
export async function duplicateFile(rel: string): Promise<string | null> {
	const root = project.root.value;
	if (root === null) return null;
	try {
		const copy = await shell.duplicateFile(root, rel);
		await refreshFiles();
		return copy;
	} catch (e) {
		project.error.value = `could not duplicate: ${String(e)}`;
		return null;
	}
}

/** Show a file or folder ("" is the project) in the file browser. */
export async function revealFile(rel: string) {
	const root = project.root.value;
	if (root === null) return;
	try {
		await shell.revealFile(root, rel);
	} catch (e) {
		project.error.value = String(e);
	}
}

export async function toggleServe() {
	const root = project.root.value;
	if (root === null) return;
	const cur = project.serve.value;
	if (cur?.on) {
		await shell.serveStop();
		project.serve.value = null;
		return;
	}
	try {
		project.serve.value = await shell.serve(root);
	} catch (e) {
		project.error.value = `could not serve: ${String(e)}`;
	}
}

export async function refreshServe() {
	const s = await shell.serveStatus();
	project.serve.value = s.on ? s : null;
}
