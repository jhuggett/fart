// The scene screen: a .shart. The tree of nodes on the left, the scene
// on the canvas (2D painted, 3D through the solids), the chosen node's
// fields on the right, a clock for clips below.

import { useEffect, useState } from "preact/hooks";
import { VIEWS, type SceneNode } from "@fastart/core";
import { I } from "../ui/Icons.tsx";
import { Num, Text } from "../ui/Field.tsx";
import { InlineName } from "../ui/Rename.tsx";
import { Gutter } from "../ui/Gutter.tsx";
import { Explorer, ExplorerButton } from "../ui/Explorer.tsx";
import { ThemeButton } from "../ui/ThemeMenu.tsx";
import { SceneCanvas } from "../canvas/SceneCanvas.tsx";
import { view } from "../canvas/view.ts";
import { explorer } from "../state/explorer.ts";
import { project, goDocs, goBrowse, paletteFiles } from "../state/project.ts";
import { openContextMenu } from "../state/menu.ts";
import { run } from "../state/commands.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { sc, scene, is3d, nodeAt, parentPath, setNode, renameNode, addNode, deleteNode, duplicateNode, moveNode, setSceneName, addPaletteRef, removePaletteRef, placeable, refDoc, anchorsOfDoc, setView, setTurn, save } from "../state/scene.ts";

const DEG = 180 / Math.PI;
const VIEW_NAMES = ["front", "back", "left", "right", "top", "bottom"];

function Hdr(props: { title: string; hint?: string; tail?: string }) {
	return (
		<div class="hdr" title={props.hint}>
			{props.title}
			{props.tail && <span class="hint">{props.tail}</span>}
		</div>
	);
}

function Toolbar() {
	const path = sc.path.value ?? "";
	const dirty = sc.dirty.value;
	const written = sc.written.value;
	const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
	const vn = sc.viewName.value;
	const options = placeable();
	return (
		<div class="topbar">
			<ExplorerButton />
			<div class="group">
				<button class="btn ghost" title="place a file of the project as a node (under the chosen node, or at the root)" disabled={!options.length} onClick={() => run("scene.addInstance")}>
					<I.plus size={11} /> instance
				</button>
				<button class="btn ghost" title="a group: a frame for children, nothing drawn" onClick={() => run("scene.addGroup")}>
					<I.plus size={11} /> group
				</button>
			</div>
			<span class="sep" />
			{is3d() && (
				<select class="num" title="the view: a turn laid on the scene. Drag on nothing to orbit" value={vn} onChange={(e) => setView((e.target as HTMLSelectElement).value)}>
					{vn === "" && <option value="">free</option>}
					{VIEW_NAMES.map((v) => (
						<option value={v}>{v}</option>
					))}
				</select>
			)}
			<button class="btn ghost" title="play the clips  (Space)" onClick={() => (sc.playing.value = !sc.playing.value)}>
				{sc.playing.value ? <I.pause /> : <I.play />}
			</button>
			<span class="sub">{sc.time.value.toFixed(2)}s</span>
			<button class="btn small ghost" title="back to the start" onClick={() => (sc.time.value = 0)}>
				0
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
			<div class="spacer" />
			{sc.issues.value.length > 0 && (
				<span class="sub" style={sc.issues.value.some((i) => !["unknown", "unresolved"].includes(i.code)) ? "color:var(--danger)" : ""} title={sc.issues.value.map((i) => `${i.code} ${i.path}: ${i.message}`).join("\n")}>
					{sc.issues.value.length} note{sc.issues.value.length === 1 ? "" : "s"}
				</span>
			)}
			<span class="sub crumb" title={path}>
				{dirty && <span class="dot" />}
				<button class="link" title="back to the shelf  (⌘ O)" onClick={() => void goBrowse()}>
					{project.name.value || "shelf"}
				</button>
				<span class="slash">/</span>
				{basename(path)}
				<span class="chip" title="a scene: a Scene Hierarchy of Art">{is3d() ? "3D scene" : "scene"}</span>
			</span>
			<span class="sep" />
			<button class="btn ghost" title="the guide and the format  (?)" onClick={() => goDocs("guide")}>
				Docs
			</button>
			<ThemeButton />
		</div>
	);
}

