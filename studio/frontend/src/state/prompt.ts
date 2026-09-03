// One modal prompt for every "name the new thing" and "rename": ask()
// resolves with the text, or null on cancel.

import { signal } from "@preact/signals";

export const prompt = {
	open: signal(false),
	title: signal(""),
	value: signal(""),
};

let pending: ((v: string | null) => void) | null = null;

export function ask(title: string, prefill = ""): Promise<string | null> {
	if (pending) pending(null);
	prompt.title.value = title;
	prompt.value.value = prefill;
	prompt.open.value = true;
	return new Promise((resolve) => {
		pending = resolve;
	});
}

export function promptCommit() {
	const v = prompt.value.value.trim();
	prompt.open.value = false;
	const r = pending;
	pending = null;
	r?.(v.length ? v : null);
}

export function promptCancel() {
	prompt.open.value = false;
	const r = pending;
	pending = null;
	r?.(null);
}
