// Ask Claude: the inspector's Ask tab. What you type, what it did (through
// the editor: reads, changes, looks), what it said.

import { useEffect, useRef } from "preact/hooks";
import { marked } from "marked";
import { chat, ask, stopChat, newChat, toggleChat, onPlan, planLabel, modelLabel } from "../state/chat.ts";
import { shell } from "../shell/shell.ts";
import { ed } from "../state/editor.ts";
import { Button, Chip } from "./ur.tsx";

import { HelpButton } from "./Help.tsx";
import { BUTTONS } from "../state/help.ts";

export function ChatPanel() {
	if (!shell.chat || !chat.open.value) return null;
	const lines = chat.lines.value;
	const busy = chat.busy.value;
	const info = chat.info.value;
	const list = useRef<HTMLDivElement>(null);
	const box = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		list.current?.scrollTo({ top: list.current.scrollHeight });
	}, [lines.length, busy]);
	useEffect(() => {
		box.current?.focus();
	}, []);
	const send = () => void ask(chat.draft.value);
	return (
		<div class="chat">
			<div class="chat-hdr">
				<span class={`chat-dot ${busy ? "busy" : info.found ? "ok" : "off"}`} title={busy ? "Claude is working" : info.found ? "Claude Code is ready" : "Claude Code was not found"} />
				<span class="chat-scope" title="what Claude is looking at">
					{ed.path.value ? ed.path.value.replace(/\.fart$/, "") : "The project"}
				</span>
				{info.found && (
					<Chip
						title={
							onPlan()
								? `Signed in as ${info.email || "you"} (${planLabel()}). Turns count against the plan's usage; they are not billed.`
								: `Claude Code is using an API key${info.email ? ` (${info.email})` : ""}: turns are billed per token.`
						}
					>
						{planLabel()}
						{chat.model.value ? ` · ${modelLabel()}` : ""}
					</Chip>
				)}
				{chat.cost.value > 0 && (
					<Chip
						mono
						title={
							onPlan()
								? "What these turns would cost at API rates: included in the plan, shown as a gauge of how heavy they were"
								: "Billed to the API key so far, this conversation"
						}
					>
						{onPlan() ? "≈" : ""}${chat.cost.value.toFixed(2)}
						{onPlan() ? " incl." : ""}
					</Chip>
				)}
				<Button variant="toolbar" class="ur-btn-sm" icon="plus" title="New conversation" onClick={() => void newChat()} />
				<HelpButton topics={BUTTONS.ask} title="About Ask" />
			</div>
			<div class="chat-lines" ref={list}>
				{!info.found && (
					<div class="line error">
						Claude Code was not found on this machine. Install it, sign in once in a terminal, and reopen this panel.
					</div>
				)}
				{lines.length === 0 && info.found && (
					<div class="line note">
						{info.email ? `Signed in as ${info.email}${planLabel() ? ` · ${planLabel()}` : ""}. ` : ""}
						{onPlan() ? "Turns count against the plan, nothing is billed. " : ""}
						Claude works through the editor: it reads the open file, changes it as one undo step (⌘Z takes it back), and looks at
						the result. Try "make the left arm longer" or "add a blink clip that shuts the eyes for a frame".
					</div>
				)}
				{lines.map((l, i) =>
					l.role === "claude" ? (
						<div class="line claude" key={i} dangerouslySetInnerHTML={{ __html: marked.parse(l.text, { async: false }) as string }} />
					) : l.role === "user" ? (
						<div class="line user" key={i}>
							{l.text}
						</div>
					) : (
						<div class={`line ${l.role}`} key={i}>
							{l.role === "tool" ? "· " : ""}
							{l.text}
						</div>
					),
				)}
				{busy && <div class="line tool thinking">Thinking…</div>}
			</div>
			<div class="chat-input">
				<textarea
					ref={box}
					rows={2}
					placeholder={busy ? "Claude is working…" : "What should change?"}
					value={chat.draft.value}
					disabled={!info.found}
					onInput={(e) => (chat.draft.value = (e.target as HTMLTextAreaElement).value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							if (!busy) send();
						}
						if (e.key === "Escape") toggleChat();
					}}
				/>
				{busy ? (
					<Button title="Stop this turn" onClick={() => void stopChat()}>
						Stop
					</Button>
				) : (
					<Button variant="primary" disabled={!chat.draft.value.trim() || !info.found} onClick={send}>
						Ask
					</Button>
				)}
			</div>
		</div>
	);
}
