// The parts of the open file as a tree: children under their parents, and
// under a part of several shapes, its shapes in file order (paint order).
// Eye hides a part while you work, lock keeps it out of reach; neither is
// saved. In pose mode the check is the state's membership.

import { cssColor, type Shape } from "@fastart/core";
import { InlineName } from "./Rename.tsx";
import { Checkbox, GroupHeader, Icon, SidebarRow, cx, type IconName } from "./ur.tsx";
import { ShapeRow, folding, opens, shapeLabels, revealShapeRow, type ShapeRowActs } from "./ShapeRows.tsx";
import { ed, parts, curState, curClip, addPart, deletePart, renamePart, movePartInState, toggleMembership, freshName, selHas, selOnly, selClear, selToggle } from "../state/editor.ts";
import { run, keysFor } from "../state/commands.ts";
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

/** Which parts are open, by file and name: the outline's own, never saved. */
const fold = folding();
const foldKey = (name: string) => `${ed.path.value ?? ""}\n${name}`;

/** The tools' icons where a tool makes the kind: the circle's, the line's, the pen's for a path; a poly is a closed outline. */
const SHAPE_ICONS: Record<Shape["kind"], IconName> = { circle: "circle", line: "slash", poly: "pentagon", path: "pen-tool" };

/** The palette's colours as css, by name; made again only when the palette changes. */
let tokenCss: { of: unknown; css: Map<string, string> } | null = null;
function cssOfTokens(): Map<string, string> {
	const toks = ed.tokens.value;
	if (tokenCss?.of !== toks) tokenCss = { of: toks, css: new Map(toks.map((t) => [t.name, cssColor(t.rgb)])) };
	return tokenCss.css;
}

/** A shape's row acts as the shape does on the canvas: the same selection, the same commands. */
const shapeActs: ShapeRowActs = {
	pick(p, s, e) {
		const r = { p, s };
		// ⇧ or ⌘ adds a shape to what is chosen, or takes it out, as ⇧ does on the canvas
		if (e.shiftKey || e.metaKey || e.ctrlKey) selToggle(r);
		else selOnly(r);
		ed.curPart.value = p;
		ed.partPicked.value = true;
	},
	menu(p, s, e) {
		const r = { p, s };
		if (!selHas(r)) selOnly(r);
		ed.curPart.value = p;
		ed.partPicked.value = true;
		// what the canvas offers a shape, and only where it does: a clip is a preview, the collision lens has its own shapes
		const off = ed.collide.value || !!curClip();
		menuAt(e, [
			{ label: "Duplicate", keys: keysFor("edit.duplicate"), disabled: off, run: () => run("edit.duplicate") },
			{ label: "Copy", keys: keysFor("edit.copy"), disabled: off, run: () => run("edit.copy") },
			{ label: "Raise", keys: "]", disabled: off, sep: true, run: () => run("edit.raise") },
			{ label: "Lower", keys: "[", disabled: off, run: () => run("edit.lower") },
			{ label: "Delete", keys: "⌫", disabled: off, danger: true, sep: true, run: () => run("edit.delete") },
		]);
	},
	remove(p, s) {
		if (ed.collide.value || curClip()) return;
		const r = { p, s };
		if (!selHas(r)) selOnly(r);
		run("edit.delete");
	},
};
// a shape chosen anywhere (the canvas, a marquee): its part's row opens, and its parents', and its own row comes into view
ed.sel.subscribe((sel) => {
	const r = sel[sel.length - 1];
	if (!r) return;
	const ps = parts();
	const seen = new Set<string>();
	for (let p = ps[r.p]; p && !seen.has(p.name); p = ps.find((q) => q.name === p!.parent)!) {
		seen.add(p.name);
		const name = p.name;
		const n = p.like ? 0 : (p.shapes ?? []).length;
		const kids = ps.filter((q) => q.parent === name).length;
		if (!fold.peekOpen(foldKey(name), n, kids)) fold.set(foldKey(name), true);
	}
	revealShapeRow();
});

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
	// a part drawn like another has no shapes of its own; a part of one shape is that shape, and stays a plain row
	const shapes = p.like ? [] : (p.shapes ?? []);
	const can = opens(shapes.length, kids.length);
	const open = can && fold.isOpen(foldKey(p.name), shapes.length, kids.length);
	const listed = open && shapes.length > 1;
	const sel = ed.sel.value;
	const chosen = (k: number) => sel.some((r) => r.p === i && r.s === k);
	// with one of its shapes marked below it, the part's own row is tinted and the shape's wears the selection
	const shapeMarked = listed && shapes.some((_, k) => chosen(k));
	const labels = listed ? shapeLabels(shapes, (k) => shapes[k].kind) : [];
	const css = listed ? cssOfTokens() : null;
	const off = local.hidden.value.has(p.name);
	const lock = local.locked.value.has(p.name);
	const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
	const ren = renaming.value;
	const isRen = ren?.kind === "part" && ren.index === i;
	const preview = !!curClip();
	const pick = () => {
		// the part's own row: the part is what is chosen now, not a shape of it or of another
		if (ed.sel.value.length) selClear();
		ed.curPart.value = i;
		ed.partPicked.value = true;
	};
	return (
		<>
			<SidebarRow
				class="ed-part"
				depth={depth}
				expandable={can}
				open={open}
				onToggle={can ? () => fold.set(foldKey(p.name), !open) : undefined}
				selected={i === cur && !shapeMarked}
				current={i === cur && shapeMarked}
				dim={off || (!!st && !member)}
				link={p.like}
				count={shapes.length > 1 ? shapes.length : undefined}
				title={p.like ? `Drawn like ${p.like}: its shapes and anchors, this part's pivot and pose` : shapes.length > 1 ? `${shapes.length} shapes${open ? "" : ": open the row to see and choose them"}` : undefined}
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
			{listed &&
				shapes.map((sh, k) => (
					<ShapeRow
						key={`s${k}`}
						part={i}
						shape={k}
						depth={depth + 1}
						icon={SHAPE_ICONS[sh.kind] ?? "pentagon"}
						label={labels[k]}
						token={sh.color}
						color={sh.color ? css!.get(sh.color) : undefined}
						title={`Shape ${k + 1} of ${shapes.length} in ${p.name}, in file order (later paints over earlier): a ${sh.kind}${sh.color ? ` filled ${sh.color}${css!.has(sh.color) ? "" : ", a colour the palette does not have"}` : ""} · click chooses it as on the canvas, ⇧ adds`}
						selected={chosen(k)}
						inactive={false}
						dim={off || (!!st && !member)}
						acts={shapeActs}
					/>
				))}
			{open && kids.map((k) => <LayerRow key={k.p.name} i={k.i} depth={depth + 1} />)}
		</>
	);
}

export function Layers() {
	void ed.rev.value;
	void renaming.value;
	void local.hidden.value;
	void local.locked.value;
	void fold.chosen.value;
	void ed.sel.value;
	void ed.tokens.value;
	return (
		<>
			<GroupHeader title="The parts of this file, children under their parents; a part of several shapes opens to them, in file order, which is paint order" onAdd={addPartNow} addLabel="New part">
				Parts
			</GroupHeader>
			{childrenOf(undefined).map((k) => (
				<LayerRow key={k.p.name} i={k.i} depth={0} />
			))}
		</>
	);
}
