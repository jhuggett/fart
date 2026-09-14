// Every command, registered once. The keyboard (App), the menu bar (Go)
// and the command palette all run these by id.

import { register } from "./commands.ts";
import { ed, save, revertToCheckpoint, undo, redo, copySel, pasteClip, cutSel, dupSel, deleteSel, selOrder, selectAll, endGesture, curClip, curPart, addKey, type Tool } from "./editor.ts";
import { project, goBrowse, goWelcome, goDocs, pickFolder, newFile, newModel, toggleServe } from "./project.ts";
import { view, fitBounds, zoomBy } from "../canvas/view.ts";
import { escape, polyEnter, selBounds, nudgeWorld } from "../canvas/interact.ts";
import { toggleChat } from "./chat.ts";
import { toggleExplorer } from "./explorer.ts";
import { openPalette, renaming } from "./menu.ts";
import { ask } from "./prompt.ts";
import { shell } from "../shell/shell.ts";
import { docBounds } from "@fastart/core";
import * as M from "./model.ts";
import { escape as escape3, polyEnter as polyEnter3, nudgeView, frameBounds } from "../canvas/model3.ts";
import { askProject } from "../screens/Model.tsx";

const inEditor = () => project.screen.value === "edit";
const inModel = () => project.screen.value === "model";
const inAny = () => inEditor() || inModel();
const inProject = () => inAny() || project.screen.value === "browse";
const native = () => shell.kind === "wails";
const setup = () => (inEditor() && ed.curClip.value < 0 && !ed.isPalette.value) || (inModel() && M.md.curClip.value < 0);

let nudgeTimer: number | undefined;
function nudge(dx: number, dy: number) {
	if (inModel()) nudgeView([dx, dy]);
	else nudgeWorld([dx, dy]);
	// a burst of taps is one undo step; a pause ends it
	if (nudgeTimer !== undefined) clearTimeout(nudgeTimer);
	nudgeTimer = window.setTimeout(inModel() ? M.endGesture : endGesture, 600);
}

function tool(t: Tool) {
	if (inModel()) {
		M.md.tool.value = t;
		M.md.polyPts.value = [];
		return;
	}
	ed.tool.value = t;
	ed.polyPts.value = [];
}
/** The 2D editor's way or the model's, by screen. */
const either = (a: () => void, b: () => void) => () => (inModel() ? b() : a());

