// Ask Claude: the conversation, one turn at a time, with Uranus as the
// tool it works through. The shell runs Claude Code; this keeps what was
// said and answers the tools (state/tools.ts).

import { signal, batch } from "@preact/signals";
import { shell, type ChatEvent, type ChatInfo } from "../shell/shell.ts";
import { project } from "./project.ts";

export interface Line {
	role: "user" | "claude" | "tool" | "note" | "error";
	text: string;
	name?: string;
}

export const chat = {
	open: signal(false),
	lines: signal<Line[]>([]),
	busy: signal(false),
	info: signal<ChatInfo>({ found: false, path: "", busy: false }),
	cost: signal(0),
	draft: signal(""),
};

let wired = false;

function push(line: Line) {
	chat.lines.value = [...chat.lines.value, line];
}

/** A line the editor adds itself (a change applied), so the transcript says what happened. */
export function chatNote(text: string) {
	push({ role: "note", text });
}

/** What Claude's tool use reads like to a person. */
function describeTool(name: string, input: string): string | null {
	let args: Record<string, unknown> = {};
	try {
		args = JSON.parse(input || "{}") as Record<string, unknown>;
	} catch {
		// a truncated input: describe by name
	}
	switch (name) {
		case "mcp__uranus__get_document":
			return "read the document";
		case "mcp__uranus__apply_document":
			return null; // the note says what changed
		case "mcp__uranus__render":
			return `looked at ${typeof args.clip === "string" ? `clip ${args.clip}${typeof args.t === "number" ? ` at ${args.t}s` : ""}` : typeof args.state === "string" ? `state ${args.state}` : "the canvas"}`;
		case "mcp__uranus__validate":
			return "validated";
		case "mcp__uranus__open_file":
			return `opened ${String(args.path ?? "")}`;
		case "ToolSearch":
			return null;
		case "Read":
			return `read ${String(args.file_path ?? "a file").split("/").slice(-2).join("/")}`;
		case "Glob":
		case "Grep":
			return "searched the project";
		default:
			return name.replace(/^mcp__uranus__/, "");
	}
}

function onEvent(e: ChatEvent) {
	switch (e.kind) {
		case "text":
			push({ role: "claude", text: e.text ?? "" });
			break;
		case "tool": {
			const d = describeTool(e.name ?? "", e.input ?? "");
			if (d) push({ role: "tool", text: d, name: e.name });
			break;
		}
		case "result": {
			// the final text is also the last assistant message: show it once
			const last = [...chat.lines.value].reverse().find((l) => l.role === "claude");
			if (e.text && (!last || last.text.trim() !== e.text.trim())) push({ role: "claude", text: e.text });
			if (e.cost) chat.cost.value += e.cost;
			break;
		}
		case "error":
			push({ role: "error", text: e.text ?? "something went wrong" });
			break;
		case "done":
			chat.busy.value = false;
			break;
	}
}

export function wireChat() {
	if (wired || !shell.chat) return;
	wired = true;
	shell.onChat(onEvent);
	void import("./tools.ts").then((m) => shell.onTool((t) => void m.handleTool(t)));
	void refreshChatInfo();
}

export async function refreshChatInfo() {
	if (!shell.chat) return;
	chat.info.value = await shell.chatStatus();
}

function absRoot(): string {
	return shell.kind === "http" ? project.servedRoot.value : (project.root.value ?? "");
}

export async function ask(text: string) {
	const t = text.trim();
	if (!t || chat.busy.value) return;
	wireChat();
	batch(() => {
		push({ role: "user", text: t });
		chat.busy.value = true;
		chat.draft.value = "";
	});
	try {
		await shell.chatAsk(absRoot(), t);
	} catch (e) {
		batch(() => {
			push({ role: "error", text: String(e) });
			chat.busy.value = false;
		});
	}
}

export async function stopChat() {
	await shell.chatStop();
}

/** Forget the conversation: the next ask starts a fresh session. */
export async function newChat() {
	await shell.chatReset(absRoot());
	batch(() => {
		chat.lines.value = [];
		chat.cost.value = 0;
	});
}

export function toggleChat() {
	chat.open.value = !chat.open.value;
	if (chat.open.value) wireChat();
}
