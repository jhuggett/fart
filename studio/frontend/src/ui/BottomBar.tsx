// States and clips as lists in the sidebar, the way Rive and Spine list
// animations; the bottom of the canvas keeps only the timeline. The
// first row under States is the drawing itself: not a state, the thing
// the states arrange.

import { I } from "./Icons.tsx";
import { InlineName } from "./Rename.tsx";
import { Timeline } from "./Timeline.tsx";
import { ed, states, clips, curClip, addState, deleteState, renameState, addClip, deleteClip, renameClip, selectClip, freshName } from "../state/editor.ts";
import { renaming, openContextMenu } from "../state/menu.ts";
import { project } from "../state/project.ts";

export function addStateNow() {
	addState(freshName("state", states().map((s) => s.name)));
	renaming.value = { kind: "state", index: ed.curState.value };
}

export function addClipNow() {
	if (!addClip(freshName("clip", clips().map((c) => c.name)))) {
		project.error.value = "a clip is states in time: make a state first";
		return;
	}
	renaming.value = { kind: "clip", index: ed.curClip.value };
}

function goDraw() {
	selectClip(-1);
	ed.curState.value = -1;
	ed.sel.value = [];
}

export function StatesList() {
	void ed.rev.value;
	const sts = states();
	const curS = ed.curState.value;
	const curC = ed.curClip.value;
	const ren = renaming.value;
	const drawing = curS < 0 && curC < 0;
	return (
		<>
			<div class="hdr" title="arrangements of the drawing: which parts show, where each sits, in what order">
				States
			</div>
			<div class={`row mode ${drawing ? "active" : ""}`} onClick={goDraw} title="the drawing itself: add and reshape shapes and parts here. Not a state; the states below arrange it.">
				<I.select size={11} />
				<span class="name">the drawing</span>
			</div>
			{sts.map((s, k) => (
				<div
					class={`row ${k === curS ? "active" : ""}`}
					onClick={() => {
						selectClip(-1);
						ed.curState.value = k;
						ed.sel.value = [];
					}}
					onDblClick={() => (renaming.value = { kind: "state", index: k })}
					onContextMenu={(e) => {
						e.preventDefault();
						openContextMenu(e.clientX, e.clientY, [
							{ label: "Rename", run: () => (renaming.value = { kind: "state", index: k }) },
							{ label: "Delete state", danger: true, run: () => deleteState(k) },
						]);
					}}
				>
					{ren?.kind === "state" && ren.index === k ? (
						<InlineName
							value={s.name}
							onCommit={(n) => {
								renameState(k, n);
								renaming.value = null;
							}}
							onCancel={() => (renaming.value = null)}
						/>
					) : (
						<span class="name">{s.name}</span>
					)}
					{k === curS && (
						<span class="tail">
							<button class="btn x" title="delete state" onClick={(e) => (e.stopPropagation(), deleteState(k))}>
								×
							</button>
						</span>
					)}
				</div>
			))}
			<button class="add-row" onClick={addStateNow} title="a new arrangement of the drawing">
				<I.plus size={11} /> state
			</button>
		</>
	);
}

export function ClipsList() {
	void ed.rev.value;
	const cs = clips();
	const sts = states();
	const curC = ed.curClip.value;
	const ren = renaming.value;
	return (
		<>
			<div class="hdr" title="animation: states in time">
				Clips
			</div>
			{cs.map((c, k) => (
				<div
					class={`row ${k === curC ? "active" : ""}`}
					onClick={() => selectClip(k)}
					onDblClick={() => (renaming.value = { kind: "clip", index: k })}
					onContextMenu={(e) => {
						e.preventDefault();
						openContextMenu(e.clientX, e.clientY, [
							{ label: "Rename", run: () => (renaming.value = { kind: "clip", index: k }) },
							{ label: "Delete clip", danger: true, run: () => deleteClip(k) },
						]);
					}}
				>
					{ren?.kind === "clip" && ren.index === k ? (
						<InlineName
							value={c.name}
							onCommit={(n) => {
								renameClip(k, n);
								renaming.value = null;
							}}
							onCancel={() => (renaming.value = null)}
						/>
					) : (
						<span class="name">{c.name}</span>
					)}
					<span class="chip">
						{c.keys.length} key{c.keys.length === 1 ? "" : "s"}
						{c.loop ? " · loop" : ""}
					</span>
					{k === curC && (
						<span class="tail">
							<button class="btn x" title="delete clip" onClick={(e) => (e.stopPropagation(), deleteClip(k))}>
								×
							</button>
						</span>
					)}
				</div>
			))}
			<button class="add-row" onClick={addClipNow} disabled={sts.length === 0} title={sts.length ? "states in time" : "make a state first"}>
				<I.plus size={11} /> clip
			</button>
		</>
	);
}

/** Under the canvas: the timeline, when a clip is chosen. */
export function BottomBar() {
	void ed.rev.value;
	return curClip() ? (
		<div class="bottom">
			<Timeline />
		</div>
	) : null;
}