export function initCommands() {
	register(
		{ id: "tool.select", title: "Select", group: "Tools", when: setup, run: () => tool("select") },
		{ id: "tool.rect", title: "Rect tool", group: "Tools", when: setup, run: () => tool("rect") },
		{ id: "tool.circle", title: "Circle tool", group: "Tools", when: setup, run: () => tool("circle") },
		{ id: "tool.line", title: "Line tool", group: "Tools", when: setup, run: () => tool("line") },
		{ id: "tool.poly", title: "Poly tool", group: "Tools", when: setup, run: () => tool("poly") },

		{ id: "chat.toggle", title: "Ask Claude", group: "File", when: () => shell.chat && inProject(), run: toggleChat },
		{ id: "file.save", title: "Save (checkpoint)", group: "File", when: inAny, run: either(() => void save(), () => void M.save()) },
		{ id: "file.revert", title: "Revert to checkpoint", group: "File", when: () => (inEditor() && ed.dirty.value) || (inModel() && M.md.dirty.value), run: either(() => void revertToCheckpoint(), () => void M.revertToCheckpoint()) },
		{ id: "file.new", title: "New file…", group: "File", when: inProject, run: () => void ask("Name the new file").then((n) => { if (n) void newFile(n); }) },
		{ id: "file.newModel", title: "New 3D model…", group: "File", when: inProject, run: () => void ask("Name the new model").then((n) => { if (n) void newModel(n); }) },
		{ id: "model.project", title: "Project to 2D views…", group: "File", when: inModel, run: () => void askProject() },
		{ id: "file.browse", title: "Browse the shelf", group: "File", when: inAny, run: () => void goBrowse() },
		{ id: "file.openFolder", title: "Open folder…", group: "File", when: native, run: () => void pickFolder() },
		{ id: "file.projects", title: "Projects", group: "File", when: () => native() && inProject(), run: () => void goWelcome() },
		{ id: "file.serve", title: "Serve on the network", group: "File", when: () => native() && inProject(), run: () => void toggleServe() },

		{ id: "edit.undo", title: "Undo", group: "Edit", when: inAny, run: either(undo, M.undo) },
		{ id: "edit.redo", title: "Redo", group: "Edit", when: inAny, run: either(redo, M.redo) },
		{ id: "edit.copy", title: "Copy", group: "Edit", when: inEditor, run: copySel },
		{ id: "edit.paste", title: "Paste", group: "Edit", when: inEditor, run: pasteClip },
		{ id: "edit.cut", title: "Cut", group: "Edit", when: inEditor, run: cutSel },
		{ id: "edit.duplicate", title: "Duplicate", group: "Edit", when: inAny, run: either(dupSel, M.dupSel) },
		{ id: "model.mirror", title: "Mirror across x", group: "Edit", when: () => inModel() && !!M.md.sel.value, run: M.mirrorSel },
		{ id: "edit.delete", title: "Delete", group: "Edit", when: inAny, run: either(deleteSel, M.deleteSel) },
		{ id: "edit.selectAll", title: "Select all", group: "Edit", when: () => setup() && inEditor(), run: selectAll },
		{ id: "edit.raise", title: "Raise", group: "Edit", when: inEditor, run: () => selOrder(true) },
		{ id: "edit.lower", title: "Lower", group: "Edit", when: inEditor, run: () => selOrder(false) },
		{ id: "edit.escape", title: "Deselect / cancel", group: "Edit", when: inAny, run: either(escape, escape3) },
		{
			id: "edit.enter",
			title: "Close the polygon / rename the part",
			group: "Edit",
			when: inAny,
			run: either(
				() => {
					if (ed.polyPts.value.length >= 3) polyEnter();
					else if (curPart()) renaming.value = { kind: "part", index: ed.curPart.value };
				},
				() => {
					if (M.md.polyPts.value.length >= 3) polyEnter3();
					else if (M.curPart()) renaming.value = { kind: "part", index: M.md.curPart.value };
				},
			),
		},
		{ id: "edit.nudgeLeft", title: "Nudge left", group: "Edit", when: setup, run: () => nudge(-1, 0) },
		{ id: "edit.nudgeRight", title: "Nudge right", group: "Edit", when: setup, run: () => nudge(1, 0) },
		{ id: "edit.nudgeUp", title: "Nudge up", group: "Edit", when: setup, run: () => nudge(0, -1) },
		{ id: "edit.nudgeDown", title: "Nudge down", group: "Edit", when: setup, run: () => nudge(0, 1) },
		{ id: "edit.nudgeLeft10", title: "Nudge left ×10", group: "Edit", when: setup, run: () => nudge(-10, 0) },
		{ id: "edit.nudgeRight10", title: "Nudge right ×10", group: "Edit", when: setup, run: () => nudge(10, 0) },
		{ id: "edit.nudgeUp10", title: "Nudge up ×10", group: "Edit", when: setup, run: () => nudge(0, -10) },
		{ id: "edit.nudgeDown10", title: "Nudge down ×10", group: "Edit", when: setup, run: () => nudge(0, 10) },

		{ id: "view.zoomIn", title: "Zoom in", group: "View", when: inAny, run: () => zoomBy(1.25) },
		{ id: "view.zoomOut", title: "Zoom out", group: "View", when: inAny, run: () => zoomBy(1 / 1.25) },
		{ id: "view.zoom100", title: "Actual size", group: "View", when: inAny, run: () => (view.zoom.value = 10) },
		{ id: "view.front", title: "View: front", group: "View", when: inModel, run: () => M.setView("front") },
		{ id: "view.back", title: "View: back", group: "View", when: inModel, run: () => M.setView("back") },
		{ id: "view.left", title: "View: left", group: "View", when: inModel, run: () => M.setView("left") },
		{ id: "view.right", title: "View: right", group: "View", when: inModel, run: () => M.setView("right") },
		{ id: "view.top", title: "View: top", group: "View", when: inModel, run: () => M.setView("top") },
		{ id: "view.bottom", title: "View: bottom", group: "View", when: inModel, run: () => M.setView("bottom") },
		{ id: "model.outline", title: "Silhouettes", group: "View", when: inModel, run: () => (M.md.outline.value = !M.md.outline.value) },
		{
			id: "view.fit",
			title: "Zoom to fit",
			group: "View",
			when: inAny,
			run: () => {
				const b = inModel() ? frameBounds() : docBounds(ed.doc.value);
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
		{ id: "view.snapGrid", title: "Snap to grid", group: "View", when: inAny, run: () => (view.snapGrid.value = !view.snapGrid.value) },
		{
			id: "view.collision",
			title: "Collision lens",
			group: "View",
			when: () => setup() || inModel(),
			run: either(
				() => {
					ed.collide.value = !ed.collide.value;
					ed.colSel.value = -1;
				},
				() => (M.md.collide.value = !M.md.collide.value),
			),
		},
		{ id: "view.explorer", title: "Explorer", group: "View", when: inProject, run: toggleExplorer },

		{ id: "clip.play", title: "Play / pause", group: "Clip", when: () => (inEditor() && !!curClip()) || (inModel() && !!M.curClip()), run: either(() => (ed.playing.value = !ed.playing.value), () => (M.md.playing.value = !M.md.playing.value)) },
		{ id: "clip.addKey", title: "Add a key at the playhead", group: "Clip", when: () => (inEditor() && !!curClip()) || (inModel() && !!M.curClip()), run: either(addKey, M.addKey) },

		{ id: "app.palette", title: "Command palette", group: "App", run: openPalette },
		{ id: "app.docs", title: "Docs: the guide", group: "App", run: () => goDocs("guide") },
		{ id: "app.docsFormat", title: "Docs: the format", group: "App", run: () => goDocs("format") },
	);
}
