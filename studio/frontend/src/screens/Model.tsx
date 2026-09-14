// The model screen: a 3D file. The same four regions as the editor,
// with the model turned under the view on the canvas: parts, states and
// clips on the left, the inspector on the right, the timeline below when
// a clip is chosen.

import { useEffect } from "preact/hooks";
import { clipDuration3, cssColor, VIEWS, type Ease, type StatePart3 } from "@fastart/core";
import { I } from "../ui/Icons.tsx";
import { Num, Text } from "../ui/Field.tsx";
import { InlineName } from "../ui/Rename.tsx";
import { Gutter } from "../ui/Gutter.tsx";
import { Explorer, ExplorerButton } from "../ui/Explorer.tsx";
import { ThemeButton } from "../ui/ThemeMenu.tsx";
import { ChatPanel } from "../ui/ChatPanel.tsx";
import { ColorPicker } from "../ui/ColorPicker.tsx";
import { ModelCanvas } from "../canvas/ModelCanvas.tsx";
import { view } from "../canvas/view.ts";
import { explorer } from "../state/explorer.ts";
import { chat, toggleChat } from "../state/chat.ts";
import { project, goDocs, goBrowse } from "../state/project.ts";
import { renaming, openContextMenu } from "../state/menu.ts";
import { run } from "../state/commands.ts";
import { shell } from "../shell/shell.ts";
import { basename } from "../state/paths.ts";
import { useState } from "preact/hooks";
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
	deleteSel,
	addToken,
	deleteToken,
	renameToken,
	setTokenColor,
	setDocName,
	setView,
	setTurn,
	save,
	projectViews,
	hullOfPart,
	type Tool3,
} from "../state/model.ts";

const DEG = 180 / Math.PI;
const TOOLS: { tool: Tool3; label: string; key: string; icon: (p: { size?: number }) => preact.JSX.Element; makes: string }[] = [
	{ tool: "select", label: "Select", key: "V", icon: I.select, makes: "" },
	{ tool: "rect", label: "Box", key: "R", icon: I.rect, makes: "drag a rectangle in the view plane: a box, as deep as the depth field" },
	{ tool: "circle", label: "Ball", key: "O", icon: I.circle, makes: "drag from the centre: a ball" },
	{ tool: "line", label: "Rod", key: "L", icon: I.line, makes: "drag a line: a rod, half the depth wide" },
	{ tool: "poly", label: "Prism", key: "P", icon: I.poly, makes: "click a profile, close it: a prism, as deep as the depth field" },
];
const VIEW_NAMES = ["front", "back", "left", "right", "top", "bottom"];
const EASES: Ease[] = ["linear", "in", "out", "in-out", "step"];

function Hdr(props: { title: string; hint?: string; tail?: string }) {
	return (
		<div class="hdr" title={props.hint}>
			{props.title}
			{props.tail && <span class="hint">{props.tail}</span>}
		</div>
	);
}

// ------------------------------------------------------------- top