function NodeRow({ node, path, depth }: { node: SceneNode; path: string; depth: number }) {
	const [ren, setRen] = useState(false);
	const cur = sc.sel.value;
	const kind = node.ref ? (node.ref.endsWith(".shart") ? "scene" : stripExt(basename(node.ref))) : "group";
	return (
		<>
			<div
				class={`layer ${path === cur ? "active" : ""}`}
				style={{ paddingLeft: `${6 + depth * 14}px` }}
				onClick={() => (sc.sel.value = path)}
				onDblClick={() => setRen(true)}
				onContextMenu={(e) => {
					e.preventDefault();
					sc.sel.value = path;
					openContextMenu(e.clientX, e.clientY, [
						{ label: "Rename", keys: "Enter", run: () => setRen(true) },
						{ label: "Add instance under", run: () => run("scene.addInstance") },
						{ label: "Add group under", run: () => run("scene.addGroup") },
						{ label: "Duplicate", run: () => duplicateNode(path), sep: true },
						{ label: "Raise (paints later)", run: () => moveNode(path, true) },
						{ label: "Lower (paints earlier)", run: () => moveNode(path, false) },
						{ label: "Delete", danger: true, sep: true, run: () => deleteNode(path) },
					]);
				}}
			>
				<span class="glyph">{node.children?.length ? "▾" : "·"}</span>
				{ren ? (
					<InlineName
						value={node.name}
						onCommit={(n) => {
							renameNode(path, n);
							setRen(false);
						}}
						onCancel={() => setRen(false)}
					/>
				) : (
					<span class="name">{node.name}</span>
				)}
				<span class="chip" title={node.ref ?? "a group"}>
					{kind}
				</span>
				{node.clip && <span class="chip">{node.clip}</span>}
				{node.attach && <span class="chip" title={`hangs from ${node.attach.to}`}>⚓</span>}
			</div>
			{(node.children ?? []).map((c) => (
				<NodeRow key={c.name} node={c} path={`${path}/${c.name}`} depth={depth + 1} />
			))}
		</>
	);
}

function LeftPanel() {
	void sc.rev.value;
	const s = scene();
	return (
		<div class="panel left">
			<Hdr title="Nodes" hint="the scene's tree: instances of files, placed scenes, groups; children ride their parents. List order is paint order in 2D." />
			{(s.nodes ?? []).map((n) => (
				<NodeRow key={n.name} node={n} path={n.name} depth={0} />
			))}
			<button class="add-row" onClick={() => run("scene.addInstance")}>
				<I.plus size={11} /> instance
			</button>
			<button class="add-row" onClick={() => run("scene.addGroup")}>
				<I.plus size={11} /> group
			</button>
		</div>
	);
}

