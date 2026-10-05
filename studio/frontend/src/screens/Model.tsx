// The model screen's parts of the workspace: a 3D file. Parts, states and
// clips for the sidebar, the solids' tools for the floating bar, the model
// turned under the view on the canvas, the timeline below when a clip is
// chosen, the inspector. The frame is screens/Workspace.tsx.

import { useEffect, useRef, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { clipDuration3, cssColor, VIEWS, type Ease, type StatePart3 } from "@fastart/core";
import { InlineName } from "../ui/Rename.tsx";
import { ColorPicker } from "../ui/ColorPicker.tsx";
import { ModelCanvas } from "../canvas/ModelCanvas.tsx";
import { TexturesPanel } from "../ui/Textures.tsx";
import { project } from "../state/project.ts";
import { gizmoStatus } from "../canvas/gizmo3.ts";
import { ToolBar, Transport, gridMode, keyReadout, type ToolSpec } from "../ui/Tools.tsx";
import { Button, Checkbox, Chip, ColorRow, GroupHeader, Icon, InspectorSection, NumberField, Property, SegmentedControl, Select, Sheet, SidebarRow, TextField, cx, type NumberFieldProps } from "../ui/ur.tsx";
import { showIssues } from "../ui/ProjectBar.tsx";
import { renaming, menuAt, type MenuItem } from "../state/menu.ts";
import { sidebar } from "../state/sidebar.ts";
import { openSheet, closeSheet } from "../state/prompt.ts";
import { busy, logActivity } from "../state/activity.ts";
import { run } from "../state/commands.ts";
import { basename } from "../state/paths.ts";
import {
	md,
	parts,
	states,
	clips,
	palette,
	curPart,
	curState,
	curClip,
	poseOfCur,
	selShape,
	freshName,
	addPart,
	deletePart,
	renamePart,
	parentCandidates,
	setParent,
	setLike,
	setPivotAxis,
	selectState,
	selectClip,
	addState,
	deleteState,
	renameState,
	toggleMembership,
	movePartInState,
	setPose,
	resetPose,
	addClip,
	deleteClip,
	renameClip,
	setClipLoop,
	seek,
	addKey,
	deleteKey,
	setKeyTime,
	setKeyState,
	setKeyEase,
	paintSel,
	setShapeNumber,
	setShapeCoord,
	setVertexAxis,
	setSmoothField,
	setSweepField,
	setCrease,
	creaseOf,
	morphCount,
	resetMorph,
	selShapePosed,
	deleteSel,
	addToken,
	deleteToken,
	renameToken,
	setTokenColor,
	setDocName,
	setView,
	setTurn,
	projectViews,
	hullOfPart,
	textures,
	addTexture,
	deleteTexture,
	renameTexture,
	setTextureCell,
	setMap,
	endGesture,
	addMap,
	deleteMap,
	setSelTexture,
	setSelMappingScale,
	type Tool3,
} from "../state/model.ts";

const DEG = 180 / Math.PI;
const TOOLS: ToolSpec<Tool3>[] = [
	{ tool: "select", label: "Select", key: "V", icon: "mouse-pointer-2" },
	{ tool: "rect", label: "Box", key: "R", icon: "square", makes: "drag a rectangle in the view plane: a box, as deep as the depth field" },
	{ tool: "circle", label: "Ball", key: "O", icon: "circle", makes: "drag from the centre: a ball" },
	{ tool: "line", label: "Rod", key: "L", icon: "slash", makes: "drag a line: a rod, half the depth wide" },
	{ tool: "poly", label: "Prism", key: "P", icon: "pentagon", makes: "click a profile, close it: a prism, as deep as the depth field" },
];
const EASES: Ease[] = ["linear", "in", "out", "in-out", "step"];

// ------------------------------------------------------------- top

/** The status bar's line: the mode, and what a gesture does in it. */
export function modelStatus(): string {
	const moving = gizmoStatus();
	if (moving) return moving;
	const tool = md.tool.value;
	const st = curState();
	const clip = curClip();
	const vn = md.viewName.value || "free";
	if (clip) return `Previewing ${clip.name} · ${vn} · Space plays · keys name states, pose those to change a key`;
	if (md.pending.value === "pivot") return "Click the canvas to place the pivot";
	if (tool === "poly") return "Click a profile in the view plane · click the first point or press Enter to close it into a prism · Esc drops it";
	if (tool !== "select") return `${vn} · ${TOOLS.find((t) => t.tool === tool)?.makes ?? ""}`;
	if (st) return `${st.name} · ${vn} · Arrows move along an axis, rings turn about one · G T S move, turn and size by key · middle-drag orbits`;
	return "";
}

/** The path bar's right side: the tools and modes, the depth new solids get, then the clip's transport. */
export function ModelTools() {
	void md.rev.value;
	const clip = curClip();
	const dur = clip ? clipDuration3(clip) : 0;
	return (
		<>
			<ToolBar
				tools={TOOLS}
				current={md.tool.value}
				disabled={(t) => !!clip && t !== "select"}
				why="A clip is a preview; pick a state to edit"
				modes={[
					{ id: "deform", command: "edit.deform", label: "Deform: corner drags reshape the part in this state only", icon: "spline", key: "D", on: md.deform.value, disabled: !!clip, why: "A clip is a preview; pick a state to deform" },
					{ id: "outline", command: "model.outline", label: "Silhouettes, the way Project draws them", icon: "square-dashed", on: md.outline.value },
					{ id: "collision", command: "view.collision", label: "Collision solids", icon: "shield", key: "C", on: md.collide.value },
					gridMode(),
				]}
			/>
			<span class="ur-pathbar-sep" />
			<NumberField value={md.thick.value} step={0.5} min={0.1} width={78} suffix="deep" stepper={false} title="How deep a new box, prism, ball or rod is, along the view axis" label="Depth" onChange={(v) => (md.thick.value = Math.max(0.1, v))} />
			{clip && (
				<>
					<span class="ur-pathbar-sep" />
					<Transport name={clip.name} playing={md.playing.value} onPlay={() => run("clip.play")} onRewind={() => seek(0)} readout={keyReadout(clip.keys, md.clipTime.value)} progress={dur > 0 ? md.clipTime.value / dur : 0} />
				</>
			)}
		</>
	);
}

const CAMERAS = Object.keys(VIEWS).filter((v) => v !== "side");

/** The View tab's own sections: the camera laid on the model, and the overlays. */
export function ModelView() {
	void md.rev.value;
	return (
		<>
			<InspectorSection title="Camera" hint="a turn laid on the model before it is drawn; the light is in view space">
				<div class="insp-wrap">
					<SegmentedControl options={CAMERAS.slice(0, 3)} value={md.viewName.value} onChange={setView} label="Camera" />
					<SegmentedControl options={CAMERAS.slice(3)} value={md.viewName.value} onChange={setView} label="Camera" />
				</div>
				<Property label="Angle" layout="trio">
					{([0, 1, 2] as const).map((ax) => (
						<NumberField
							axis={(["x", "y", "z"] as const)[ax]}
							value={Math.round(md.turn.value[ax] * DEG * 100) / 100}
							step={15}
							suffix="°"
							stepper={false}
							onChange={(v) => {
								const t = [...md.turn.value] as [number, number, number];
								t[ax] = v / DEG;
								setTurn(t);
							}}
						/>
					))}
				</Property>
				<Property label="Ambient" title="how much light reaches the faces turned away">
					<NumberField value={md.ambient.value} min={0} max={1} step={0.05} onChange={(v) => (md.ambient.value = Math.max(0, Math.min(1, v)))} />
				</Property>
				<Property label="Depth" title="how deep a new solid is, along the view axis">
					<NumberField value={md.thick.value} min={0.1} step={0.5} onChange={(v) => (md.thick.value = Math.max(0.1, v))} />
				</Property>
			</InspectorSection>
			<InspectorSection title="Overlays">
				<Property label="">
					<Checkbox checked={md.collide.value} label="Collision solids" onChange={() => run("view.collision")} />
				</Property>
				<Property label="">
					<Checkbox checked={md.outline.value} label="Silhouettes" onChange={() => run("model.outline")} />
				</Property>
				<Property label="">
					<Checkbox checked={md.deform.value} disabled={!!curClip()} label="Deform in this state" onChange={() => run("edit.deform")} />
				</Property>
			</InspectorSection>
			<InspectorSection title="Project to 2D" hint="write the 2D views a game draws, beside this file">
				<div class="insp-actions">
					<button type="button" class="ur-btn" onClick={() => run("model.project")}>
						Project…
					</button>
				</div>
			</InspectorSection>
		</>
	);
}

// ------------------------------------------------------------- left

/** the parents whose children are folded away, by name: it lasts the session */
const folded = signal<Set<string>>(new Set());
function toggleFold(name: string) {
	const n = new Set(folded.value);
	if (!n.delete(name)) n.add(name);
	folded.value = n;
}

function pickPart(i: number) {
	md.curPart.value = i;
	md.partPicked.value = true;
}
function partMenu(i: number): MenuItem[] {
	const ps = parts();
	return [
		{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "part", index: i }) },
		{ label: "Set pivot", run: () => (md.pending.value = "pivot") },
		{ label: "Raise (paints later)", run: () => movePartInState(ps[i].name, true), sep: true },
		{ label: "Lower (paints earlier)", run: () => movePartInState(ps[i].name, false) },
		{ label: "Delete part", keys: "⌫", danger: true, sep: true, disabled: ps.length <= 1, run: () => deletePart(i) },
	];
}
function addPartNow() {
	const i = addPart(freshName("part", parts().map((p) => p.name)));
	renaming.value = { kind: "part", index: i };
}
function childrenOf(name: string | undefined) {
	const ps = parts();
	const names = new Set(ps.map((p) => p.name));
	return ps.map((p, i) => ({ p, i })).filter(({ p }) => (name === undefined ? !p.parent || !names.has(p.parent) : p.parent === name));
}
function PartRow({ i, depth }: { i: number; depth: number }) {
	const p = parts()[i];
	if (!p) return null;
	const st = curState();
	const kids = childrenOf(p.name);
	const open = !folded.value.has(p.name);
	const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
	const ren = renaming.value;
	const isRen = ren?.kind === "part" && ren.index === i;
	const preview = !!curClip();
	const morphed = morphCount(i) > 0;
	return (
		<>
			<SidebarRow
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
				icon="layers"
				depth={depth}
				expandable={kids.length > 0}
				open={open}
				onToggle={kids.length ? () => toggleFold(p.name) : undefined}
				selected={i === md.curPart.value}
				inactive={sidebar.focus.value !== "nav"}
				dim={!!st && !member}
				link={p.like || undefined}
				chip={morphed ? "morph" : undefined}
				count={p.like ? undefined : (p.shapes ?? []).length}
				title={morphed ? "Reshaped in this state (a morph)" : p.like ? `Drawn like ${p.like}` : undefined}
				leading={
					st && !preview ? (
						<span class="model-member" title={member ? "Drawn in this state · click to leave it out" : "Not drawn in this state · click to add it"} onClick={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
							<Checkbox checked={member} onChange={() => toggleMembership(md.curState.value, p.name)} />
						</span>
					) : undefined
				}
				onClick={() => pickPart(i)}
				onDoubleClick={() => (renaming.value = { kind: "part", index: i })}
				onContextMenu={(e) => {
					pickPart(i);
					menuAt(e, partMenu(i));
				}}
				onDelete={parts().length > 1 ? () => deletePart(i) : undefined}
			/>
			{open && kids.map((k) => <PartRow key={k.p.name} i={k.i} depth={depth + 1} />)}
		</>
	);
}

export function ModelSidebar() {
	void md.rev.value;
	const sts = states();
	const cs = clips();
	const curS = md.curState.value;
	const curC = md.curClip.value;
	const ren = renaming.value;
	return (
		<>
			<GroupHeader title="The parts of this model, children under their parents" addLabel="New part" onAdd={addPartNow}>
				Parts
			</GroupHeader>
			{childrenOf(undefined).map((k) => (
				<PartRow key={k.p.name} i={k.i} depth={0} />
			))}
			<GroupHeader title="Every view is a state: which parts show and where each sits. Shapes are modelled in whichever state you are looking at." addLabel="New state, a copy of this one" onAdd={() => addStateNow()}>
				States
			</GroupHeader>
			{sts.map((s, k) => (
				<SidebarRow
					key={s.name}
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
					icon="circle-dot"
					current={k === curS && curC < 0}
					onClick={() => selectState(k)}
					onDoubleClick={() => (renaming.value = { kind: "state", index: k })}
					onContextMenu={(e) =>
						menuAt(e, [
							{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "state", index: k }) },
							{ label: "Duplicate", run: () => addStateNow(k) },
							{ label: "Delete state", keys: "⌫", danger: true, disabled: sts.length <= 1, sep: true, run: () => deleteState(k) },
						])
					}
					onDelete={sts.length > 1 ? () => deleteState(k) : undefined}
				/>
			))}
			<GroupHeader title="Animation: states in time. A clip is a preview here." addLabel="New clip" onAdd={addClipNow} disabled={sts.length === 0}>
				Clips
			</GroupHeader>
			{cs.map((c, k) => (
				<SidebarRow
					key={c.name}
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
					icon="film"
					current={k === curC}
					chip={`${c.keys.length} key${c.keys.length === 1 ? "" : "s"}${c.loop ? " · loop" : ""}`}
					onClick={() => selectClip(k)}
					onDoubleClick={() => (renaming.value = { kind: "clip", index: k })}
					onContextMenu={(e) =>
						menuAt(e, [
							{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "clip", index: k }) },
							{ label: "Delete clip", keys: "⌫", danger: true, sep: true, run: () => deleteClip(k) },
						])
					}
					onDelete={() => deleteClip(k)}
				/>
			))}
		</>
	);
}
function addStateNow(from?: number) {
	const src = states()[from ?? md.curState.value];
	addState(freshName(src ? src.name : "state", states().map((s) => s.name)), from);
	renaming.value = { kind: "state", index: md.curState.value };
}
function addClipNow() {
	if (!addClip(freshName("clip", clips().map((c) => c.name)))) return;
	renaming.value = { kind: "clip", index: md.curClip.value };
}