function ModelToolbar() {
	const tool = md.tool.value;
	const path = md.path.value ?? "";
	const dirty = md.dirty.value;
	const written = md.written.value;
	const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
	const preview = !!curClip();
	const vn = md.viewName.value;
	return (
		<div class="topbar">
			<ExplorerButton />
			<div class="group">
				{TOOLS.map((t) => (
					<button
						class={`tool ${tool === t.tool ? "active" : ""}`}
						disabled={preview && t.tool !== "select"}
						title={preview && t.tool !== "select" ? "a clip is a preview; pick a state to model" : `${t.label}  (${t.key})${t.makes ? " · " + t.makes : ""}`}
						onClick={() => run(`tool.${t.tool}`)}
					>
						<t.icon />
						<span class="lbl">{t.label}</span>
						<span class="key">{t.key}</span>
					</button>
				))}
			</div>
			<span class="sep" />
			<label class="field" title="how deep a new box, prism, ball or rod is, along the view axis">
				<span class="k">depth</span>
				<input class="num" type="number" step={0.5} min={0.1} value={md.thick.value} onInput={(e) => (md.thick.value = Math.max(0.1, Number((e.target as HTMLInputElement).value) || 0.1))} onKeyDown={(e) => e.stopPropagation()} />
			</label>
			<span class="sep" />
			<select class="num" title="the view: a turn laid on the model. Drag on nothing (or Alt-drag) to orbit" value={vn} onChange={(e) => setView((e.target as HTMLSelectElement).value)}>
				{vn === "" && <option value="">free</option>}
				{VIEW_NAMES.map((v) => (
					<option value={v}>{v}</option>
				))}
			</select>
			<button class={`btn ghost ${md.outline.value ? "active" : ""}`} title="show silhouettes, the way --outline projects them" onClick={() => run("model.outline")}>
				ink
			</button>
			<button class={`btn ${md.collide.value ? "active" : "ghost"}`} title="the collision solids as wireframes, posed with the frame  (C)" onClick={() => run("view.collision")}>
				<I.collision /> Collision
			</button>
			<button class={`btn ghost ${view.snapGrid.value ? "active" : ""}`} title="snap to grid  (⌘ ')" onClick={() => run("view.snapGrid")}>
				<I.grid />
			</button>
			<span class="sep" />
			<button class={`btn ${dirty ? "" : "ghost"}`} title="Save keeps this version as the checkpoint to revert to  (⌘ S)" onClick={() => void save()}>
				Save{dirty ? " •" : ""}
			</button>
			{path && (
				<span class="sub" title="every edit lands in the file itself within a moment; this is the last write">
					{written ? `on disk ${clock(written)}` : "on disk"}
				</span>
			)}
			<button class="btn ghost" title="write the 2D views a game draws, beside this file" onClick={() => run("model.project")}>
				Project…
			</button>
			{shell.chat && (
				<button class={`btn ghost ${chat.open.value ? "active" : ""}`} title="ask Claude to change this file  (⌘ J)" onClick={toggleChat}>
					Ask
				</button>
			)}
			<div class="spacer" />
			<span class="sub crumb" title={path}>
				{dirty && <span class="dot" />}
				<button class="link" title="back to the shelf  (⌘ O)" onClick={() => void goBrowse()}>
					{project.name.value || "shelf"}
				</button>
				<span class="slash">/</span>
				{basename(path)}
				<span class="chip" title="a 3D file: space 3d">3D</span>
			</span>
			<span class="sep" />
			<button class="btn ghost" title="the guide and the format  (?)" onClick={() => goDocs("guide")}>
				Docs
			</button>
			<ThemeButton />
		</div>
	);
}

// ------------------------------------------------------------- left

function partMenu(i: number) {
	const ps = parts();
	return [
		{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "part", index: i }) },
		{ label: "Set pivot", run: () => (md.pending.value = "pivot") },
		{ label: "Raise (paints later)", run: () => movePartInState(ps[i].name, true), sep: true },
		{ label: "Lower (paints earlier)", run: () => movePartInState(ps[i].name, false) },
		{ label: "Delete part", danger: true, sep: true, disabled: ps.length <= 1, run: () => deletePart(i) },
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
	const cur = md.curPart.value;
	const st = curState();
	const kids = childrenOf(p.name);
	const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
	const ren = renaming.value;
	const isRen = ren?.kind === "part" && ren.index === i;
	const preview = !!curClip();
	return (
		<>
			<div
				class={`layer ${i === cur ? "active" : ""} ${st && !member ? "off" : ""}`}
				style={{ paddingLeft: `${6 + depth * 14}px` }}
				onClick={() => (md.curPart.value = i)}
				onDblClick={() => (renaming.value = { kind: "part", index: i })}
				onContextMenu={(e) => {
					e.preventDefault();
					md.curPart.value = i;
					openContextMenu(e.clientX, e.clientY, partMenu(i));
				}}
			>
				{st && !preview ? (
					<span
						class={`check ${member ? "on" : ""}`}
						title={member ? "drawn in this state (click to leave it out)" : "not drawn in this state (click to add it)"}
						onClick={(e) => {
							e.stopPropagation();
							toggleMembership(md.curState.value, p.name);
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
				{p.like && <span class="chip">like {p.like}</span>}
				<span class="tail">
					<span class="chip" title="shapes">{p.like ? "" : (p.shapes ?? []).length}</span>
				</span>
			</div>
			{kids.map((k) => (
				<PartRow key={k.p.name} i={k.i} depth={depth + 1} />
			))}
		</>
	);
}

function LeftPanel() {
	void md.rev.value;
	void renaming.value;
	const sts = states();
	const cs = clips();
	const curS = md.curState.value;
	const curC = md.curClip.value;
	const ren = renaming.value;
	return (
		<div class="panel left">
			<Hdr title="Parts" hint="the parts of this model, children under their parents" />
			{childrenOf(undefined).map((k) => (
				<PartRow key={k.p.name} i={k.i} depth={0} />
			))}
			<button class="add-row" onClick={addPartNow}>
				<I.plus size={11} /> part
			</button>
			<Hdr title="States" hint="every view is a state: which parts show and where each sits. Shapes are modelled in whichever state you are looking at." />
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
				</div>
			))}
			<button class="add-row" onClick={() => addStateNow()} title="a new state, starting as a copy of this one">
				<I.plus size={11} /> state
			</button>
			<Hdr title="Clips" hint="animation: states in time. A clip is a preview here." />
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
				</div>
			))}
			<button class="add-row" onClick={addClipNow} disabled={sts.length === 0}>
				<I.plus size={11} /> clip
			</button>
		</div>
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

