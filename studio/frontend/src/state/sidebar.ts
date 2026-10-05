// The navigator and the inspector: which column is open, and which tab
// each shows. The navigator's tabs are the project's assets, the open
// asset's outline (parts, states, clips, or a scene's nodes), search and
// source control; the inspector's are the selection, the view, history
// and Ask. Open or closed persists per device; expanded folders last the
// session, and the open asset's folders open themselves.

import { signal, effect } from "@preact/signals";
import { project } from "./project.ts";
import { ed } from "./editor.ts";
import { md } from "./model.ts";
import { sc } from "./scene.ts";
import { dirname } from "./paths.ts";

const KEY = "fastart.sidebar";
const KEY_INSPECTOR = "fastart.inspector";

function saved(key: string): boolean {
	try {
		return localStorage.getItem(key) !== "closed";
	} catch {
		return true;
	}
}
function remember(key: string, open: boolean) {
	try {
		localStorage.setItem(key, open ? "open" : "closed");
	} catch {
		// the choice lasts the session
	}
}

/** "asset" is the Outline tab: the open asset's insides */
export type SidebarView = "assets" | "asset" | "search" | "git";
export type InspectorTab = "inspector" | "view" | "history" | "ask" | "help";

export const sidebar = {
	open: signal<boolean>(saved(KEY)),
	inspector: signal<boolean>(saved(KEY_INSPECTOR)),
	/** the navigator's tab */
	view: signal<SidebarView>("assets"),
	/** the inspector's tab */
	tab: signal<InspectorTab>("inspector"),
	/** which column the keys are in: the selection of the other dims */
	focus: signal<"nav" | "content" | "insp">("content"),
	expanded: signal<Set<string>>(new Set()),
};

export function toggleSidebar() {
	sidebar.open.value = !sidebar.open.value;
	remember(KEY, sidebar.open.value);
}

export function toggleInspector() {
	sidebar.inspector.value = !sidebar.inspector.value;
	remember(KEY_INSPECTOR, sidebar.inspector.value);
}

export function showTab(v: SidebarView) {
	sidebar.view.value = v;
	if (!sidebar.open.value) toggleSidebar();
}

export function showInspectorTab(t: InspectorTab) {
	sidebar.tab.value = t;
	if (!sidebar.inspector.value) toggleInspector();
}

/** Into the open asset. */
export function pushAsset() {
	sidebar.view.value = "asset";
	sidebar.open.value = true;
}

/** Back to the assets; the asset stays on the canvas. */
export function popToAssets() {
	sidebar.view.value = "assets";
}

export function toggleFolder(path: string) {
	const next = new Set(sidebar.expanded.value);
	if (next.has(path)) next.delete(path);
	else next.add(path);
	sidebar.expanded.value = next;
}

export function expandTo(rel: string) {
	const next = new Set(sidebar.expanded.value);
	let dir = dirname(rel);
	let grew = false;
	while (dir) {
		if (!next.has(dir)) {
			next.add(dir);
			grew = true;
		}
		dir = dirname(dir);
	}
	if (grew) sidebar.expanded.value = next;
}

/** The open asset's project path, whichever screen holds it. */
export function openAsset(): string | null {
	return ed.path.value ?? md.path.value ?? sc.path.value;
}

// the folders of whatever is open stay open
effect(() => {
	const rel = openAsset();
	if (rel) expandTo(rel);
});

export interface TreeNode {
	name: string;
	path: string;
	kind: "folder" | "file";
	children: TreeNode[];
}

/** The project's files as a tree: folders first, everything sorted. */
export function tree(): TreeNode {
	const root: TreeNode = { name: project.name.value, path: "", kind: "folder", children: [] };
	for (const rel of project.files.value) {
		const segs = rel.split("/");
		let node = root;
		for (let i = 0; i < segs.length; i++) {
			const seg = segs[i];
			const last = i === segs.length - 1;
			const path = segs.slice(0, i + 1).join("/");
			let child = node.children.find((c) => c.name === seg && c.kind === (last ? "file" : "folder"));
			if (!child) {
				child = { name: seg, path, kind: last ? "file" : "folder", children: [] };
				node.children.push(child);
			}
			node = child;
		}
	}
	const sort = (n: TreeNode) => {
		n.children.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
		n.children.forEach(sort);
	};
	sort(root);
	return root;
}
