// Menus, the command palette and inline renaming, as state. A right
// click asks the platform for its own menu (the app); a dropdown from a
// button, and a right click in the served studio where there is no
// platform to ask, drop from the one menu layer (ui/ContextMenu.tsx).

import { signal } from "@preact/signals";
import { shell } from "../shell/shell.ts";
import type { IconName } from "../ui/icons.ts";

export interface MenuItem {
	label: string;
	run?: () => void;
	danger?: boolean;
	disabled?: boolean;
	/** a divider before this item */
	sep?: boolean;
	/** the shortcut, or a word on the right */
	keys?: string;
	checked?: boolean;
	icon?: IconName;
	/** a group's name rather than a choice: the label, nothing to run */
	header?: boolean;
}

export interface OpenMenu {
	x: number;
	y: number;
	items: MenuItem[];
	/** anchored to the right edge of x rather than the left */
	align?: "left" | "right";
	minWidth?: number;
	class?: string;
}

export const contextMenu = signal<OpenMenu | null>(null);
/** the element the open dropdown hangs from, so its button can say it is expanded */
export const menuAnchor = signal<HTMLElement | null>(null);

let pending = new Map<string, () => void>();
let wired = false;

/** The menu under a right click: the platform's own in the app. */
export function openContextMenu(x: number, y: number, items: MenuItem[]) {
	if (!items.length) return;
	if (shell.kind !== "wails") {
		menuAnchor.value = null;
		contextMenu.value = { x, y, items };
		return;
	}
	if (!wired) {
		wired = true;
		shell.onPopup((id) => pending.get(id)?.());
	}
	pending = new Map();
	const native = [];
	for (const [i, it] of items.entries()) {
		if (it.sep) native.push({ id: "", label: "", separator: true, disabled: false, checked: false, keys: "", items: [] });
		const id = it.header || !it.run ? "" : `m${i}`;
		if (id) pending.set(id, it.run!);
		native.push({ id, label: it.label, separator: false, disabled: !!it.disabled || !!it.header, checked: !!it.checked, keys: it.keys ?? "", items: [] });
	}
	void shell.popupMenu(native, Math.round(x), Math.round(y));
}

/** A dropdown: the same items, hung from a button's bottom edge. */
export function openMenuBelow(el: HTMLElement, items: MenuItem[], opts: { align?: "left" | "right"; minWidth?: number; class?: string } = {}) {
	if (menuAnchor.value === el && contextMenu.value) return closeContextMenu();
	const r = el.getBoundingClientRect();
	menuAnchor.value = el;
	contextMenu.value = { x: opts.align === "right" ? r.right : r.left, y: r.bottom + 4, items, ...opts };
}

export function closeContextMenu() {
	if (contextMenu.value) contextMenu.value = null;
	if (menuAnchor.value) menuAnchor.value = null;
}

/** For a row's onContextMenu: the platform's menu where the pointer is. */
export function menuAt(e: MouseEvent, items: MenuItem[]) {
	e.preventDefault();
	e.stopPropagation();
	openContextMenu(e.clientX, e.clientY, items);
}

export const palette = {
	open: signal(false),
	query: signal(""),
	index: signal(0),
};

export function openPalette() {
	palette.query.value = "";
	palette.index.value = 0;
	palette.open.value = true;
}
export function closePalette() {
	palette.open.value = false;
}

/** Which row is being renamed inline: a kind and an index. */
export const renaming = signal<{ kind: "part" | "state" | "clip" | "token" | "chain" | "anchor"; index: number; sub?: number } | null>(null);
