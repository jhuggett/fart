// Every command, registered once. The keyboard (App), the menu bar (Go)
// and the command palette all run these by id.

import { register } from "./commands.ts";
import { ed, save, undo, redo, copySel, pasteClip, cutSel, dupSel, deleteSel, selOrder, selectAll, endGesture, curClip, curPart, addKey, type Tool } from "./editor.ts";
import { project, goBrowse, goWelcome, goDocs, pickFolder, newFile, toggleServe } from "./project.ts";
import { view, fitBounds, zoomBy } from "../canvas/view.ts";
import { escape, polyEnter, selBounds, nudgeWorld } from "../canvas/interact.ts";
import { toggleExplorer } from "./explorer.ts";
import { openPalette, renaming } from "./menu.ts";
import { ask } from "./prompt.ts";
import { shell } from "../shell/shell.ts";
import { docBounds } from "@fastart/core";

const inEditor = () => project.screen.value === "edit";
const inProject = () => project.screen.value === "edit" || project.screen.value === "browse";
const native = () => shell.kind === "wails";
const setup = () => inEditor() && ed.curClip.value < 0;

let nudgeTimer: number | undefined;
function nudge(dx: number, dy: number) {
	nudgeWorld([dx, dy]);
	// a burst of taps is one undo step; a pause ends it
	if (nudgeTimer !== undefined) clearTimeout(nudgeTimer);
	nudgeTimer = window.setTimeout(endGesture, 600);
}

function tool(t: Tool) {
	ed.tool.value = t;
	ed.polyPts.value = [];
}

export function initCommands() {
	register(
		{ id: "tool.select", title: "Select", group: "Tools", when: inEditor, run: () => tool("select") },
		{ id: "tool.rect", title: "Rect tool", group: "Tools", when: setup, run: () => tool("rect") },
		{ id: "tool.circle", title: "Circle tool", group: "Tools", when: setup, run: () => tool("circle") },
		{ id: "tool.line", title: "Line tool", group: "Tools", when: setup, run: () => tool("line") },
		{ id: "tool.poly", title: "Poly tool", group: "Tools", when: setup, run: () => tool("poly") },

		{ id: "file.save", title: "Save", group: "File", when: inEditor, run: () => void save() },
		{ id: "file.new", title: "New file…", group: "File", when: inProject, run: () => void ask("Name the new file").then((n) => { if (n) void newFile(n); }) },
		{ id: "file.browse", title: "Browse the shelf", group: "File", when: inEditor, run: () => void goBrowse() },
		{ id: "file.openFolder", title: "Open folder…", group: "File", when: native, run: () => void pickFolder() },
		{ id: "file.projects", title: "Projects", group: "File", when: () => native() && inProject(), run: () => void goWelcome() },
		{ id: "file.serve", title: "Serve on the network", group: "File", when: () => native() && inProject(), run: () => void toggleServe() },

		{ id: "edit.undo", title: "Undo", group: "Edit", when: inEditor, run: undo },
		{ id: "edit.redo", title: "Redo", group: "Edit", when: inEditor, run: redo },
		{ id: "edit.copy", title: "Copy", group: "Edit", when: inEditor, run: copySel },
		{ id: "edit.paste", title: "Paste", group: "Edit", when: inEditor, run: pasteClip },
		{ id: "edit.cut", title: "Cut", group: "Edit", when: inEditor, run: cutSel },
		{ id: "edit.duplicate", title: "Duplicate", group: "Edit", when: inEditor, run: dupSel },
		{ id: "edit.delete", title: "Delete", group: "Edit", when: inEditor, run: deleteSel },
		{ id: "edit.selectAll", title: "Select all", group: "Edit", when: setup, run: selectAll },
		{ id: "edit.raise", title: "Raise", group: "Edit", when: inEditor, run: () => selOrder(true) },
		{ id: "edit.lower", title: "Lower", group: "Edit", when: inEditor, run: () => selOrder(false) },
		{ id: "edit.escape", title: "Deselect / cancel", group: "Edit", when: inEditor, run: escape },
		{
			id: "edit.enter",
			title: "Close the polygon / rename the part",
			group: "Edit",
			when: inEditor,
			run: () => {
				if (ed.polyPts.value.length >= 3) polyEnter();
				else if (curPart()) renaming.value = { kind: "part", index: ed.curPart.value };
			},
		},
		{ id: "edit.nudgeLeft", title: "Nudge left", group: "Edit", when: setup, run: () => nudge(-1, 0) },
		{ id: "edit.nudgeRight", title: "Nudge right", group: "Edit", when: setup, run: () => nudge(1, 0) },
		{ id: "edit.nudgeUp", title: "Nudge up", group: "Edit", when: setup, run: () => nudge(0, -1) },
		{ id: "edit.nudgeDown", title: "Nudge down", group: "Edit", when: setup, run: () => nudge(0, 1) },
		{ id: "edit.nudgeLeft10", title: "Nudge left ×10", group: "Edit", when: setup, run: () => nudge(-10, 0) },
		{ id: "edit.nudgeRight10", title: "Nudge right ×10", group: "Edit", when: setup, run: () => nudge(10, 0) },
		{ id: "edit.nudgeUp10", title: "Nudge up ×10", group: "Edit", when: setup, run: () => nudge(0, -10) },
		{ id: "edit.nudgeDown10", title: "Nudge down ×10", group: "Edit", when: setup, run: () => nudge(0, 10) },

		{ id: "view.zoomIn", title: "Zoom in", group: "View", when: inEditor, run: () => zoomBy(1.25) },
		{ id: "view.zoomOut", title: "Zoom out", group: "View", when: inEditor, run: () => zoomBy(1 / 1.25) },
		{ id: "view.zoom100", title: "Actual size", group: "View", when: inEditor, run: () => (view.zoom.value = 10) },
		{
			id: "view.fit",
			title: "Zoom to fit",
			group: "View",
			when: inEditor,
			run: () => {
				const b = docBounds(ed.doc.value);
				if (b) fitBounds(b.lo, b.hi);
				else {
					view.pan.value = [0, 0];
					view.zoom.value = 10;
				}
			},
		},
		{
			id: "view.fitSelection",
			title: "Zoom to selection",
			group: "View",
			when: () => inEditor() && ed.sel.value.length > 0,
			run: () => {
				const b = selBounds();
				if (b) fitBounds(b.lo, b.hi);
			},
		},
		{ id: "view.snapGrid", title: "Snap to grid", group: "View", when: inEditor, run: () => (view.snapGrid.value = !view.snapGrid.value) },
		{
			id: "view.collision",
			title: "Collision lens",
			group: "View",
			when: inEditor,
			run: () => {
				ed.collide.value = !ed.collide.value;
				ed.colSel.value = -1;
			},
		},
		{ id: "view.explorer", title: "Explorer", group: "View", when: inProject, run: toggleExplorer },

		{ id: "clip.play", title: "Play / pause", group: "Clip", when: () => inEditor() && !!curClip(), run: () => (ed.playing.value = !ed.playing.value) },
		{ id: "clip.addKey", title: "Add a key at the playhead", group: "Clip", when: () => inEditor() && !!curClip(), run: addKey },

		{ id: "app.palette", title: "Command palette", group: "App", run: openPalette },
		{ id: "app.docs", title: "Docs: the guide", group: "App", run: () => goDocs("guide") },
		{ id: "app.docsFormat", title: "Docs: the format", group: "App", run: () => goDocs("format") },
	);
}
