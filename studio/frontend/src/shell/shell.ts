// The shell: everything the editor asks the machine for, behind one
// interface with two faces. Inside the desktop app it is the Go service
// (Wails bindings, in wails.ts, imported only there: the runtime phones
// home on load, which a plain browser cannot answer); loaded from the LAN
// server on a tablet it is the small JSON API rooted at the served
// project. The editor never knows which.

import type { ServeInfo } from "../../bindings/studio/models.js";

export type { ServeInfo };

/** What the machine can do with files, so the menus say the right thing. */
export interface Caps {
	/** removeFile moves to the Trash rather than deleting */
	trash: boolean;
	/** the file browser's name ("Finder"), "" where none can be opened */
	reveal: string;
}

/** One thing Claude did or said, relayed as it happens. */
export interface ChatEvent {
	kind: "init" | "text" | "tool" | "result" | "error" | "done" | "log";
	text?: string;
	name?: string;
	input?: string;
	session?: string;
	cost?: number;
	model?: string;
	/** "none" when a plan pays for the turn, else where the API key came from */
	keySource?: string;
}
/** A tool call the editor must answer (see state/tools.ts). */
export interface ToolCall {
	id: string;
	name: string;
	args: Record<string, unknown>;
}
export interface ChatInfo {
	found: boolean;
	path: string;
	busy: boolean;
	loggedIn?: boolean;
	/** "claude.ai" for a plan; anything else is an API key or no login */
	authMethod?: string;
	email?: string;
	/** "max", "pro", … on a claude.ai login */
	plan?: string;
	org?: string;
}

