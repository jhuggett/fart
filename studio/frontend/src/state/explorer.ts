// The explorer: the project's folders and files as a tree, beside the
// shelf and beside the canvas, so another file is one click away from
// anywhere. Open/closed persists per device; expanded folders last the
// session, and the current file's folders open themselves.

import { signal, effect } from "@preact/signals";
import { project } from "./project.ts";
import { ed } from "./editor.ts";
import { dirname } from "./paths.ts";

const KEY = "fastart.explorer";

function saved(): boolean {
	try {
		return localStorage.getItem(KEY) !== "closed";
	} catch {
		return true;
	}
}

export const explorer = {
	open: signal<boolean>(saved()),
	expanded: signal<Set<string>>(new Set()),
};

export function toggleExplorer() {
	explorer.open.value = !explorer.open.value;
	try {
		localStorage.setItem(KEY, explorer.open.value ? "open" : "closed");
	} catch {
		// the choice lasts the session
	}
}

export function toggleFolder(path: string) {
	const next = new Set(explorer.expanded.value);
	if (next.has(path)) next.delete(path);
	else next.add(path);
	explorer.expanded.value = next;
}

export function expandTo(rel: string) {
	const next = new Set(explorer.expanded.value);
	let dir = dirname(rel);
	let grew = false;
	while (dir) {
		if (!next.has(dir)) {
			next.add(dir);
			grew = true;
		}
		dir = dirname(dir);
	}
	if (grew) explorer.expanded.value = next;
}

// the folders of whatever is open stay open
effect(() => {
	const rel = ed.path.value;
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
