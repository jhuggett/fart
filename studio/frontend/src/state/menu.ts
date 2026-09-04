// The context menu and the command palette, as state. Components render
// them; anything may open them.

import { signal } from "@preact/signals";

export interface MenuItem {
	label: string;
	run?: () => void;
	danger?: boolean;
	disabled?: boolean;
	/** a divider before this item */
	sep?: boolean;
	keys?: string;
}

export const contextMenu = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);

export function openContextMenu(x: number, y: number, items: MenuItem[]) {
	contextMenu.value = { x, y, items };
}
export function closeContextMenu() {
	if (contextMenu.value) contextMenu.value = null;
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
