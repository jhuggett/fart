// Editor-local flags that never reach the file: parts hidden or locked
// while you work. The file draws every part; these only steer the editor.

import { signal } from "@preact/signals";

export const local = {
	hidden: signal<Set<string>>(new Set()),
	locked: signal<Set<string>>(new Set()),
};

function toggle(s: typeof local.hidden, name: string) {
	const next = new Set(s.value);
	if (next.has(name)) next.delete(name);
	else next.add(name);
	s.value = next;
}

export const toggleHidden = (name: string) => toggle(local.hidden, name);
export const toggleLocked = (name: string) => toggle(local.locked, name);
export const isHidden = (name: string) => local.hidden.value.has(name);
export const isLocked = (name: string) => local.locked.value.has(name);
export function clearLocal() {
	local.hidden.value = new Set();
	local.locked.value = new Set();
}
