// Self-update, as state: the app checks GitHub for a newer studio release
// a moment after it starts and every few hours after, and shows a badge
// when there is one. The badge asks before anything downloads; the app
// swaps itself out and offers a restart. Served in a browser, none of
// this exists.

import { signal, batch } from "@preact/signals";
import { shell, type UpdateInfo, type UpdateProgress } from "../shell/shell.ts";
import { project } from "./project.ts";

export const update = {
	version: signal(""),
	info: signal<UpdateInfo | null>(null),
	/** idle, or the step under way */
	phase: signal<"idle" | "checking" | "download" | "unpack" | "install" | "done" | "error">("idle"),
	done: signal(0),
	total: signal(0),
	message: signal(""),
	/** the badge was closed for this session */
	dismissed: signal(false),
	checkedAt: signal(0),
};

const HOURS = 6;
let timer: number | undefined;
let listening = false;

/** Ask GitHub. `manual` says so in a toast either way. */
export async function checkForUpdates(manual = false) {
	if (!shell.updates) return;
	if (!listening) {
		listening = true;
		shell.onUpdate(onProgress);
		update.version.value = await shell.version();
	}
	if (update.phase.value !== "idle" && update.phase.value !== "error") return;
	update.phase.value = "checking";
	try {
		const info = await shell.updateCheck();
		batch(() => {
			update.info.value = info;
			update.version.value = info.current || update.version.value;
			update.checkedAt.value = Date.now();
			update.phase.value = "idle";
			if (info.available) update.dismissed.value = false;
		});
		if (manual) project.error.value = info.available ? `Uranus ${info.latest} is out (this is ${info.current})` : `Uranus ${info.current} is the latest`;
	} catch (e) {
		update.phase.value = "idle";
		if (manual) project.error.value = `could not check for updates: ${String(e)}`;
	}
}

/** Start the schedule: a first look shortly after boot, then every few hours. */
export function scheduleUpdateChecks() {
	if (!shell.updates || timer !== undefined) return;
	window.setTimeout(() => void checkForUpdates(), 4000);
	timer = window.setInterval(() => void checkForUpdates(), HOURS * 3600 * 1000);
}

function onProgress(p: UpdateProgress) {
	batch(() => {
		update.phase.value = p.phase;
		update.done.value = p.done;
		update.total.value = p.total;
		update.message.value = p.message;
	});
}

/** Download and install the release the badge shows. */
export async function applyUpdate() {
	const info = update.info.value;
	if (!info?.available || !info.assetUrl) return;
	batch(() => {
		update.phase.value = "download";
		update.done.value = 0;
		update.total.value = info.size;
		update.message.value = "";
	});
	try {
		await shell.updateApply(info.assetUrl);
	} catch (e) {
		batch(() => {
			update.phase.value = "error";
			update.message.value = String(e);
		});
	}
}

export async function relaunch() {
	try {
		await shell.updateRelaunch();
	} catch (e) {
		project.error.value = `could not restart: ${String(e)}`;
	}
}

export function dismissUpdate() {
	update.dismissed.value = true;
}