// ------------------------------------------------------------- fields

const AXES = ["x", "y", "z"] as const;
const r3 = (n: number) => +n.toFixed(3);

/** A number of the file: shown to three places, one undo step once the field is left. */
function N(p: NumberFieldProps) {
	return <NumberField {...p} value={p.value == null ? p.value : r3(p.value)} step={p.step ?? 0.1} onDone={endGesture} />;
}

/** X, Y and Z of one point, on one row. */
function Trio(p: { label: string; title?: string; value: readonly number[]; step?: number; suffix?: string; onAxis: (ax: 0 | 1 | 2, v: number) => void }) {
	return (
		<Property label={p.label} layout="trio" title={p.title}>
			{([0, 1, 2] as const).map((ax) => (
				<N axis={AXES[ax]} value={p.value[ax] ?? 0} step={p.step} suffix={p.suffix} stepper={false} onChange={(v) => p.onAxis(ax, v)} />
			))}
		</Property>
	);
}

/** A name that is typed, then committed with Return or by leaving the field. */
function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
	const [v, set] = useState(value);
	useEffect(() => set(value), [value]);
	const commit = () => {
		const n = v.trim();
		if (n && n !== value) onCommit(n);
		// a name the file refused falls back to the one it has
		set(value);
	};
	return <TextField value={v} onChange={set} onSubmit={commit} onBlur={commit} />;
}