export interface Shell {
	readonly kind: "wails" | "http";
	pickFolder(): Promise<string | null>;
	isDir(path: string): Promise<boolean>;
	home(): Promise<string>;
	defaultRoot(): Promise<string>;
	listFiles(root: string): Promise<string[]>;
	readFile(root: string, rel: string): Promise<string | null>;
	writeFile(root: string, rel: string, text: string): Promise<void>;
	/** when a file was last written (ms since the epoch), null when it is not there */
	stat(root: string, rel: string): Promise<number | null>;
	caps(): Promise<Caps>;
	/** to the Trash where there is one, else gone; resolves with which */
	removeFile(root: string, rel: string): Promise<string>;
	renameFile(root: string, from: string, to: string): Promise<void>;
	/** a copy beside the original; resolves with its path */
	duplicateFile(root: string, rel: string): Promise<string>;
	/** show it in the file browser; "" is the project folder */
	revealFile(root: string, rel: string): Promise<void>;
	/** the setup probes reach the home folder and the repo root: only on the machine itself */
	readonly setup: boolean;
	gitRoot(dir: string): Promise<string>;
	/** the fastart checkout this studio came from, "" if unknown */
	checkout(): Promise<string>;
	readAt(base: string, rel: string): Promise<string | null>;
	writeAt(base: string, rel: string, text: string): Promise<void>;
	/** files named so below base ("*.odin" for a suffix) */
	findNamed(base: string, name: string): Promise<string[]>;
	/** Claude, inside: only on the machine that runs Claude Code */
	readonly chat: boolean;
	chatStatus(): Promise<ChatInfo>;
	chatAsk(root: string, prompt: string): Promise<void>;
	chatStop(): Promise<void>;
	chatReset(root: string): Promise<void>;
	/** the editor's answer to a relayed tool call: an MCP result, as JSON text */
	toolReply(id: string, result: string): Promise<void>;
	onChat(cb: (e: ChatEvent) => void): void;
	onTool(cb: (t: ToolCall) => void): void;
	recents(): Promise<string[]>;
	pushRecent(root: string): Promise<string[]>;
	forgetRecent(root: string): Promise<string[]>;
	drainOpenQueue(): Promise<string[]>;
	onOpenFiles(cb: () => void): void;
	serve(root: string): Promise<ServeInfo>;
	serveStatus(): Promise<ServeInfo>;
	serveStop(): Promise<void>;
	/** http mode only: what the server is serving, and where (an absolute path, for setup) */
	info(): Promise<{ name: string; root?: string }>;
	/** a line into the shell's log, for debugging */
	log(msg: string): void;
	/** the menu bar chose a command (by id) */
	onMenu(cb: (id: string) => void): void;
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
		if (!this.setup) return "";
		const r = await fetch("api/setup/home");
		return r.ok ? ((await r.json()) as string) : "";
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
		const r = await fetch(`api/file?path=${encodeURIComponent(rel)}`, { method: "PUT", body: text });
		if (!r.ok) throw new Error((await r.text()).trim() || `HTTP ${r.status}`);
	}
	async stat(_root: string, rel: string) {
		const r = await fetch(`api/stat?path=${encodeURIComponent(rel)}`);
		if (!r.ok) return null;
		const t = (await r.json()) as { text: string; found: boolean };
		return t.found ? Number(t.text) : null;
	}
	async caps() {
		const r = await fetch("api/info");
		const info = r.ok ? ((await r.json()) as { trash?: boolean }) : {};
		return { trash: !!info.trash, reveal: "" };
	}
	async removeFile(_root: string, rel: string) {
		const r = await fetch(`api/file?path=${encodeURIComponent(rel)}`, { method: "DELETE" });
		if (!r.ok) throw new Error((await r.text()).trim());
		return (await r.json()) as string;
	}
	async renameFile(_root: string, from: string, to: string) {
		const r = await fetch(`api/rename?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { method: "POST" });
		if (!r.ok) throw new Error((await r.text()).trim());
	}
	async duplicateFile(_root: string, rel: string) {
		const r = await fetch(`api/duplicate?path=${encodeURIComponent(rel)}`, { method: "POST" });
		if (!r.ok) throw new Error((await r.text()).trim());
		return (await r.json()) as string;
	}
	async revealFile() {}
	readonly setup = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
	async gitRoot(dir: string) {
		const r = await fetch(`api/setup/gitroot?dir=${encodeURIComponent(dir)}`);
		return r.ok ? ((await r.json()) as string) : "";
	}
	async checkout() {
		const r = await fetch("api/setup/checkout");
		return r.ok ? ((await r.json()) as string) : "";
	}
	async readAt(base: string, rel: string) {
		const r = await fetch(`api/setup/file?base=${encodeURIComponent(base)}&rel=${encodeURIComponent(rel)}`);
		if (!r.ok) return null;
		const t = (await r.json()) as { text: string; found: boolean };
		return t.found ? t.text : null;
	}
	async writeAt(base: string, rel: string, text: string) {
		const r = await fetch(`api/setup/file?base=${encodeURIComponent(base)}&rel=${encodeURIComponent(rel)}`, { method: "PUT", body: text });
		if (!r.ok) throw new Error((await r.text()).trim());
	}
	async findNamed(base: string, name: string) {
		const r = await fetch(`api/setup/find?base=${encodeURIComponent(base)}&name=${encodeURIComponent(name)}`);
		return r.ok ? ((await r.json()) as string[]) : [];
	}
	readonly chat = this.setup;
	private events?: EventSource;
	private chatCbs: ((e: ChatEvent) => void)[] = [];
	private toolCbs: ((t: ToolCall) => void)[] = [];
	private listen() {
		if (this.events) return;
		this.events = new EventSource("api/chat/events");
		this.events.onmessage = (m) => {
			const { name, data } = JSON.parse(m.data) as { name: string; data: unknown };
			if (name === "chat") for (const cb of this.chatCbs) cb(data as ChatEvent);
			if (name === "tool") for (const cb of this.toolCbs) cb(data as ToolCall);
		};
	}
	async chatStatus() {
		const r = await fetch("api/chat/status");
		return r.ok ? ((await r.json()) as ChatInfo) : { found: false, path: "", busy: false };
	}
	async chatAsk(_root: string, prompt: string) {
		this.listen();
		const r = await fetch("api/chat/ask", { method: "POST", body: prompt });
		if (!r.ok) throw new Error((await r.text()).trim());
	}
	async chatStop() {
		await fetch("api/chat/stop", { method: "POST" });
	}
	async chatReset() {
		await fetch("api/chat/reset", { method: "POST" });
	}
	async toolReply(id: string, result: string) {
		await fetch(`api/chat/tool?id=${encodeURIComponent(id)}`, { method: "POST", body: result });
	}
	onChat(cb: (e: ChatEvent) => void) {
		this.chatCbs.push(cb);
		if (this.chat) this.listen();
	}
	onTool(cb: (t: ToolCall) => void) {
		this.toolCbs.push(cb);
		if (this.chat) this.listen();
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
		return r.ok ? ((await r.json()) as { name: string; root?: string }) : { name: "" };
	}
	log(msg: string) {
		console.log(msg);
	}
	onMenu() {}
}

export let shell: Shell = new HttpShell();

/**
 * Is this page inside the app's webview? The native bridge is what the
 * Wails runtime itself looks for: WKWebView's message handler on macOS,
 * Linux and iOS, WebView2's on Windows, the Android interface. (window._wails
 * is not a sign of anything: the runtime module creates it when it loads.)
 */
function inWails(): boolean {
	const w = window as unknown as {
		webkit?: { messageHandlers?: { external?: { postMessage?: unknown } } };
		chrome?: { webview?: { postMessage?: unknown } };
		wails?: { invoke?: unknown };
	};
	return !!(w.webkit?.messageHandlers?.external?.postMessage || w.chrome?.webview?.postMessage || w.wails?.invoke);
}

/** Pick the face for this environment. Called once, before anything else. */
export async function initShell(): Promise<Shell> {
	if (inWails()) {
		const m = await import("./wails.ts");
		shell = new m.WailsShell();
	}
	return shell;
}