// ------------------------------------------------------------- bottom: the timeline

function ModelTimeline() {
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
		<div class="bottom">
			<div class="timeline">
				<button class="btn ghost" title="play / pause  (Space)" onClick={() => (md.playing.value = !playing)}>
					{playing ? <I.pause /> : <I.play />}
				</button>
				<input type="range" min={0} max={span} step={0.001} value={t} style="flex:1" onInput={(e) => seek(Number((e.target as HTMLInputElement).value))} onKeyDown={(e) => e.stopPropagation()} />
				<span class="sub">{t.toFixed(2)}s</span>
				<div class="group">
					{clip.keys.map((k, i) => (
						<button class={`btn small ${i === ki ? "active" : "ghost"}`} title={`key at ${k.t}s${k.state ? `: ${k.state}` : ""}`} onClick={() => (md.curKey.value = i, seek(k.t))}>
							{k.t}s
						</button>
					))}
				</div>
				<button class="btn small ghost" title="a key at the playhead, naming the current state" onClick={addKey}>
					<I.plus size={11} /> key
				</button>
				<label class="field" title="the clip wraps at its last key">
					<input type="checkbox" checked={!!clip.loop} onChange={(e) => setClipLoop(ci, (e.target as HTMLInputElement).checked)} /> loop
				</label>
				{key && (
					<>
						<Num label="t" value={key.t} min={0} step={0.05} onChange={(v) => setKeyTime(ki, v)} />
						<select class="num" value={key.state ?? ""} onChange={(e) => setKeyState(ki, (e.target as HTMLSelectElement).value)}>
							{states().map((s) => (
								<option value={s.name}>{s.name}</option>
							))}
						</select>
						<select class="num" value={key.ease ?? "linear"} onChange={(e) => setKeyEase(ki, (e.target as HTMLSelectElement).value as Ease)}>
							{EASES.map((e) => (
								<option value={e}>{e}</option>
							))}
						</select>
						<button class="btn x" title="delete key" disabled={clip.keys.length <= 1} onClick={() => deleteKey(ki)}>
							×
						</button>
					</>
				)}
			</div>
		</div>
	);
}

// ------------------------------------------------------------- right: the inspector