const hexOf = (rgb: readonly number[]) =>
	`#${rgb
		.slice(0, rgb[3] === 255 || rgb[3] == null ? 3 : 4)
		.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0"))
		.join("")}`;

// ------------------------------------------------------------- bottom: the timeline

export function ModelTimeline() {
	void md.rev.value;
	const clip = curClip();
	const playing = md.playing.value;
	useEffect(() => {
		if (!playing || !clip) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			const dur = clipDuration3(clip);
			let t = md.clipTime.value + dt;
			if (dur <= 0) t = 0;
			else if (t >= dur) {
				if (clip.loop) t = t % dur;
				else {
					t = dur;
					md.playing.value = false;
				}
			}
			md.clipTime.value = t;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, clip]);
	if (!clip) return null;
	const dur = clipDuration3(clip);
	const span = Math.max(dur, 1);
	const t = md.clipTime.value;
	const ki = md.curKey.value;
	const key = clip.keys[ki];
	const ci = md.curClip.value;
	return (
		<div class="model-timeline">
			<Button variant="toolbar" class="ur-btn-sm" icon={playing ? "pause" : "play"} title={playing ? "Pause (Space)" : "Play (Space)"} onClick={() => (md.playing.value = !playing)} />
			<input class="model-scrub" type="range" aria-label="Playhead" min={0} max={span} step={0.001} value={t} onInput={(e) => seek(Number((e.target as HTMLInputElement).value))} onKeyDown={(e) => e.stopPropagation()} />
			<span class="model-time">{t.toFixed(2)}s</span>
			<div class="model-keys">
				<SegmentedControl
					label="Keys"
					options={clip.keys.map((k, i) => ({ value: String(i), label: `${k.t}s`, title: `Key at ${k.t}s${k.state ? `: ${k.state}` : ""}` }))}
					value={key ? String(ki) : null}
					onChange={(v) => {
						const i = Number(v);
						md.curKey.value = i;
						seek(clip.keys[i].t);
					}}
				/>
			</div>
			<Button icon="plus" title="A key at the playhead, naming the current state" onClick={addKey}>
				Key
			</Button>
			<Checkbox checked={!!clip.loop} label="Loop" title="The clip wraps at its last key" onChange={(v) => setClipLoop(ci, v)} />
			{key && (
				<>
					<span class="model-timeline-sep" />
					<N value={key.t} min={0} step={0.05} suffix="s" width={72} stepper={false} label="Key time" title="When this key lands" onChange={(v) => setKeyTime(ki, v)} />
					<Select value={key.state ?? ""} options={states().map((s) => s.name)} width={128} title="The state this key names" onChange={(v) => setKeyState(ki, v)} />
					<Select value={key.ease ?? "linear"} options={EASES} width={92} title="How this key eases into the next" onChange={(v) => setKeyEase(ki, v)} />
					<Button variant="toolbar" class="ur-btn-sm" icon="trash-2" title="Delete key" disabled={clip.keys.length <= 1} onClick={() => deleteKey(ki)} />
				</>
			)}
		</div>
	);
}

