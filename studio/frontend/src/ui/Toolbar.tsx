import { I } from "./Icons.tsx";
import { ed, curClip, save, type Tool } from "../state/editor.ts";
import { project, goDocs, goBrowse } from "../state/project.ts";
import { view } from "../canvas/view.ts";
import { basename } from "../state/paths.ts";
import { ThemeButton } from "./ThemeMenu.tsx";
import { ExplorerButton } from "./Explorer.tsx";
import { run } from "../state/commands.ts";
import { signal } from "@preact/signals";
import { shell } from "../shell/shell.ts";
import { chat, toggleChat } from "../state/chat.ts";

export const showIssues = signal(false);

const TOOLS: { tool: Tool; label: string; key: string; icon: (p: { size?: number }) => preact.JSX.Element }[] = [
	{ tool: "select", label: "Select", key: "V", icon: I.select },
	{ tool: "rect", label: "Rect", key: "R", icon: I.rect },
	{ tool: "circle", label: "Circle", key: "O", icon: I.circle },
	{ tool: "line", label: "Line", key: "L", icon: I.line },
	{ tool: "poly", label: "Poly", key: "P", icon: I.poly },
];

export function Toolbar() {
	const tool = ed.tool.value;
	const path = ed.path.value ?? "";
	const dirty = ed.dirty.value;
	const written = ed.written.value;
	const ckAt = ed.checkpointAt.value;
	const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
	const issues = ed.issues.value;
	const errors = issues.filter((i) => !["unknown", "reserved", "unresolved"].includes(i.code)).length;
	const pal = ed.isPalette.value;
	const posing = !!curClip() || pal;
	const collide = ed.collide.value;
	return (
		<div class="topbar">
			<ExplorerButton />
			<div class="group">
				{TOOLS.map((t) => (
					<button
						class={`tool ${tool === t.tool ? "active" : ""}`}
						disabled={pal || (posing && t.tool !== "select")}
						title={pal ? "a palette has no shapes" : posing && t.tool !== "select" ? "a clip is a preview; pick a state to edit" : `${t.label}  (${t.key})`}
						onClick={() => run(`tool.${t.tool}`)}
					>
						<t.icon />
						<span class="lbl">{t.label}</span>
						<span class="key">{t.key}</span>
					</button>
				))}
			</div>
			<span class="sep" />
			<button class={`btn ${collide ? "active" : "ghost"}`} disabled={pal} title="the collision lens  (C)" onClick={() => run("view.collision")}>
				<I.collision /> Collision
			</button>
			<button class={`btn ghost ${view.snapGrid.value ? "active" : ""}`} disabled={pal} title="snap to grid  (⌘ ')" onClick={() => run("view.snapGrid")}>
				<I.grid />
			</button>
			<span class="sep" />
			<button
				class={`btn ${dirty ? "" : "ghost"}`}
				title={`Save keeps this version as the checkpoint to revert to  (⌘ S)${ckAt ? ` · last ${clock(ckAt)}` : ""}${dirty ? " · changed since the checkpoint" : ""}`}
				onClick={() => void save()}
			>
				Save{dirty ? " •" : ""}
			</button>
			{path && (
				<span class="sub" title="every edit lands in the file itself within a moment; this is the last write">
					{written ? `on disk ${clock(written)}` : "on disk"}
				</span>
			)}
			{shell.chat && (
				<button class={`btn ghost ${chat.open.value ? "active" : ""}`} title="ask Claude to change this file  (⌘ J)" onClick={toggleChat}>
					Ask
				</button>
			)}
			<div class="spacer" />
			{issues.length > 0 && (
				<button
					class={`btn small ${showIssues.value ? "active" : "ghost"}`}
					style={errors ? "color:var(--danger)" : ""}
					title={errors ? "problems the format refuses; the file opened anyway" : "notes: fields this version does not know, and the like"}
					onClick={() => (showIssues.value = !showIssues.value)}
				>
					{errors ? `${errors} problem${errors === 1 ? "" : "s"}` : `${issues.length} note${issues.length === 1 ? "" : "s"}`}
				</button>
			)}
			<span class="sub crumb" title={path}>
				{dirty && <span class="dot" />}
				<button class="link" title="back to the shelf  (⌘ O)" onClick={() => void goBrowse()}>
					{project.name.value || "shelf"}
				</button>
				<span class="slash">/</span>
				{basename(path)}
			</span>
			<span class="sep" />
			<button class="btn ghost" title="the guide and the format  (?)" onClick={() => goDocs("guide")}>
				Docs
			</button>
			<ThemeButton />
		</div>
	);
}
