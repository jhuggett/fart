// The parts of the open file as a tree: children under their parents.
// Eye hides a part while you work, lock keeps it out of reach; neither is
// saved. In pose mode the check is the state's membership.

import { signal } from "@preact/signals";
import { InlineName } from "./Rename.tsx";
import { Checkbox, GroupHeader, Icon, SidebarRow, cx } from "./ur.tsx";
import { ed, parts, curState, curClip, addPart, deletePart, renamePart, movePartInState, toggleMembership, freshName } from "../state/editor.ts";
import { local, toggleHidden, toggleLocked } from "../state/local.ts";
import { renaming, menuAt, type MenuItem } from "../state/menu.ts";

export function partMenu(i: number): MenuItem[] {
	const ps = parts();
	return [
		{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "part", index: i }) },
		{ label: "Set pivot", run: () => (ed.pending.value = "pivot") },
		{ label: "Add anchor", run: () => (ed.pending.value = "anchor") },
		{ label: "Raise (paints later)", run: () => movePartInState(ps[i].name, true), sep: true },
		{ label: "Lower (paints earlier)", run: () => movePartInState(ps[i].name, false) },
		{ label: "Delete part", danger: true, sep: true, run: () => deletePart(i) },
	];
}

export function addPartNow() {
	const i = addPart(freshName("part", parts().map((p) => p.name)));
	renaming.value = { kind: "part", index: i };
}

/** Parts whose children are folded away, by name: the outline's own, never saved. */
const folded = signal<ReadonlySet<string>>(new Set());
function fold(name: string) {
	const s = new Set(folded.value);
	if (!s.delete(name)) s.add(name);
	folded.value = s;
}

/** Parts in the current state's paint order, then the ones it leaves out. */
function ordered(): { p: (typeof parts extends () => infer T ? T : never)[number]; i: number }[] {
	const ps = parts();
	const st = curState();
	const rank = new Map<string, number>();
	st?.parts.forEach((sp, k) => rank.set(sp.part, k));
	return ps
		.map((p, i) => ({ p, i }))
		.sort((a, b) => (rank.get(a.p.name) ?? 1e9) - (rank.get(b.p.name) ?? 1e9) || a.i - b.i);
}

function childrenOf(name: string | undefined) {
	const names = new Set(parts().map((p) => p.name));
	return ordered().filter(({ p }) => (name === undefined ? !p.parent || !names.has(p.parent) : p.parent === name));
}

const quiet = (e: Event) => e.stopPropagation();

function LayerRow({ i, depth }: { i: number; depth: number }) {
	const ps = parts();
	const p = ps[i];
	if (!p) return null;
	const cur = ed.curPart.value;
	const st = curState();
	const kids = childrenOf(p.name);
	const open = !folded.value.has(p.name);
	const off = local.hidden.value.has(p.name);
	const lock = local.locked.value.has(p.name);
	const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
	const ren = renaming.value;
	const isRen = ren?.kind === "part" && ren.index === i;
	const preview = !!curClip();
	const pick = () => {
		ed.curPart.value = i;
		ed.partPicked.value = true;
	};
	return (
		<>
			<SidebarRow
				class="ed-part"
				depth={depth}
				expandable={kids.length > 0}
				open={open}
				onToggle={() => fold(p.name)}
				selected={i === cur}
				dim={off || (!!st && !member)}
				link={p.like}
				title={p.like ? `Drawn like ${p.like}: its shapes and anchors, this part's pivot and pose` : undefined}
				leading={
					st && !preview ? (
						<span class="ed-row-lead" title={member ? "Drawn in this state (click to leave it out)" : "Not drawn in this state (click to add it)"} onClick={quiet} onDblClick={quiet}>
							<Checkbox checked={member} onChange={() => toggleMembership(ed.curState.value, p.name)} />
						</span>
					) : undefined
				}
				label={
					isRen ? (
						<InlineName
							value={p.name}
							onCommit={(n) => {
								renamePart(i, n);
								renaming.value = null;
							}}
							onCancel={() => (renaming.value = null)}
						/>
					) : (
						p.name
					)
				}
				trailing={
					<>
						<button
							type="button"
							class={cx("ur-row-vis ed-row-btn", off && "off")}
							title={off ? "Show" : "Hide while editing (not saved)"}
							aria-label={off ? "Show" : "Hide"}
							aria-pressed={off}
							onDblClick={quiet}
							onClick={(e) => {
								e.stopPropagation();
								toggleHidden(p.name);
							}}
						>
							<Icon name={off ? "eye-off" : "eye"} size={14} />
						</button>
						<button
							type="button"
							class={cx("ur-row-vis ed-row-btn", lock && "off")}
							title={lock ? "Unlock" : "Lock: keep out of reach (not saved)"}
							aria-label={lock ? "Unlock" : "Lock"}
							aria-pressed={lock}
							onDblClick={quiet}
							onClick={(e) => {
								e.stopPropagation();
								toggleLocked(p.name);
							}}
						>
							<Icon name={lock ? "lock" : "lock-open"} size={14} />
						</button>
					</>
				}
				onClick={pick}
				onDoubleClick={() => (renaming.value = { kind: "part", index: i })}
				onContextMenu={(e) => {
					pick();
					menuAt(e, partMenu(i));
				}}
				onDelete={() => deletePart(i)}
			/>
			{open && kids.map((k) => <LayerRow key={k.p.name} i={k.i} depth={depth + 1} />)}
		</>
	);
}

export function Layers() {
	void ed.rev.value;
	void renaming.value;
	void local.hidden.value;
	void local.locked.value;
	void folded.value;
	return (
		<>
			<GroupHeader title="The parts of this file, children under their parents; file order is paint order" onAdd={addPartNow} addLabel="New part">
				Parts
			</GroupHeader>
			{childrenOf(undefined).map((k) => (
				<LayerRow key={k.p.name} i={k.i} depth={0} />
			))}
		</>
	);
}
