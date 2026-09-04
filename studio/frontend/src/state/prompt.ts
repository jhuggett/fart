// One modal prompt for every "name the new thing" and "rename": ask()
// resolves with the text, or null on cancel. confirm() is its yes/no
// sibling, for the few things that cannot be undone.

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

export const confirmBox = {
	open: signal(false),
	title: signal(""),
	body: signal(""),
	ok: signal("OK"),
	danger: signal(false),
};

let pendingYes: ((v: boolean) => void) | null = null;

export function confirm(title: string, opts: { body?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
	if (pendingYes) pendingYes(false);
	confirmBox.title.value = title;
	confirmBox.body.value = opts.body ?? "";
	confirmBox.ok.value = opts.ok ?? "OK";
	confirmBox.danger.value = !!opts.danger;
	confirmBox.open.value = true;
	return new Promise((resolve) => {
		pendingYes = resolve;
	});
}

export function confirmAnswer(yes: boolean) {
	confirmBox.open.value = false;
	const r = pendingYes;
	pendingYes = null;
	r?.(yes);
}
