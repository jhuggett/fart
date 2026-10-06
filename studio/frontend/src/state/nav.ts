// Where the content column is, and where it has been: a folder of the
// project in the asset browser, or a document. Back and forward walk the
// visits (the last fifty; a new visit cuts what was ahead). The browser's
// own view settings live here too: the selection, the kind filter, the
// tile size, the sort.

import { signal } from "@preact/signals";

export interface Place {
	/** a folder of the project ("" is its root) or a document's path */
	kind: "folder" | "doc";
	path: string;
}

const MAX = 50;

export const nav = {
	/** the folder the browser shows; "" is the whole project */
	folder: signal(""),
	stack: signal<Place[]>([]),
	at: signal(-1),
	/** the tile picked in the browser */
	selected: signal<string | null>(null),
	kind: signal<"all" | "2D" | "3D" | "scene" | "palette">("all"),
	filter: signal(""),
	size: signal<"S" | "M" | "L">(saved("size", "M") as "S" | "M" | "L"),
	sort: signal<"Name" | "Kind">(saved("sort", "Name") as "Name" | "Kind"),
	subfolders: signal(saved("subfolders", "on") === "on"),
	/** the search tab's words */
	query: signal(""),
};

function saved(k: string, d: string): string {
	try {
		return localStorage.getItem(`fastart.browse.${k}`) ?? d;
	} catch {
		return d;
	}
}
export function remember(k: string, v: string) {
	try {
		localStorage.setItem(`fastart.browse.${k}`, v);
	} catch {
		// the choice lasts the session
	}
}

let walking = false;

/** A place was shown: it joins the history, unless back or forward brought us here. */
export function visit(p: Place) {
	if (walking) return;
	const cur = nav.stack.value[nav.at.value];
	if (cur && cur.kind === p.kind && cur.path === p.path) return;
	const next = [...nav.stack.value.slice(0, nav.at.value + 1), p].slice(-MAX);
	nav.stack.value = next;
	nav.at.value = next.length - 1;
}

export function resetNav() {
	nav.stack.value = [];
	nav.at.value = -1;
	nav.folder.value = "";
	nav.selected.value = null;
	nav.filter.value = "";
	nav.kind.value = "all";
}

export const canBack = () => nav.at.value > 0;
export const canForward = () => nav.at.value < nav.stack.value.length - 1;

/** Step through the history; `go` shows a place (and may refuse, by resolving false). */
export async function walk(d: -1 | 1, go: (p: Place) => Promise<boolean>) {
	const i = nav.at.value + d;
	const p = nav.stack.value[i];
	if (!p) return;
	walking = true;
	try {
		if (await go(p)) nav.at.value = i;
	} finally {
		walking = false;
	}
}
