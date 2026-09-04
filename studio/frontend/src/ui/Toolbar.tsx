import { signal } from "@preact/signals";
import { ed, curState, save, undo, redo, type Tool } from "../state/editor.ts";
import { project, goBrowse, goDocs } from "../state/project.ts";
import { basename } from "../state/paths.ts";
import { ThemeButton } from "./ThemeMenu.tsx";
import { ExplorerButton } from "./Explorer.tsx";

const addOpen = signal(false);
export const showIssues = signal(false);
const ADD: { tool: Tool; label: string; key: string }[] = [
	{ tool: "circle", label: "Circle", key: "2" },
	{ tool: "line", label: "Line", key: "3" },
	{ tool: "poly", label: "Poly", key: "4" },
	{ tool: "rect", label: "Rect", key: "5" },
];

export function Toolbar() {
	const tool = ed.tool.value;
	const adding = ADD.find((a) => a.tool === tool);
	const path = ed.path.value ?? "";
	const dirty = ed.dirty.value;
	const issues = ed.issues.value;
	const errors = issues.filter((i) => !["unknown", "reserved", "unresolved"].includes(i.code)).length;
	const posing = !!curState();
	return (
		<div class="topbar">
			<ExplorerButton />
			<div class="group" style="position:relative">
				<button
					class={`tool ${tool === "select" ? "active" : ""}`}
					onClick={() => {
						ed.tool.value = "select";
						addOpen.value = false;
					}}
				>
					Select <span class="key">1</span>
				</button>
				<button
					class={`tool ${adding ? "active" : ""}`}
					disabled={posing}
					title={posing ? "geometry is locked while posing" : ""}
					style={posing ? "opacity:.45" : ""}
					onClick={() => (addOpen.value = !addOpen.value)}
				>
					{adding ? adding.label : "+ Add"} <span class="key">▾</span>
				</button>
				{addOpen.value && (
					<div
						class="card"
						style="position:absolute;left:92px;top:34px;z-index:5;min-width:140px;padding:6px"
						onPointerLeave={() => (addOpen.value = false)}
					>
						{ADD.map((a) => (
							<div
								class={`row ${tool === a.tool ? "active" : ""}`}
								onClick={() => {
									ed.tool.value = a.tool;
									addOpen.value = false;
								}}
							>
								<span class="name">{a.label}</span>
								<span class="chip">{a.key}</span>
							</div>
						))}
					</div>
				)}
			</div>
			<span class="sep" />
			<button class={`btn ${dirty ? "" : "ghost"}`} title="Cmd+S" onClick={() => void save()}>
				Save
			</button>
			<button class="btn ghost" title="Cmd+Z" disabled={!ed.canUndo.value} onClick={undo}>
				Undo
			</button>
			<button class="btn ghost" title="Cmd+Shift+Z" disabled={!ed.canRedo.value} onClick={redo}>
				Redo
			</button>
			<span class="sep" />
			<button class="btn ghost" title="the shelf  (Cmd+O)" onClick={() => void goBrowse()}>
				Browse
			</button>
			<button
				class={`btn ${ed.collide.value ? "active" : "ghost"}`}
				title="the collision lens  (C)"
				onClick={() => {
					ed.collide.value = !ed.collide.value;
					ed.colSel.value = -1;
				}}
			>
				Collision
			</button>
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
			<span class="sub" title={path}>
				{dirty && <span class="dot" />}
				{project.name.value ? `${project.name.value} / ` : ""}
				{basename(path)}
			</span>
			<span class="sep" />
			<button class="btn ghost" title="the guide and the format  (?)" onClick={goDocs}>
				Docs
			</button>
			<ThemeButton />
		</div>
	);
}
