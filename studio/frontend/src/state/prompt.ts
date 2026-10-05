// The sheets, as state. ask() is the one-field sheet for every "name the
// new thing" and "rename": it resolves with the text, or null on cancel.
// confirm() is its yes/no sibling, choose() the three-way one (the
// unsaved-changes question), and openSheet() drops any other sheet
// (ui/Sheets.tsx) from the top of the window.

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";

export interface AskOptions {
	/** a line under the field, when the answer needs a word of context */
	hint?: string;
	/** the primary button's verb */
	ok?: string;
	message?: string;
	mono?: boolean;
	/** a word on what is wrong with the value, or null when it will do */
	validate?: (v: string) => string | null;
}

export const prompt = {
	open: signal(false),
	title: signal(""),
	value: signal(""),
	opts: signal<AskOptions>({}),
};

let pending: ((v: string | null) => void) | null = null;

export function ask(title: string, prefill = "", opts: AskOptions = {}): Promise<string | null> {
	if (pending) pending(null);
	prompt.opts.value = opts;
	prompt.title.value = title;
	prompt.value.value = prefill;
	prompt.open.value = true;
	return new Promise((resolve) => {
		pending = resolve;
	});
}

export function promptCommit() {
	const v = prompt.value.value.trim();
	if (!v.length || prompt.opts.value.validate?.(v)) return;
	prompt.open.value = false;
	const r = pending;
	pending = null;
	r?.(v);
}

export function promptCancel() {
	prompt.open.value = false;
	const r = pending;
	pending = null;
	r?.(null);
}

export interface Choice {
	id: string;
	label: string;
	primary?: boolean;
	danger?: boolean;
}

export const confirmBox = {
	open: signal(false),
	title: signal(""),
	body: signal(""),
	choices: signal<Choice[]>([]),
};

let pendingChoice: ((v: string) => void) | null = null;

/** A sheet of buttons; resolves with the id chosen, "cancel" on Escape. */
export function choose(title: string, body: string, choices: Choice[]): Promise<string> {
	if (pendingChoice) pendingChoice("cancel");
	confirmBox.title.value = title;
	confirmBox.body.value = body;
	confirmBox.choices.value = choices;
	confirmBox.open.value = true;
	return new Promise((resolve) => {
		pendingChoice = resolve;
	});
}

export function confirm(title: string, opts: { body?: string; ok?: string; danger?: boolean } = {}): Promise<boolean> {
	return choose(title, opts.body ?? "", [
		{ id: "cancel", label: "Cancel" },
		{ id: "ok", label: opts.ok ?? "Continue", primary: true },
	]).then((id) => id === "ok");
}

export function confirmAnswer(id: string) {
	confirmBox.open.value = false;
	const r = pendingChoice;
	pendingChoice = null;
	r?.(id);
}

/** Any other sheet: a component, drawn until it calls closeSheet(). */
export const sheet = signal<(() => ComponentChildren) | null>(null);

export function openSheet(render: () => ComponentChildren) {
	sheet.value = render;
}
export function closeSheet() {
	sheet.value = null;
}

/** A sheet is up: the canvas keys stay out of it. */
export function sheetOpen(): boolean {
	return prompt.open.value || confirmBox.open.value || sheet.value !== null;
}
