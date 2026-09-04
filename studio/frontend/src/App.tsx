import { useEffect } from "preact/hooks";
import { project, leaveDocs } from "./state/project.ts";
import { curClip } from "./state/editor.ts";
import { ix } from "./canvas/interact.ts";
import { prompt } from "./state/prompt.ts";
import { palette } from "./state/menu.ts";
import { KEYMAP, keyOf, run } from "./state/commands.ts";
import { initCommands } from "./state/actions.ts";
import { shell } from "./shell/shell.ts";
import { Welcome } from "./screens/Welcome.tsx";
import { Browse } from "./screens/Browse.tsx";
import { Editor } from "./screens/Editor.tsx";
import { Docs } from "./screens/Docs.tsx";
import { Prompt, Confirm } from "./ui/Prompt.tsx";
import { ContextMenu } from "./ui/ContextMenu.tsx";
import { CommandPalette } from "./ui/CommandPalette.tsx";

initCommands();

function typing(e: KeyboardEvent): boolean {
	const t = e.target as HTMLElement | null;
	return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function onKey(e: KeyboardEvent) {
	if (prompt.open.value || palette.open.value) return;
	if (typing(e) && e.key !== "Escape") return;
	const screen = project.screen.value;
	if (screen === "docs" && e.key === "Escape") return leaveDocs();
	const k = keyOf(e);
	// the space bar: play a clip, or hold to pan
	if (k === "space") {
		if (typing(e)) return;
		e.preventDefault();
		if (screen === "edit" && curClip()) run("clip.play");
		else if (screen === "edit") ix.space = true;
		return;
	}
	const id = KEYMAP[k];
	if (!id) return;
	if (run(id)) e.preventDefault();
}

function onKeyUp(e: KeyboardEvent) {
	if (e.code === "Space") ix.space = false;
}

export function App() {
	useEffect(() => {
		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onKeyUp);
		shell.onMenu((id) => void run(id));
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("keyup", onKeyUp);
		};
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
			<Confirm />
			<ContextMenu />
			<CommandPalette />
			{err && (
				<div class="toast" onClick={() => (project.error.value = null)}>
					{err}
				</div>
			)}
		</>
	);
}
