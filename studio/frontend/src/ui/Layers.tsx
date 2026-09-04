// The parts of the open file as a tree: children under their parents.
// Eye hides a part while you work, lock keeps it out of reach; neither is
// saved. In pose mode the eye becomes the state's membership.

import { I } from "./Icons.tsx";
import { InlineName } from "./Rename.tsx";
import { ed, parts, curState, curClip, addPart, deletePart, renamePart, movePartInState, toggleMembership, freshName } from "../state/editor.ts";
import { local, toggleHidden, toggleLocked } from "../state/local.ts";
import { renaming, openContextMenu } from "../state/menu.ts";

export function partMenu(i: number) {
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

function LayerRow({ i, depth }: { i: number; depth: number }) {
	const ps = parts();
	const p = ps[i];
	if (!p) return null;
	const cur = ed.curPart.value;
	const st = curState();
	const kids = childrenOf(p.name);
	const off = local.hidden.value.has(p.name);
	const lock = local.locked.value.has(p.name);
	const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
	const ren = renaming.value;
	const isRen = ren?.kind === "part" && ren.index === i;
	const preview = !!curClip();
	return (
		<>
			<div
				class={`layer ${i === cur ? "active" : ""} ${off || (st && !member) ? "off" : ""}`}
				style={{ paddingLeft: `${6 + depth * 14}px` }}
				onClick={() => (ed.curPart.value = i)}
				onDblClick={() => (renaming.value = { kind: "part", index: i })}
				onContextMenu={(e) => {
					e.preventDefault();
					ed.curPart.value = i;
					openContextMenu(e.clientX, e.clientY, partMenu(i));
				}}
			>
				{st && !preview ? (
					<span
						class={`check ${member ? "on" : ""}`}
						title={member ? "drawn in this state (click to leave it out)" : "not drawn in this state (click to add it)"}
						onClick={(e) => {
							e.stopPropagation();
							toggleMembership(ed.curState.value, p.name);
						}}
					/>
				) : (
					<span class="glyph">{kids.length ? "▾" : "·"}</span>
				)}
				{isRen ? (
					<InlineName
						value={p.name}
						onCommit={(n) => {
							renamePart(i, n);
							renaming.value = null;
						}}
						onCancel={() => (renaming.value = null)}
					/>
				) : (
					<span class="name">{p.name}</span>
				)}
				<span class="tail">
					<button
						class={`ico ${off ? "on" : ""}`}
						title={off ? "show" : "hide while editing (not saved)"}
						onClick={(e) => {
							e.stopPropagation();
							toggleHidden(p.name);
						}}
					>
						{off ? <I.eyeOff /> : <I.eye />}
					</button>
					<button
						class={`ico ${lock ? "on" : ""}`}
						title={lock ? "unlock" : "lock: keep out of reach (not saved)"}
						onClick={(e) => {
							e.stopPropagation();
							toggleLocked(p.name);
						}}
					>
						{lock ? <I.lock /> : <I.unlock />}
					</button>
				</span>
			</div>
			{kids.map((k) => (
				<LayerRow key={k.p.name} i={k.i} depth={depth + 1} />
			))}
		</>
	);
}

export function Layers() {
	void ed.rev.value;
	void renaming.value;
	void local.hidden.value;
	void local.locked.value;
	return (
		<>
			<div class="hdr" title="the parts of this file, children under their parents; file order is paint order">
				Layers
			</div>
			{childrenOf(undefined).map((k) => (
				<LayerRow key={k.p.name} i={k.i} depth={0} />
			))}
			<button class="add-row" onClick={addPartNow}>
				<I.plus size={11} /> part
			</button>
		</>
	);
}