function Inspector() {
	void sc.rev.value;
	const path = sc.sel.value;
	const n = nodeAt(path);
	const d3 = is3d();
	const doc = refDoc(path);
	const parent = path ? nodeAt(parentPath(path)) : undefined;
	const parentDoc = path && parentPath(path) ? refDoc(parentPath(path)) : null;
	const options = placeable();
	const pals = paletteFiles();
	const rel = sc.path.value ?? "";
	const at = (n?.at ?? (d3 ? [0, 0, 0] : [0, 0])) as number[];
	const rot = d3 ? ((Array.isArray(n?.rotate) ? n!.rotate : [0, 0, 0]) as number[]) : [typeof n?.rotate === "number" ? n.rotate : 0];
	return (
		<div class="panel right">
			{n && path && (
				<>
					<Hdr title="Node" hint="a placed thing, or a group" tail={n.ref ? (n.ref.endsWith(".shart") ? "scene" : "instance") : "group"} />
					<Text label="name" value={n.name} onChange={(v) => renameNode(path, v)} />
					<div class="line" title="the file this node places; a scene places the whole of another scene">
						<span class="k">file</span>
						<select class="num" value={n.ref ?? ""} onChange={(e) => setNode(path, { ref: (e.target as HTMLSelectElement).value, state: undefined, clip: undefined, attach: undefined })}>
							<option value="">none (a group)</option>
							{n.ref && !options.some((o) => o.rel === n.ref) && <option value={n.ref}>{n.ref}</option>}
							{options.map((o) => (
								<option value={o.rel}>{o.label}</option>
							))}
						</select>
					</div>
					<div class="fields" title="where the file's origin lands, in the parent's frame">
						<Num label="x" value={at[0]} onChange={(v) => setNode(path, { at: d3 ? [v, at[1], at[2] ?? 0] : [v, at[1]] }, "at-x")} />
						<Num label="y" value={at[1]} onChange={(v) => setNode(path, { at: d3 ? [at[0], v, at[2] ?? 0] : [at[0], v] }, "at-y")} />
						{d3 && <Num label="z" value={at[2] ?? 0} onChange={(v) => setNode(path, { at: [at[0], at[1], v] }, "at-z")} />}
					</div>
					<div class="fields">
						{d3 ? (
							([0, 1, 2] as const).map((ax) => (
								<Num
									label={`turn ${"xyz"[ax]}°`}
									value={rot[ax] * DEG}
									step={5}
									onChange={(v) => {
										const r = [...rot] as [number, number, number];
										r[ax] = v / DEG;
										setNode(path, { rotate: r }, `rot-${ax}`);
									}}
								/>
							))
						) : (
							<Num label="turn°" value={rot[0] * DEG} step={5} onChange={(v) => setNode(path, { rotate: v / DEG }, "rot")} />
						)}
						<Num label="size" value={n.scale ?? 1} min={0} step={0.05} onChange={(v) => setNode(path, { scale: v }, "scale")} />
						<label class="field" title="flipped across x">
							<span class="k">mirror</span>
							<input type="checkbox" checked={!!n.mirror} onChange={(e) => setNode(path, { mirror: (e.target as HTMLInputElement).checked })} />
						</label>
					</div>
					{doc && (
						<>
							<div class="line" title="what the instance shows: a state, or a clip at a time">
								<span class="k">shows</span>
								<select
									class="num"
									value={n.clip ? `clip:${n.clip}` : n.state ? `state:${n.state}` : ""}
									onChange={(e) => {
										const v = (e.target as HTMLSelectElement).value;
										if (v.startsWith("clip:")) setNode(path, { clip: v.slice(5), state: undefined });
										else if (v.startsWith("state:")) setNode(path, { state: v.slice(6), clip: undefined, t: undefined });
										else setNode(path, { state: undefined, clip: undefined, t: undefined });
									}}
								>
									<option value="">first state</option>
									{(doc.states ?? []).map((s) => (
										<option value={`state:${s.name}`}>state {s.name}</option>
									))}
									{(doc.clips ?? []).map((c) => (
										<option value={`clip:${c.name}`}>clip {c.name}</option>
									))}
								</select>
							</div>
							{n.clip && (
								<div class="fields">
									<Num label="t" value={n.t ?? 0} min={0} step={0.05} onChange={(v) => setNode(path, { t: v }, "t")} title="where the clip starts, seconds" />
								</div>
							)}
						</>
					)}
					{n.ref && (
						<div class="line" title="a palette laid over this instance's colours">
							<span class="k">palette</span>
							<select class="num" value={n.palette ?? ""} onChange={(e) => setNode(path, { palette: (e.target as HTMLSelectElement).value })}>
								<option value="">none</option>
								{n.palette && !pals.some((p) => relOf(rel, p) === n.palette) && <option value={n.palette}>{n.palette}</option>}
								{pals.map((p) => (
									<option value={relOf(rel, p)}>{stripExt(basename(p))}</option>
								))}
							</select>
						</div>
					)}
					{parent?.ref && parentDoc && n.ref && !n.ref.endsWith(".shart") && (
						<div class="line" title="hang this node from a socket of the parent's art: positions matched, directions too">
							<span class="k">hangs from</span>
							<select class="num" value={n.attach?.to ?? ""} onChange={(e) => setNode(path, { attach: (e.target as HTMLSelectElement).value ? { to: (e.target as HTMLSelectElement).value, ...(n.attach?.by ? { by: n.attach.by } : {}) } : undefined })}>
								<option value="">the parent's origin</option>
								{anchorsOfDoc(parentDoc).map((a) => (
									<option value={a}>{a}</option>
								))}
							</select>
							{n.attach && (
								<select class="num" value={n.attach.by ?? ""} title="by this art's own anchor; none: its origin" onChange={(e) => setNode(path, { attach: { to: n.attach!.to, ...((e.target as HTMLSelectElement).value ? { by: (e.target as HTMLSelectElement).value } : {}) } })}>
									<option value="">by its origin</option>
									{anchorsOfDoc(doc).map((a) => (
										<option value={a}>by {a}</option>
									))}
								</select>
							)}
						</div>
					)}
					<div class="line" style="margin-top:8px;gap:6px">
						<button class="btn small ghost" onClick={() => duplicateNode(path)}>
							duplicate
						</button>
						<button class="btn small ghost" title="paints later (2D)" onClick={() => moveNode(path, true)}>
							raise
						</button>
						<button class="btn small ghost" title="paints earlier (2D)" onClick={() => moveNode(path, false)}>
							lower
						</button>
						<button class="btn small ghost" style="color:var(--danger)" onClick={() => deleteNode(path)}>
							delete
						</button>
					</div>
				</>
			)}
			{d3 && (
				<>
					<Hdr title="View" hint="a turn laid on the scene before it is drawn" />
					<div class="fields">
						{([0, 1, 2] as const).map((ax) => (
							<Num
								label={`${"xyz"[ax]}°`}
								value={sc.turn.value[ax] * DEG}
								step={15}
								onChange={(v) => {
									const t = [...sc.turn.value] as [number, number, number];
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
								<button class={`btn small ${sc.viewName.value === v ? "active" : "ghost"}`} onClick={() => setView(v)}>
									{v}
								</button>
							))}
					</div>
				</>
			)}
			<Hdr title="Scene" hint="the file itself" />
			<Text label="name" value={scene().name ?? ""} onChange={setSceneName} />
			<div class="line" title="palettes laid over every instance, in order; later ones win">
				<span class="k">palettes</span>
			</div>
			{(scene().palette_refs ?? []).map((r, i) => (
				<div class="row">
					<span class="name">{r}</span>
					<span class="tail">
						<button class="btn x" onClick={() => removePaletteRef(i)}>
							×
						</button>
					</span>
				</div>
			))}
			<select
				class="num"
				value=""
				onChange={(e) => {
					const v = (e.target as HTMLSelectElement).value;
					if (v) addPaletteRef(v);
				}}
			>
				<option value="">+ palette…</option>
				{pals.map((p) => (
					<option value={relOf(rel, p)}>{stripExt(basename(p))}</option>
				))}
			</select>
		</div>
	);
}

function relOf(sceneRel: string, file: string): string {
	const a = dirname(sceneRel) ? dirname(sceneRel).split("/") : [];
	const b = file.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

export function SceneScreen() {
	void sc.rev.value;
	const playing = sc.playing.value;
	useEffect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			sc.time.value += (now - last) / 1000;
			last = now;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing]);
	const hint = sc.sel.value
		? `node "${sc.sel.value}" · drag it to move it · its fields on the right${is3d() ? " · drag on nothing to orbit" : ""}`
		: `a scene · click an instance to choose its node · + instance places a file of the project${is3d() ? " · drag on nothing to orbit" : ""}`;
	return (
		<div class="app">
			<Toolbar />
			<div class={`editor ${explorer.open.value ? "" : "no-explorer"}`}>
				<Explorer />
				<div class="dock">
					<LeftPanel />
					<Gutter k="left" edge="right" />
				</div>
				<div class="canvas-col">
					<div class="canvas-wrap">
						<SceneCanvas />
						<div class="hud">
							{hint}
							{` · zoom ${view.zoom.value.toFixed(1)}×`}
						</div>
					</div>
				</div>
				<div class="dock">
					<Inspector />
					<Gutter k="right" edge="left" />
				</div>
			</div>
		</div>
	);
}

/** + instance: pick a file of the project, place it under the chosen node. */
export async function askInstance() {
	const options = placeable();
	if (!options.length) {
		project.error.value = "nothing to place: the project has no files of this scene's space";
		return;
	}
	const { ask } = await import("../state/prompt.ts");
	const answer = await ask(`Place which file? (${options.map((o) => o.label).join(", ")})`, options[0].label);
	if (!answer) return;
	const pick = options.find((o) => o.label === answer.trim() || o.rel === answer.trim() || stripExt(basename(o.label)) === answer.trim());
	if (!pick) {
		project.error.value = `no file "${answer}" to place`;
		return;
	}
	const parent = sc.sel.value && nodeAt(sc.sel.value) && !nodeAt(sc.sel.value)!.ref?.endsWith(".shart") ? sc.sel.value : null;
	addNode(parent, { ref: pick.rel }, stripExt(basename(pick.label)));
}
export function addGroupNow() {
	const parent = sc.sel.value && nodeAt(sc.sel.value) && !nodeAt(sc.sel.value)!.ref?.endsWith(".shart") ? sc.sel.value : null;
	addNode(parent, {}, "group");
}
