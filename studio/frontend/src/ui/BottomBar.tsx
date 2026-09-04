// States and clips as lists in the sidebar, the way Rive and Spine list
// animations; the bottom of the canvas keeps only the timeline. There is
// always a state on the canvas; a new one starts as a copy of it.

import { I } from "./Icons.tsx";
import { InlineName } from "./Rename.tsx";
import { Timeline } from "./Timeline.tsx";
import { ed, states, clips, curClip, addState, deleteState, renameState, addClip, deleteClip, renameClip, selectClip, selectState, freshName } from "../state/editor.ts";
import { renaming, openContextMenu } from "../state/menu.ts";
import { project } from "../state/project.ts";

export function addStateNow(from?: number) {
	const src = states()[from ?? ed.curState.value];
	const base = src ? src.name : "state";
	addState(freshName(base, states().map((s) => s.name)), from);
	renaming.value = { kind: "state", index: ed.curState.value };
}

export function addClipNow() {
	if (!addClip(freshName("clip", clips().map((c) => c.name)))) {
		project.error.value = "a clip is states in time: make a state first";
		return;
	}
	renaming.value = { kind: "clip", index: ed.curClip.value };
}

export function StatesList() {
	void ed.rev.value;
	const sts = states();
	const curS = ed.curState.value;
	const curC = ed.curClip.value;
	const ren = renaming.value;
	return (
		<>
			<div class="hdr" title="every view is a state: which parts show, where each sits, in what order. Shapes are edited in whichever state you are looking at.">
				States
			</div>
			{sts.map((s, k) => (
				<div
					class={`row ${k === curS && curC < 0 ? "active" : ""}`}
					onClick={() => selectState(k)}
					onDblClick={() => (renaming.value = { kind: "state", index: k })}
					onContextMenu={(e) => {
						e.preventDefault();
						openContextMenu(e.clientX, e.clientY, [
							{ label: "Rename", run: () => (renaming.value = { kind: "state", index: k }) },
							{ label: "Duplicate", run: () => addStateNow(k) },
							{ label: "Delete state", danger: true, disabled: sts.length <= 1, sep: true, run: () => deleteState(k) },
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
					{k === curS && sts.length > 1 && (
						<span class="tail">
							<button class="btn x" title="delete state" onClick={(e) => (e.stopPropagation(), deleteState(k))}>
								×
							</button>
						</span>
					)}
				</div>
			))}
			<button class="add-row" onClick={() => addStateNow()} title="a new state, starting as a copy of this one">
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
