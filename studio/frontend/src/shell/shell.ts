// The shell: everything the editor asks the machine for, behind one
// interface with two faces. Inside the desktop app it is the Go service
// (Wails bindings, in wails.ts, imported only there: the runtime phones
// home on load, which a plain browser cannot answer); loaded from the LAN
// server on a tablet it is the small JSON API rooted at the served
// project. The editor never knows which.

import type { ServeInfo } from "../../bindings/studio/models.js";

export type { ServeInfo };

export interface Shell {
	readonly kind: "wails" | "http";
	pickFolder(): Promise<string | null>;
	isDir(path: string): Promise<boolean>;
	home(): Promise<string>;
	defaultRoot(): Promise<string>;
	listFiles(root: string): Promise<string[]>;
	readFile(root: string, rel: string): Promise<string | null>;
	writeFile(root: string, rel: string, text: string): Promise<void>;
	recents(): Promise<string[]>;
	pushRecent(root: string): Promise<string[]>;
	forgetRecent(root: string): Promise<string[]>;
	drainOpenQueue(): Promise<string[]>;
	onOpenFiles(cb: () => void): void;
	serve(root: string): Promise<ServeInfo>;
	serveStatus(): Promise<ServeInfo>;
	serveStop(): Promise<void>;
	/** http mode only: what the server is serving */
	info(): Promise<{ name: string }>;
}

// Over HTTP the server owns the project: root is always "" and the API
// is relative. Dialogs and recents do not exist on a tablet.
class HttpShell implements Shell {
	readonly kind = "http" as const;
	async pickFolder() {
		return null;
	}
	async isDir() {
		return false;
	}
	async home() {
		return "";
	}
	async defaultRoot() {
		return "";
	}
	async listFiles() {
		const r = await fetch("api/list");
		return r.ok ? ((await r.json()) as string[]) : [];
	}
	async readFile(_root: string, rel: string) {
		const r = await fetch(`api/file?path=${encodeURIComponent(rel)}`);
		return r.ok ? await r.text() : null;
	}
	async writeFile(_root: string, rel: string, text: string) {
		await fetch(`api/file?path=${encodeURIComponent(rel)}`, { method: "PUT", body: text });
	}
	async recents() {
		return [];
	}
	async pushRecent() {
		return [];
	}
	async forgetRecent() {
		return [];
	}
	async drainOpenQueue() {
		return [];
	}
	onOpenFiles() {}
	async serve(): Promise<ServeInfo> {
		return { on: true, url: location.origin, root: "", qr: "" };
	}
	async serveStatus(): Promise<ServeInfo> {
		return { on: true, url: location.origin, root: "", qr: "" };
	}
	async serveStop() {}
	async info() {
		const r = await fetch("api/info");
		return r.ok ? ((await r.json()) as { name: string }) : { name: "" };
	}
}

export let shell: Shell = new HttpShell();

/** Pick the face for this environment. Called once, before anything else. */
export async function initShell(): Promise<Shell> {
	if ("_wails" in window) {
		const m = await import("./wails.ts");
		shell = new m.WailsShell();
	}
	return shell;
}
