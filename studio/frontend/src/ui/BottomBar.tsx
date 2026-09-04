// The bottom strip: states and clips as chips. "setup" is every part at
// rest with geometry editable; a state is a pose; a clip brings the
// timeline up beneath.

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

export function BottomBar() {
	void ed.rev.value;
	const sts = states();
	const cs = clips();
	const curS = ed.curState.value;
	const curC = ed.curClip.value;
	const ren = renaming.value;
	const setup = curS < 0 && curC < 0;
	return (
		<div class="bottom">
			<div class="strip">
				<button
					class={`chip mode ${setup ? "active" : ""}`}
					onClick={() => {
						selectClip(-1);
						ed.curState.value = -1;
						ed.sel.value = [];
					}}
					title="the drawing itself: add and reshape shapes and parts here. Not a state; the states below are arrangements of this drawing."
				>
					<I.select size={11} /> draw
				</button>
				<span class="sep" />
				<span class="hdr inline" title="arrangements of the drawing: which parts show, where each sits, in what order">
					States
				</span>
				{sts.map((s, k) => (
					<button
						class={`chip ${k === curS ? "active" : ""}`}
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
							s.name
						)}
					</button>
				))}
				<button class="chip add" onClick={addStateNow} title="a new pose of the parts">
					<I.plus size={10} /> state
				</button>
				<span class="sep" />
				<span class="hdr inline" title="animation: states in time">
					Clips
				</span>
				{cs.map((c, k) => (
					<button
						class={`chip ${k === curC ? "active" : ""}`}
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
							<>
								{c.name}
								{c.loop && <span class="chip" style="margin-left:4px">loop</span>}
							</>
						)}
					</button>
				))}
				<button class="chip add" onClick={addClipNow} disabled={sts.length === 0} title={sts.length ? "states in time" : "make a state first"}>
					<I.plus size={10} /> clip
				</button>
			</div>
			{curClip() && <Timeline />}
		</div>
	);
}