// ------------------------------------------------------------- right: the inspector

/** A shape's fill: one of the palette's colours, picked from a list of swatches. */
function TokenPick({ current, onPick }: { current: string | undefined; onPick: (t: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	useEffect(() => {
		if (!open) return;
		const down = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", down, true);
		return () => document.removeEventListener("mousedown", down, true);
	}, [open]);
	const toks = md.tokens.value;
	const tk = toks.find((t) => t.name === current);
	return (
		<span
			class="ur-anchor model-fill"
			ref={ref}
			onKeyDown={(e) => {
				if (e.key === "Escape" && open) {
					e.stopPropagation();
					setOpen(false);
				}
			}}
		>
			<button type="button" class="model-fill-btn" title="Fill: a colour of the palette" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
				<span class={cx("ur-swatch", !tk && "model-swatch-missing")} style={tk ? { background: cssColor(tk.rgb) } : undefined} />
				<span class="model-fill-name">{current ?? "None"}</span>
				<Icon name="chevrons-up-down" size={12} />
			</button>
			{open && (
				<div class="ur-popover model-fill-pop" role="listbox" aria-label="Fill">
					{toks.length === 0 && <div class="insp-hint flush">No colours yet</div>}
					{toks.map((t) => (
						<ColorRow
							key={t.name}
							name={t.name}
							color={cssColor(t.rgb)}
							hex=""
							selected={t.name === current}
							onClick={() => {
								onPick(t.name);
								setOpen(false);
							}}
						/>
					))}
				</div>
			)}
		</span>
	);
}

export function Inspector3() {
	void md.rev.value;
	const p = curPart();
	const i = md.curPart.value;
	const sp = poseOfCur();
	const sel = md.sel.value;
	const sh = selShape();
	// the corners as this state has them: a morph shows and edits its own points
	const shp = selShapePosed() ?? sh;
	const vert = md.vert.value;
	const preview = !!curClip();
	const [picking, setPicking] = useState<{ i: number; x: number; y: number } | null>(null);
	const [tok, setTok] = useState<number | null>(null);
	const ren = renaming.value;
	// a part chosen on purpose (a row, a hit) shows; an empty click on the canvas lets go of it
	const picked = md.partPicked.value || !!(sh && sel);
	const st = curState();
	const texs = textures();
	const pal = palette();
	const morphs = p ? morphCount(i) : 0;
	const edge = md.edge.value;
	const removeToken = (k: number) => {
		deleteToken(k);
		setTok(null);
		setPicking(null);
	};
	return (
		<div class="inspector">
			{sh && sel && (
				<InspectorSection title="Shape" hint="what is selected on the canvas" tail={sh.kind}>
					<Property label="Fill">
						<TokenPick current={sh.color} onPick={paintSel} />
					</Property>
					<Property label="Shade" title="lighting on the slot's colour, on top of the view's light">
						<N value={sh.shade ?? 1} min={0} onChange={(v) => setShapeNumber(sel, "shade", v)} />
					</Property>
					{texs.length > 0 && (
						<Property label="Texture" title="a texture of the file, box mapped over the shape's faces">
							<Select value={sh.texture ?? ""} options={[{ value: "", label: "None" }, ...texs.map((t) => ({ value: t.name, label: t.name }))]} onChange={setSelTexture} />
						</Property>
					)}
					{sh.texture && (
						<Property label="Size" title="world units per pattern unit: 2 makes the pattern twice as big">
							<N value={sh.mapping?.scale ?? 1} min={0.01} step={0.25} onChange={setSelMappingScale} />
							{sh.mapping?.uvs && <Chip title="explicit pattern coordinates per corner, from the file">uvs</Chip>}
						</Property>
					)}
					{sh.kind === "ball" && (
						<>
							<Trio label="Centre" value={sh.at} onAxis={(ax, v) => setShapeCoord(sel, "at", ax, v)} />
							<Property label="Radius">
								<N value={sh.r} min={0} onChange={(v) => setShapeNumber(sel, "r", v)} />
							</Property>
						</>
					)}
					{sh.kind === "rod" && (
						<>
							<Trio label="From" value={sh.a} onAxis={(ax, v) => setShapeCoord(sel, "a", ax, v)} />
							<Trio label="To" value={sh.b} onAxis={(ax, v) => setShapeCoord(sel, "b", ax, v)} />
							<Property label="Width">
								<N value={sh.w} min={0} onChange={(v) => setShapeNumber(sel, "w", v)} />
							</Property>
						</>
					)}
					{sh.kind === "mesh" && (
						<Property label="Corners" title="drag a corner on the canvas along the view plane; the fields move it on any axis">
							<span class="ur-prop-val">
								{sh.points.length} · {sh.faces.length} faces
							</span>
						</Property>
					)}
					{(sh.kind === "mesh" || sh.kind === "sweep") && (
						<>
							<Property label="Normals" title="how the surface is lit (1.7): flat keeps one normal per face; smooth averages them up to sharp edges, and is the default once subdivided">
								<Select
									value={sh.normals ?? ""}
									options={[
										{ value: "", label: (sh.smooth ?? 0) > 0 ? "Smooth (default)" : "Flat (default)" },
										{ value: "flat", label: "Flat" },
										{ value: "smooth", label: "Smooth" },
									]}
									onChange={(v) => setSmoothField(sel, "normals", v)}
								/>
							</Property>
							<Property label="Angle" title="faces meeting at more than this keep their own normals; 0 for no limit">
								<N value={sh.angle ?? 0} min={0} max={180} step={5} suffix="°" onChange={(v) => setSmoothField(sel, "angle", v)} />
							</Property>
							<Property label="Smooth" title="Catmull-Clark levels (1.7): the cage stays the file, the surface is drawn; keep it at 1 or 2">
								<N value={sh.smooth ?? 0} min={0} max={4} step={1} suffix="levels" onChange={(v) => setSmoothField(sel, "smooth", Math.max(0, Math.round(v)))} />
							</Property>
						</>
					)}
					{sh.kind === "sweep" && (
						<>
							<Property label="Sweep" layout="pair" title="a solid generated from a profile (1.7): a lathe revolves [radius, along] pairs about the axis, an extrude runs the closed outline along it">
								<Select
									value={sh.op}
									options={[
										{ value: "lathe", label: "Lathe" },
										{ value: "extrude", label: "Extrude" },
									]}
									onChange={(v) => setSweepField(sel, "op", v)}
								/>
								<Select
									value={sh.axis}
									title="The axis it sweeps about or along"
									options={[
										{ value: "x", label: "X" },
										{ value: "y", label: "Y" },
										{ value: "z", label: "Z" },
									]}
									onChange={(v) => setSweepField(sel, "axis", v)}
								/>
							</Property>
							{sh.op === "lathe" ? (
								<Property label="Segments">
									<N value={sh.segments ?? 12} min={3} step={1} onChange={(v) => setSweepField(sel, "segments", Math.max(3, Math.round(v)))} />
								</Property>
							) : (
								<>
									<Property label="From">
										<N value={sh.from ?? 0} onChange={(v) => setSweepField(sel, "from", v)} />
									</Property>
									<Property label="To">
										<N value={sh.to ?? 1} onChange={(v) => setSweepField(sel, "to", v)} />
									</Property>
								</>
							)}
							<Property label="Profile" title="edit it in the file or a generator">
								<span class="ur-prop-val">
									{sh.profile.points.length} points{sh.profile.in || sh.profile.out ? " · curved" : ""} · edit it in the file
								</span>
							</Property>
						</>
					)}
					{sh.kind === "mesh" && edge && (
						<Property label={`Crease ${edge[0]}–${edge[1]}`} title="the edge chosen with Shift-click on a second corner: its crease (1.7), 0 smooth to 1 sharp; a fraction is a fillet that rounds off after a few levels">
							<N value={creaseOf(sh, edge[0], edge[1])} min={0} max={1} step={0.1} onChange={(v) => setCrease(sel, edge[0], edge[1], Math.max(0, Math.min(1, v)))} />
						</Property>
					)}
					{sh.kind === "mesh" && vert !== null && sh.points[vert] && <Trio label={`Corner ${vert}`} value={shp && shp.kind === "mesh" && shp.points[vert] ? shp.points[vert] : sh.points[vert]} onAxis={(ax, v) => setVertexAxis(sel, vert, ax, v)} />}
					<div class="insp-actions">
						<Button title="A copy reflected across x = 0" onClick={() => run("model.mirror")}>
							Mirror
						</Button>
						<Button title="Duplicate (⌘D)" onClick={() => run("edit.duplicate")}>
							Duplicate
						</Button>
						<Button variant="danger" title="Delete (⌫)" onClick={deleteSel}>
							{vert !== null && sh.kind === "mesh" ? "Delete corner" : "Delete"}
						</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && (
				<InspectorSection title="Part" hint="a part: the unit that poses" tail={p.name}>
					<Property label="Name">
						{ren?.kind === "part" && ren.index === i ? <span class="ur-prop-val">{p.name}</span> : <NameField value={p.name} onCommit={(n) => renamePart(i, n)} />}
					</Property>
					<Trio label="Pivot" title="the point the part turns about" value={p.pivot ?? [0, 0, 0]} onAxis={(ax, v) => setPivotAxis(i, ax, v)} />
					<Property label="Parent">
						<Select value={p.parent ?? ""} options={[{ value: "", label: "None" }, ...parentCandidates(i).map((n) => ({ value: n, label: n }))]} onChange={(v) => setParent(i, v)} />
					</Property>
					<Property label="Drawn like" title="drawn like another part: its shapes, this part's pivot and pose">
						<Select
							value={p.like ?? ""}
							options={[
								{ value: "", label: "Itself" },
								...parts()
									.filter((q) => q !== p && !q.like)
									.map((q) => ({ value: q.name, label: q.name })),
							]}
							onChange={(v) => setLike(i, v)}
						/>
					</Property>
					<div class="insp-actions">
						<Button icon="crosshair" active={md.pending.value === "pivot"} title="Click the canvas to place the pivot" onClick={() => (md.pending.value = "pivot")}>
							Set pivot
						</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && sp && !preview && (
				<InspectorSection title="Pose" hint="where the part's pivot lands, its turn about x, y and z (degrees), its size" tail={st?.name ?? "state"}>
					{morphs > 0 && (
						<Property label="Morph" title="a morph: this state reshapes the part's meshes; clips lerp the corners between states">
							<span class="ur-prop-val model-grow">
								{morphs} mesh{morphs === 1 ? "" : "es"} reshaped
							</span>
							<Button title="Draw the base mesh in this state again" onClick={() => resetMorph(i)}>
								Reset
							</Button>
						</Property>
					)}
					{md.deform.value && morphs === 0 && <div class="insp-hint flush">Deform is on · drag a corner to reshape the part in this state</div>}
					<Trio
						label="Position"
						value={sp.offset ?? p.pivot ?? [0, 0, 0]}
						onAxis={(ax, v) => {
							const o = [...(sp.offset ?? p.pivot ?? [0, 0, 0])] as [number, number, number];
							o[ax] = v;
							setPose(sp, { offset: o }, `pose-${AXES[ax]}`);
						}}
					/>
					<Trio
						label="Rotation"
						step={5}
						suffix="°"
						value={([0, 1, 2] as const).map((ax) => ((sp.rotate ?? [0, 0, 0])[ax] ?? 0) * DEG)}
						onAxis={(ax, v) => {
							const r = [...(sp.rotate ?? [0, 0, 0])] as [number, number, number];
							r[ax] = v / DEG;
							setPose(sp, { rotate: r }, `pose-rot-${ax}`);
						}}
					/>
					<Property label="Scale">
						<N value={sp.scale ?? 1} min={0} step={0.05} onChange={(v) => setPose(sp, { scale: v }, "pose-size")} />
					</Property>
					<Property label="">
						<Checkbox checked={!!sp.mirror} label="Mirror" title="flipped across x about the pivot, before the turn" onChange={(v) => setPose(sp, { mirror: v })} />
					</Property>
					<div class="insp-actions">
						<Button onClick={() => resetPose(sp)}>Reset</Button>
						<Button onClick={() => toggleMembership(md.curState.value, p.name)}>Leave out of this state</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && !sp && !preview && st && (
				<InspectorSection title="Pose" tail={st.name}>
					<div class="insp-hint flush">Not drawn in this state</div>
					<div class="insp-actions">
						<Button onClick={() => toggleMembership(md.curState.value, p.name)}>Add to this state</Button>
					</div>
				</InspectorSection>
			)}
			{p && picked && (
				<InspectorSection title="Collision" hint="a convex hull of this part's shapes into the file's collision, riding the part">
					<div class="insp-hint flush">A convex hull of this part's shapes · run it again to replace it</div>
					<div class="insp-actions">
						<Button
							icon="shield"
							title="A convex hull of this part's shapes into the file's collision, riding the part; run again to replace it (fart hull does the same)"
							onClick={() => {
								if (hullOfPart(i)) md.collide.value = true;
								else project.error.value = `${p.name} has no volume to hull`;
							}}
						>
							Make hull
						</Button>
					</div>
				</InspectorSection>
			)}
			{!picked && (
				<>
					<InspectorSection title="Document">
						<Property label="Name">
							<TextField value={md.doc.value.name ?? ""} onChange={setDocName} onBlur={() => endGesture()} />
						</Property>
					</InspectorSection>
					<TexturesPanel
						api={{
							textures: texs,
							rel: md.path.value ?? "",
							add: addTexture,
							remove: deleteTexture,
							rename: renameTexture,
							cell: setTextureCell,
							map: setMap,
							addMap,
							removeMap: deleteMap,
							freshName,
						}}
					/>
					<InspectorSection
						title="Colours"
						hint="the file's colour slots: a shape names a slot"
						actions={
							<>
								{tok !== null && pal[tok] && (
									<button type="button" title="Delete colour (⌫)" aria-label="Delete colour" onClick={() => removeToken(tok)}>
										<Icon name="trash-2" size={14} />
									</button>
								)}
								<button type="button" title="New colour" aria-label="New colour" onClick={() => addToken(freshName("colour", md.tokens.value.map((t) => t.name)))}>
									<Icon name="plus" size={14} />
								</button>
							</>
						}
					>
						{pal.length === 0 && <div class="insp-hint flush">No colours yet</div>}
						{pal.map((t, k) => (
							<ColorRow
								key={k}
								name={ren?.kind === "token" && ren.index === k ? <InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} /> : t.name}
								color={cssColor(t.rgb)}
								hex={hexOf(t.rgb)}
								selected={tok === k}
								title="Click the swatch to edit the colour · double-click to rename"
								onClick={() => setTok(k)}
								onDoubleClick={() => (renaming.value = { kind: "token", index: k })}
								onSwatch={(e) => (setTok(k), setPicking({ i: k, x: e.clientX, y: e.clientY }))}
								onContextMenu={(e) => (
									setTok(k),
									menuAt(e, [
										{ label: "Rename", run: () => (renaming.value = { kind: "token", index: k }) },
										{ label: "Delete colour", keys: "⌫", danger: true, sep: true, run: () => removeToken(k) },
									])
								)}
								onDelete={() => removeToken(k)}
							/>
						))}
						{md.shared.value.length > 0 && (
							<Property label="Shared" title="colours this file takes from the palettes it names">
								<span class="ur-prop-val" title={md.shared.value.map((t) => t.name).join(", ")}>
									{md.shared.value.map((t) => t.name).join(", ")}
								</span>
							</Property>
						)}
					</InspectorSection>
				</>
			)}
			{picking && pal[picking.i] && <ColorPicker rgb={pal[picking.i].rgb} x={picking.x} y={picking.y} onChange={(rgb) => setTokenColor(picking.i, rgb)} onClose={() => setPicking(null)} />}
		</div>
	);
}

// ------------------------------------------------------------- the canvas

export function ModelCanvasView() {
	void md.rev.value;
	const issues = md.issues.value;
	return (
		<>
			<ModelCanvas />
			{issues.length > 0 && showIssues.value && (
				<div class="issues">
					{issues.slice(0, 8).map((i) => (
						<div class={["unknown", "reserved", "unresolved"].includes(i.code) ? "w" : "e"}>
							{i.code} {i.path}: {i.message}
						</div>
					))}
				</div>
			)}
		</>
	);
}

const PROJECT_VIEWS = ["front", "back", "left", "right", "top", "bottom"].filter((v) => v in VIEWS);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

async function writeViews(views: string[], outline: { color: string; w: number } | undefined) {
	try {
		const files = await busy("Projecting to 2D", () => projectViews(views, outline));
		if (files.length) logActivity(`Wrote ${files.map((f) => basename(f)).join(", ")}`, "download");
	} catch (e) {
		project.error.value = String(e).replace(/^Error: /, "");
	}
}

/** Which views to write, and the outline they are inked with. */
function ProjectSheet() {
	const names = md.tokens.value.map((t) => t.name);
	// a file with no colours yet still gets its ink: the projection adds the slot
	const colours = names.length ? names : ["ink"];
	const [views, setViews] = useState<Set<string>>(() => new Set(["left", "top"]));
	const [outline, setOutline] = useState(false);
	const [colour, setColour] = useState(() => colours.find((n) => n === "ink") ?? colours.find((n) => n === "outline") ?? colours[colours.length - 1]);
	const [width, setWidth] = useState(0.25);
	const stem = basename(md.path.value ?? "").replace(/\.fart$/, "");
	const chosen = PROJECT_VIEWS.filter((v) => views.has(v));
	const go = () => {
		closeSheet();
		void writeViews(chosen, outline ? { color: colour, w: width > 0 ? width : 0.25 } : undefined);
	};
	return (
		<Sheet
			title="Project to 2D"
			message="Write the 2D views a game draws, beside this file."
			onClose={closeSheet}
			footnote={chosen.length ? `${chosen.map((v) => `${stem}-${v}.fart`).join(", ")}` : "Tick at least one view."}
			actions={[
				{ label: "Cancel", onClick: closeSheet },
				{ label: "Project", primary: true, disabled: chosen.length === 0, onClick: go },
			]}
		>
			<div class="ur-tf-wrap">
				<span class="ur-tf-label">Views</span>
				<div class="model-views">
					{PROJECT_VIEWS.map((v) => (
						<Checkbox
							key={v}
							checked={views.has(v)}
							label={cap(v)}
							onChange={(on) => {
								const n = new Set(views);
								if (on) n.add(v);
								else n.delete(v);
								setViews(n);
							}}
						/>
					))}
				</div>
			</div>
			<div class="model-outline">
				<Checkbox checked={outline} label="Outline" title="Ink each view's silhouette in a colour of the palette" onChange={setOutline} />
				<Select value={colour} options={colours} disabled={!outline} title="The colour the outline is drawn in" onChange={setColour} />
				<NumberField value={width} min={0.01} step={0.05} suffix="wide" width={96} disabled={!outline} label="Outline width" title="How wide the outline is" onChange={setWidth} />
			</div>
		</Sheet>
	);
}

/** Project…: which views, then write them beside the model. */
export function askProject() {
	openSheet(() => <ProjectSheet />);
}
void ((_: StatePart3) => _);
