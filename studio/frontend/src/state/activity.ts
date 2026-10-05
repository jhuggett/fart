// What Uranus is doing now, and what it did: the activity view at the
// centre of the content header reads this. Long work (a clone, a commit,
// a projection) shows there with its progress; saves and checkpoints
// leave a line in the log.

import { signal } from "@preact/signals";
import type { IconName } from "../ui/icons.ts";

export interface LogLine {
	icon?: IconName;
	text: string;
	at: number;
}

export const activity = {
	log: signal<LogLine[]>([]),
	/** work in flight: its words and how far along (0..1), null when git did not say */
	busy: signal<{ message: string; progress: number | null } | null>(null),
	/** the last thing that failed, until something succeeds */
	error: signal<string | null>(null),
};

export function logActivity(text: string, icon?: IconName) {
	activity.log.value = [{ text, icon, at: Date.now() }, ...activity.log.value].slice(0, 30);
}

export function setBusy(message: string, progress: number | null = null) {
	activity.busy.value = { message, progress };
}

/** Run something long under a word; its failure lands in the view, and is thrown on. */
export async function busy<T>(message: string, work: () => Promise<T>, done?: string, icon?: IconName): Promise<T> {
	activity.error.value = null;
	setBusy(message);
	try {
		const out = await work();
		if (done) logActivity(done, icon);
		return out;
	} catch (e) {
		activity.error.value = String(e).replace(/^Error: /, "");
		throw e;
	} finally {
		activity.busy.value = null;
	}
}

/** "now", "3 min ago", "14:02": short enough for the log's right column. */
export function ago(at: number): string {
	const s = Math.round((Date.now() - at) / 1000);
	if (s < 45) return "now";
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
