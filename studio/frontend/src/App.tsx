import { useEffect } from "preact/hooks";
import { project, goBrowse, pickFolder, leaveDocs, goDocs } from "./state/project.ts";
import { ed, save, undo, redo, deleteSel, copySel, pasteClip, cutSel, dupSel, selOrder, curClip, type Tool } from "./state/editor.ts";
import { escape, polyEnter } from "./canvas/interact.ts";
import { prompt } from "./state/prompt.ts";
import { toggleExplorer } from "./state/explorer.ts";
import { shell } from "./shell/shell.ts";
import { Welcome } from "./screens/Welcome.tsx";
import { Browse } from "./screens/Browse.tsx";
import { Editor } from "./screens/Editor.tsx";
import { Docs } from "./screens/Docs.tsx";
import { Prompt } from "./ui/Prompt.tsx";

const TOOL_KEYS: Record<string, Tool> = { "1": "select", "2": "circle", "3": "line", "4": "poly", "5": "rect" };

function onKey(e: KeyboardEvent) {
	if (prompt.open.value) return;
	const t = e.target as HTMLElement | null;
	if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && e.key !== "Escape") return;
	const cmd = e.metaKey || e.ctrlKey;
	const screen = project.screen.value;
	const k = e.key;

	if (screen === "docs" && k === "Escape") return leaveDocs();
	if (k === "?" && screen !== "docs") return goDocs();
	if (cmd && k.toLowerCase() === "b" && (screen === "edit" || screen === "browse")) {
		e.preventDefault();
		return toggleExplorer();
	}

	if (screen !== "edit") {
		if (cmd && k.toLowerCase() === "o" && shell.kind === "wails") {
			e.preventDefault();
			void pickFolder();
		}
		return;
	}

	// the editor
	if (cmd) {
		switch (k.toLowerCase()) {
			case "s":
				e.preventDefault();
				return void save();
			case "z":
				e.preventDefault();
				return e.shiftKey ? redo() : undo();
			case "y":
				e.preventDefault();
				return redo();
			case "o":
				e.preventDefault();
				return e.shiftKey ? void pickFolder() : void goBrowse();
			case "c":
				e.preventDefault();
				return copySel();
			case "v":
				e.preventDefault();
				return pasteClip();
			case "x":
				e.preventDefault();
				return cutSel();
			case "d":
				e.preventDefault();
				return dupSel();
		}
		return;
	}
	if (TOOL_KEYS[k]) {
		ed.tool.value = TOOL_KEYS[k];
		return;
	}
	if (curClip() && k === " ") {
		e.preventDefault();
		ed.playing.value = !ed.playing.value;
		return;
	}
	switch (k) {
		case "x":
		case "X":
		case "Delete":
		case "Backspace":
			e.preventDefault();
			return deleteSel();
		case "c":
		case "C":
			ed.collide.value = !ed.collide.value;
			ed.colSel.value = -1;
			return;
		case "[":
			return selOrder(false);
		case "]":
			return selOrder(true);
		case "Escape":
			return escape();
		case "Enter":
			return polyEnter();
	}
}

export function App() {
	useEffect(() => {
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	const screen = project.screen.value;
	const err = project.error.value;
	return (
		<>
			{screen === "welcome" && <Welcome />}
			{screen === "browse" && <Browse />}
			{screen === "edit" && <Editor />}
			{screen === "docs" && <Docs />}
			<Prompt />
			{err && (
				<div class="toast" onClick={() => (project.error.value = null)}>
					{err}
				</div>
			)}
		</>
	);
}
