// The one list of things the studio can do. The menu bar, the command
// palette and the keyboard all read it; nothing does something the list
// cannot name.

import { signal } from "@preact/signals";

export interface Command {
	id: string;
	title: string;
	/** display form of the shortcut, e.g. "Cmd S" */
	keys?: string;
	group: string;
	/** false hides it from the palette and makes the key a no-op */
	when?: () => boolean;
	run: () => void;
}

const registry = new Map<string, Command>();
export const commandRev = signal(0);

export function register(...cs: Command[]) {
	for (const c of cs) registry.set(c.id, c);
	commandRev.value++;
}

export function command(id: string): Command | undefined {
	return registry.get(id);
}

export function commands(): Command[] {
	return [...registry.values()];
}

/** Run a command by id; false when it does not exist or does not apply now. */
export function run(id: string): boolean {
	const c = registry.get(id);
	if (!c || (c.when && !c.when())) return false;
	c.run();
	return true;
}

/** A keyboard event as "cmd+shift+z", the way the keymap spells it. */
export function keyOf(e: KeyboardEvent): string {
	const parts: string[] = [];
	if (e.metaKey || e.ctrlKey) parts.push("cmd");
	if (e.shiftKey) parts.push("shift");
	if (e.altKey) parts.push("alt");
	let k = e.key;
	if (e.code.startsWith("Digit")) k = e.code.slice(5);
	else if (e.code.startsWith("Key")) k = e.code.slice(3).toLowerCase();
	else if (e.code === "Equal") k = "=";
	else if (e.code === "Minus") k = "-";
	else if (e.code === "Quote") k = "'";
	else if (e.code === "BracketLeft") k = "[";
	else if (e.code === "BracketRight") k = "]";
	else if (e.code === "Slash") k = "/";
	else if (e.code === "Space") k = "space";
	else k = k.toLowerCase();
	parts.push(k);
	return parts.join("+");
}

export const KEYMAP: Record<string, string> = {
	v: "tool.select",
	r: "tool.rect",
	o: "tool.circle",
	l: "tool.line",
	p: "tool.poly",
	"1": "tool.select",
	"2": "tool.circle",
	"3": "tool.line",
	"4": "tool.poly",
	"5": "tool.rect",
	c: "view.collision",
	"cmd+s": "file.save",
	"cmd+n": "file.new",
	"cmd+o": "file.browse",
	"cmd+shift+o": "file.openFolder",
	"cmd+z": "edit.undo",
	"cmd+shift+z": "edit.redo",
	"cmd+y": "edit.redo",
	"cmd+c": "edit.copy",
	"cmd+v": "edit.paste",
	"cmd+x": "edit.cut",
	"cmd+d": "edit.duplicate",
	"cmd+a": "edit.selectAll",
	delete: "edit.delete",
	backspace: "edit.delete",
	x: "edit.delete",
	"[": "edit.lower",
	"]": "edit.raise",
	arrowleft: "edit.nudgeLeft",
	arrowright: "edit.nudgeRight",
	arrowup: "edit.nudgeUp",
	arrowdown: "edit.nudgeDown",
	"shift+arrowleft": "edit.nudgeLeft10",
	"shift+arrowright": "edit.nudgeRight10",
	"shift+arrowup": "edit.nudgeUp10",
	"shift+arrowdown": "edit.nudgeDown10",
	escape: "edit.escape",
	enter: "edit.enter",
	"cmd+=": "view.zoomIn",
	"cmd+-": "view.zoomOut",
	"cmd+0": "view.zoom100",
	"shift+1": "view.fit",
	"shift+2": "view.fitSelection",
	"cmd+'": "view.snapGrid",
	"cmd+b": "view.explorer",
	"cmd+k": "app.palette",
	"shift+/": "app.docs",
	space: "clip.play",
};

/** Pretty shortcut for a command id, from the keymap. */
export function keysFor(id: string): string | undefined {
	for (const [k, v] of Object.entries(KEYMAP)) {
		if (v !== id) continue;
		return k
			.split("+")
			.map((p) => (p === "cmd" ? "⌘" : p === "shift" ? "⇧" : p === "alt" ? "⌥" : p.startsWith("arrow") ? { left: "←", right: "→", up: "↑", down: "↓" }[p.slice(5)] : p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
			.join(" ");
	}
	return undefined;
}
