// States and clips as lists in the sidebar, the way Rive and Spine list
// animations; the bottom of the canvas keeps only the timeline. There is
// always a state on the canvas; a new one starts as a copy of it.

import { InlineName } from "./Rename.tsx";
import { Timeline } from "./Timeline.tsx";
import { ed, states, clips, curClip, addState, deleteState, renameState, addClip, deleteClip, renameClip, selectClip, selectState, freshName } from "../state/editor.ts";
import { renaming, menuAt } from "../state/menu.ts";
import { GroupHeader, SidebarRow } from "./ur.tsx";
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
			<GroupHeader title="Every view is a state: which parts show, where each sits, in what order. Shapes are edited in whichever state you are looking at." onAdd={() => addStateNow()} addLabel="New state, starting as a copy of this one">
				States
			</GroupHeader>
			{sts.map((s, k) => {
				const remove = sts.length > 1 ? () => deleteState(k) : undefined;
				return (
					<SidebarRow
						key={s.name}
						icon="circle-dot"
						selected={k === curS && curC < 0}
						label={
							ren?.kind === "state" && ren.index === k ? (
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
							)
						}
						onClick={() => selectState(k)}
						onDoubleClick={() => (renaming.value = { kind: "state", index: k })}
						onContextMenu={(e) =>
							menuAt(e, [
								{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "state", index: k }) },
								{ label: "Duplicate", run: () => addStateNow(k) },
								{ label: "Delete state", danger: true, disabled: sts.length <= 1, sep: true, run: () => deleteState(k) },
							])
						}
						onDelete={remove}
					/>
				);
			})}
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
			<GroupHeader title="Animation: states in time" onAdd={addClipNow} disabled={sts.length === 0} addLabel={sts.length ? "New clip: states in time" : "Make a state first"}>
				Clips
			</GroupHeader>
			{cs.map((c, k) => (
				<SidebarRow
					key={c.name}
					icon="film"
					selected={k === curC}
					chip={`${c.keys.length} key${c.keys.length === 1 ? "" : "s"}${c.loop ? " · loop" : ""}`}
					label={
						ren?.kind === "clip" && ren.index === k ? (
							<InlineName
								value={c.name}
								onCommit={(n) => {
									renameClip(k, n);
									renaming.value = null;
								}}
								onCancel={() => (renaming.value = null)}
							/>
						) : (
							c.name
						)
					}
					onClick={() => selectClip(k)}
					onDoubleClick={() => (renaming.value = { kind: "clip", index: k })}
					onContextMenu={(e) =>
						menuAt(e, [
							{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "clip", index: k }) },
							{ label: "Delete clip", danger: true, sep: true, run: () => deleteClip(k) },
						])
					}
					onDelete={() => deleteClip(k)}
				/>
			))}
		</>
	);
}

/** Under the canvas: the timeline, when a clip is chosen. */
export function BottomBar() {
	void ed.rev.value;
	return curClip() ? (
		<div class="bottom ed-bottom">
			<Timeline />
		</div>
	) : null;
}