function TokenPick({ current, onPick }: { current: string | undefined; onPick: (t: string) => void }) {
	const [open, setOpen] = useState(false);
	const toks = md.tokens.value;
	const tk = toks.find((t) => t.name === current);
	return (
		<div class="popwrap">
			<button class="swatch-btn" onClick={() => setOpen(!open)} title="fill: a palette token">
				<span class="swatch" style={{ background: tk ? cssColor(tk.rgb) : "magenta" }} />
				<span class="name">{current ?? "—"}</span>
			</button>
			{open && (
				<div class="pick-pop">
					{toks.map((t) => (
						<div
							class={`row ${t.name === current ? "active" : ""}`}
							onClick={() => {
								onPick(t.name);
								setOpen(false);
							}}
						>
							<span class="swatch" style={{ background: cssColor(t.rgb) }} />
							<span class="name">{t.name}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function Inspector3() {
	void md.rev.value;
	const p = curPart();
	const i = md.curPart.value;
	const sp = poseOfCur();
	const sel = md.sel.value;
	const sh = selShape();
	const vert = md.vert.value;
	const preview = !!curClip();
	const [picking, setPicking] = useState<{ i: number; x: number; y: number } | null>(null);
	const ren = renaming.value;
	return (
		<div class="panel right">
			{sh && sel && (
				<>
					<Hdr title="Shape" hint="what is selected on the canvas" tail={sh.kind} />
					<div class="line">
						<span class="k">fill</span>
						<TokenPick current={sh.color} onPick={paintSel} />
					</div>
					<div class="fields">
						<Num label="shade" value={sh.shade ?? 1} min={0} onChange={(v) => setShapeNumber(sel, "shade", v)} title="lighting on the slot's colour, on top of the view's light" wide />
					</div>
					{sh.kind === "ball" && (
						<div class="fields">
							<Num label="x" value={sh.at[0]} onChange={(v) => setShapeCoord(sel, "at", 0, v)} />
							<Num label="y" value={sh.at[1]} onChange={(v) => setShapeCoord(sel, "at", 1, v)} />
							<Num label="z" value={sh.at[2]} onChange={(v) => setShapeCoord(sel, "at", 2, v)} />
							<Num label="r" value={sh.r} min={0} onChange={(v) => setShapeNumber(sel, "r", v)} />
						</div>
					)}
					{sh.kind === "rod" && (
						<div class="fields">
							<Num label="ax" value={sh.a[0]} onChange={(v) => setShapeCoord(sel, "a", 0, v)} />
							<Num label="ay" value={sh.a[1]} onChange={(v) => setShapeCoord(sel, "a", 1, v)} />
							<Num label="az" value={sh.a[2]} onChange={(v) => setShapeCoord(sel, "a", 2, v)} />
							<Num label="bx" value={sh.b[0]} onChange={(v) => setShapeCoord(sel, "b", 0, v)} />
							<Num label="by" value={sh.b[1]} onChange={(v) => setShapeCoord(sel, "b", 1, v)} />
							<Num label="bz" value={sh.b[2]} onChange={(v) => setShapeCoord(sel, "b", 2, v)} />
							<Num label="width" value={sh.w} min={0} onChange={(v) => setShapeNumber(sel, "w", v)} wide />
						</div>
					)}
					{sh.kind === "mesh" && (
						<div class="line" title="drag a corner on the canvas along the view plane; the fields move it on any axis">
							<span class="k">corners</span>
							<span>
								{sh.points.length} · {sh.faces.length} faces
							</span>
						</div>
					)}
					{sh.kind === "mesh" && vert !== null && sh.points[vert] && (
						<div class="fields">
							<Num label="x" value={sh.points[vert][0]} onChange={(v) => setVertexAxis(sel, vert, 0, v)} />
							<Num label="y" value={sh.points[vert][1]} onChange={(v) => setVertexAxis(sel, vert, 1, v)} />
							<Num label="z" value={sh.points[vert][2]} onChange={(v) => setVertexAxis(sel, vert, 2, v)} />
						</div>
					)}
					<div class="line" style="margin-top:8px;gap:6px">
						<button class="btn small ghost" title="a copy reflected across x = 0" onClick={() => run("model.mirror")}>
							mirror
						</button>
						<button class="btn small ghost" title="duplicate  (⌘ D)" onClick={() => run("edit.duplicate")}>
							duplicate
						</button>
						<button class="btn small ghost" style="color:var(--danger)" onClick={deleteSel}>
							{vert !== null && sh.kind === "mesh" ? "delete corner" : "delete"}
						</button>
					</div>
				</>
			)}
			{p && (
				<>
					<Hdr title="Part" hint="a part: the unit that poses" tail={p.name} />
					<div class="line">
						<span class="k">name</span>
						{ren?.kind === "part" && ren.index === i ? (
							<InlineName value={p.name} onCommit={(n) => (renamePart(i, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
						) : (
							<button class="link" onClick={() => (renaming.value = { kind: "part", index: i })}>
								{p.name}
							</button>
						)}
					</div>
					<div class="fields">
						<Num label="pivot x" value={(p.pivot ?? [0, 0, 0])[0]} onChange={(v) => setPivotAxis(i, 0, v)} />
						<Num label="y" value={(p.pivot ?? [0, 0, 0])[1]} onChange={(v) => setPivotAxis(i, 1, v)} />
						<Num label="z" value={(p.pivot ?? [0, 0, 0])[2]} onChange={(v) => setPivotAxis(i, 2, v)} />
					</div>
					<div class="line">
						<span class="k">parent</span>
						<select class="num" value={p.parent ?? ""} onChange={(e) => setParent(i, (e.target as HTMLSelectElement).value)}>
							<option value="">none</option>
							{parentCandidates(i).map((n) => (
								<option value={n}>{n}</option>
							))}
						</select>
					</div>
					<div class="line" title="drawn like another part: its shapes, this part's pivot and pose">
						<span class="k">drawn like</span>
						<select class="num" value={p.like ?? ""} onChange={(e) => setLike(i, (e.target as HTMLSelectElement).value)}>
							<option value="">itself</option>
							{parts()
								.filter((q) => q !== p && !q.like)
								.map((q) => (
									<option value={q.name}>{q.name}</option>
								))}
						</select>
					</div>
					<div class="line" style="gap:6px">
						<button class="btn small ghost" title="click the canvas to place the pivot" onClick={() => (md.pending.value = "pivot")}>
							set pivot
						</button>
						<button
							class="btn small ghost"
							title="a convex hull of this part's shapes into the file's collision, riding the part; run again to replace it (fart hull does the same)"
							onClick={() => {
								if (hullOfPart(i)) md.collide.value = true;
								else project.error.value = `${p.name} has no volume to hull`;
							}}
						>
							hull
						</button>
					</div>
				</>
			)}
			{p && sp && !preview && (
				<>
					<Hdr title={`In ${curState()?.name ?? "state"}`} hint="where the part's pivot lands, its turn about x, y and z (degrees), its size" />
					<div class="fields">
						<Num label="x" value={(sp.offset ?? p.pivot ?? [0, 0, 0])[0]} onChange={(v) => setPose(sp, { offset: [v, (sp.offset ?? p.pivot ?? [0, 0, 0])[1], (sp.offset ?? p.pivot ?? [0, 0, 0])[2]] }, "pose-x")} />
						<Num label="y" value={(sp.offset ?? p.pivot ?? [0, 0, 0])[1]} onChange={(v) => setPose(sp, { offset: [(sp.offset ?? p.pivot ?? [0, 0, 0])[0], v, (sp.offset ?? p.pivot ?? [0, 0, 0])[2]] }, "pose-y")} />
						<Num label="z" value={(sp.offset ?? p.pivot ?? [0, 0, 0])[2]} onChange={(v) => setPose(sp, { offset: [(sp.offset ?? p.pivot ?? [0, 0, 0])[0], (sp.offset ?? p.pivot ?? [0, 0, 0])[1], v] }, "pose-z")} />
					</div>
					<div class="fields">
						{([0, 1, 2] as const).map((ax) => (
							<Num
								label={`turn ${"xyz"[ax]}°`}
								value={((sp.rotate ?? [0, 0, 0])[ax] ?? 0) * DEG}
								step={5}
								onChange={(v) => {
									const r = [...(sp.rotate ?? [0, 0, 0])] as [number, number, number];
									r[ax] = v / DEG;
									setPose(sp, { rotate: r }, `pose-rot-${ax}`);
								}}
							/>
						))}
					</div>
					<div class="fields">
						<Num label="size" value={sp.scale ?? 1} min={0} step={0.05} onChange={(v) => setPose(sp, { scale: v }, "pose-size")} />
						<label class="field" title="flipped across x about the pivot, before the turn">
							<span class="k">mirror</span>
							<input type="checkbox" checked={!!sp.mirror} onChange={(e) => setPose(sp, { mirror: (e.target as HTMLInputElement).checked })} />
						</label>
					</div>
					<div class="line" style="gap:6px">
						<button class="btn small ghost" onClick={() => resetPose(sp)}>
							reset
						</button>
						<button class="btn small ghost" onClick={() => toggleMembership(md.curState.value, p.name)}>
							leave out of this state
						</button>
					</div>
				</>
			)}
			{p && !sp && !preview && curState() && (
				<div class="line" style="gap:6px">
					<span class="k">not in this state</span>
					<button class="btn small ghost" onClick={() => toggleMembership(md.curState.value, p.name)}>
						add
					</button>
				</div>
			)}
			<Hdr title="View" hint="a turn laid on the model before it is drawn; the light is in view space" />
			<div class="fields">
				{([0, 1, 2] as const).map((ax) => (
					<Num
						label={`${"xyz"[ax]}°`}
						value={md.turn.value[ax] * DEG}
						step={15}
						onChange={(v) => {
							const t = [...md.turn.value] as [number, number, number];
							t[ax] = v / DEG;
							setTurn(t);
						}}
					/>
				))}
			</div>
			<div class="line" style="gap:4px;flex-wrap:wrap">
				{Object.keys(VIEWS)
					.filter((v) => v !== "side")
					.map((v) => (
						<button class={`btn small ${md.viewName.value === v ? "active" : "ghost"}`} onClick={() => setView(v)}>
							{v}
						</button>
					))}
			</div>
			<div class="fields">
				<Num label="ambient" value={md.ambient.value} min={0} max={1} step={0.05} onChange={(v) => (md.ambient.value = Math.max(0, Math.min(1, v)))} wide />
			</div>
			<Hdr title="Document" />
			<Text label="name" value={md.doc.value.name ?? ""} onChange={setDocName} />
			<Hdr title="Colours" hint="the file's colour slots: a shape names a slot" />
			{palette().map((t, k) => (
				<div class="row" onContextMenu={(e) => (e.preventDefault(), openContextMenu(e.clientX, e.clientY, [{ label: "Rename", run: () => (renaming.value = { kind: "token", index: k }) }, { label: "Delete colour", danger: true, run: () => deleteToken(k) }]))}>
					<span class="swatch" style={{ background: cssColor(t.rgb) }} onClick={(e) => setPicking({ i: k, x: e.clientX, y: e.clientY })} title="edit the colour" />
					{ren?.kind === "token" && ren.index === k ? (
						<InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
					) : (
						<span class="name" onDblClick={() => (renaming.value = { kind: "token", index: k })}>
							{t.name}
						</span>
					)}
				</div>
			))}
			<button class="add-row" onClick={() => addToken(freshName("colour", md.tokens.value.map((t) => t.name)))}>
				<I.plus size={11} /> colour
			</button>
			{md.shared.value.length > 0 && (
				<div class="line">
					<span class="k">shared</span>
					<span class="sub">{md.shared.value.map((t) => t.name).join(", ")}</span>
				</div>
			)}
			{picking && palette()[picking.i] && (
				<ColorPicker rgb={palette()[picking.i].rgb} x={picking.x} y={picking.y} onChange={(rgb) => setTokenColor(picking.i, rgb)} onClose={() => setPicking(null)} />
			)}
		</div>
	);
}

// ------------------------------------------------------------- the screen

export function Model() {
	void md.rev.value;
	const st = curState();
	const clip = curClip();
	const tool = md.tool.value;
	const hint = clip
		? `previewing "${clip.name}" · Space plays · keys name states, pose those to change a key`
		: md.pending.value === "pivot"
			? "click the canvas to place the pivot"
			: tool === "poly"
				? "click a profile in the view plane · click the first point or press Enter to close it into a prism · Esc drops it"
				: tool !== "select"
					? `${TOOLS.find((t) => t.tool === tool)?.makes ?? ""}`
					: st
						? `state "${st.name}" · drag a shape or a corner along the view plane · the ⌖ moves the part, the lever turns it about the view axis · drag on nothing to orbit`
						: "";
	const chatRight = chat.open.value && chat.dock.value === "right";
	const chatBelow = chat.open.value && chat.dock.value === "bottom";
	const issues = md.issues.value;
	return (
		<div class="app">
			<ModelToolbar />
			<div class={`editor ${explorer.open.value ? "" : "no-explorer"} ${chatRight ? "chat-right" : ""}`}>
				<Explorer />
				<div class="dock">
					<LeftPanel />
					<Gutter k="left" edge="right" />
				</div>
				<div class="canvas-col">
					<div class="canvas-wrap">
						<ModelCanvas />
						<div class="hud">
							{hint}
							{` · view ${md.viewName.value || "free"} · zoom ${view.zoom.value.toFixed(1)}×${view.snapGrid.value ? " · grid snap" : ""}`}
						</div>
						{issues.length > 0 && (
							<div class="issues">
								{issues.slice(0, 8).map((i) => (
									<div class={["unknown", "reserved", "unresolved"].includes(i.code) ? "w" : "e"}>
										{i.code} {i.path}: {i.message}
									</div>
								))}
							</div>
						)}
					</div>
					<ModelTimeline />
				</div>
				<div class="dock">
					<Inspector3 />
					<Gutter k="right" edge="left" />
				</div>
				{chatRight && <ChatPanel />}
			</div>
			{chatBelow && <ChatPanel />}
		</div>
	);
}

/** Project…: which views, then write them beside the model. */
export async function askProject() {
	const { ask } = await import("../state/prompt.ts");
	const answer = await ask("Views to write (front back left right top bottom), and an outline token as ink:0.25 if you like", "left top");
	if (!answer) return;
	const words = answer.split(/[\s,]+/).filter(Boolean);
	const views = words.filter((w) => w in VIEWS);
	const ink = words.find((w) => !(w in VIEWS));
	const outline = ink ? { color: ink.split(":")[0], w: Number(ink.split(":")[1] ?? 0.25) || 0.25 } : undefined;
	if (!views.length) {
		project.error.value = "no view named; try: left top";
		return;
	}
	const files = await projectViews(views, outline);
	project.error.value = `wrote ${files.map((f) => basename(f)).join(", ")}`;
}
void ((_: StatePart3) => _);
