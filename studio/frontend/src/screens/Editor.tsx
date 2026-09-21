// The 2D editor's parts of the workspace: its lists for the sidebar, its
// tools for the floating bar, its canvas (or a palette's swatches), the
// timeline below when a clip is chosen. The frame is screens/Workspace.tsx.

import { I } from "../ui/Icons.tsx";
import { PaletteView } from "../ui/PaletteView.tsx";
import { Layers, addPartNow } from "../ui/Layers.tsx";
import { BottomBar, StatesList, ClipsList, addStateNow, addClipNow } from "../ui/BottomBar.tsx";
import { Canvas } from "../canvas/Canvas.tsx";
import { Tools, ToolButtons, type ToolSpec } from "../ui/Tools.tsx";
import { showIssues } from "../ui/ProjectBar.tsx";
import { ed, curState, curClip, addToken, freshName, type Tool } from "../state/editor.ts";
import { view } from "../canvas/view.ts";
import { run } from "../state/commands.ts";
import { renaming, type MenuItem } from "../state/menu.ts";

export const EDITOR_TOOLS: ToolSpec<Tool>[] = [
	{ tool: "select", label: "Select", key: "V", icon: I.select },
	{ tool: "rect", label: "Rect", key: "R", icon: I.rect },
	{ tool: "circle", label: "Circle", key: "O", icon: I.circle },
	{ tool: "line", label: "Line", key: "L", icon: I.line },
	{ tool: "poly", label: "Poly", key: "P", icon: I.poly },
];

/** The sidebar's Add menu for a 2D asset. */
export function editorAdd(): MenuItem[] {
	if (ed.isPalette.value) {
		return [
			{
				label: "Colour",
				run: () => {
					addToken(freshName("colour", ed.tokens.value.map((t) => t.name)));
					renaming.value = { kind: "token", index: ed.doc.value.palette?.length ? ed.doc.value.palette.length - 1 : 0 };
				},
			},
		];
	}
	return [
		{ label: "Layer", run: addPartNow },
		{ label: "State", run: () => addStateNow() },
		{ label: "Clip", run: addClipNow },
	];
}

export function EditorSidebar() {
	void ed.rev.value;
	if (ed.isPalette.value) return <div class="empty">a palette: colours other assets draw from · they are on the canvas</div>;
	return (
		<>
			<Layers />
			<StatesList />
			<ClipsList />
		</>
	);
}

function hintNow(): string {
	const st = curState();
	const clip = curClip();
	if (ed.collide.value) return "collision lens: shapes a game may treat as solid · C flips back";
	if (clip) return `previewing "${clip.name}" · Space plays · keys name states, pose those to change a key`;
	if (ed.pending.value === "pivot") return "click the canvas to place the pivot";
	if (ed.pending.value === "anchor") return "click the canvas to place the anchor";
	if (ed.tool.value === "poly") return "click to add points · click the first point or press Enter to close · Esc drops it";
	if (st) return `state "${st.name}" · shapes edit in place · drag the part's ⌖ to move it, its lever to turn it, a ring to reach`;
	return "";
}

export function EditorTools() {
	void ed.rev.value;
	if (ed.isPalette.value) return null;
	const posing = !!curClip();
	const collide = ed.collide.value;
	return (
		<Tools hint={hintNow()}>
			<ToolButtons tools={EDITOR_TOOLS} current={ed.tool.value} disabled={(t) => posing && t !== "select"} why="a clip is a preview; pick a state to edit" />
			<span class="sep" />
			<button class={`tool ${collide ? "active" : ""}`} title="the collision lens  (C)" onClick={() => run("view.collision")}>
				<I.collision />
				<span class="key">C</span>
			</button>
			<button class={`tool ${view.snapGrid.value ? "active" : ""}`} title="snap to grid  (⌘ ')" onClick={() => run("view.snapGrid")}>
				<I.grid />
			</button>
		</Tools>
	);
}

export function EditorCanvas() {
	void ed.rev.value;
	if (ed.isPalette.value) return <PaletteView />;
	const issues = ed.issues.value;
	return (
		<>
			<Canvas />
			{issues.length > 0 && showIssues.value && (
				<div class="issues">
					{issues.slice(0, 8).map((i) => (
						<div class={["unknown", "reserved", "unresolved"].includes(i.code) ? "w" : "e"}>
							{i.code} {i.path}: {i.message}
						</div>
					))}
					{issues.length > 8 && <div>… and {issues.length - 8} more</div>}
				</div>
			)}
		</>
	);
}

export const EditorBottom = BottomBar;
