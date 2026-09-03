import { signal } from "@preact/signals";
import { ed, curState, save, undo, redo, type Tool } from "../state/editor.ts";
import { project, goBrowse, goDocs } from "../state/project.ts";
import { basename } from "../state/paths.ts";

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
	const posing = !!curState();
	return (
		<div class="topbar">
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
			<button class={`btn ${dirty ? "" : "ghost"}`} onClick={() => void save()}>
				Save
			</button>
			<button class="btn ghost" disabled={!ed.canUndo.value} onClick={undo}>
				Undo
			</button>
			<button class="btn ghost" disabled={!ed.canRedo.value} onClick={redo}>
				Redo
			</button>
			<button class="btn ghost" onClick={() => void goBrowse()}>
				Browse
			</button>
			<button
				class={`btn ${ed.collide.value ? "active" : "ghost"}`}
				onClick={() => {
					ed.collide.value = !ed.collide.value;
					ed.colSel.value = -1;
				}}
			>
				Collision
			</button>
			<button class="btn ghost" onClick={goDocs}>
				Docs
			</button>
			<div class="spacer" />
			{issues.length > 0 && (
				<button class={`btn small ${showIssues.value ? "active" : "ghost"}`} onClick={() => (showIssues.value = !showIssues.value)}>
					{issues.length} note{issues.length === 1 ? "" : "s"}
				</button>
			)}
			<span class="sub" title={path}>
				{dirty && <span class="dot" />}
				{project.name.value ? `${project.name.value} / ` : ""}
				{basename(path)}
			</span>
		</div>
	);
}
