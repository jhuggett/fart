// The scene screen's parts of the workspace: a .shart. The tree of nodes
// for the sidebar, the scene on the canvas (2D painted, 3D through the
// solids) with a clock in the floating bar, the chosen node's fields in
// the inspector. The frame is screens/Workspace.tsx.

import { useEffect, useState } from "preact/hooks";
import { VIEWS, type SceneNode } from "@fastart/core";
import { InlineName } from "../ui/Rename.tsx";
import { SceneCanvas } from "../canvas/SceneCanvas.tsx";
import { project, paletteFiles } from "../state/project.ts";
import { ToolBar, Transport, gridMode } from "../ui/Tools.tsx";
import { gizmoStatus } from "../canvas/gizmo3.ts";
import { selectedNodes } from "../state/scene.ts";
import { Button, Checkbox, GroupHeader, Icon, InspectorSection, NumberField, Property, SegmentedControl, Select, SidebarRow, TextField, type IconName } from "../ui/ur.tsx";
import { menuAt, openMenuBelow, type MenuItem } from "../state/menu.ts";
import { sidebar } from "../state/sidebar.ts";
import { run } from "../state/commands.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { shell } from "../shell/shell.ts";
import { sc, scene, is3d, nodeAt, parentPath, setNode, renameNode, addNode, deleteNode, duplicateNode, moveNode, setSceneName, addPaletteRef, removePaletteRef, placeable, refDoc, anchorsOfDoc, setView, setTurn, endGesture } from "../state/scene.ts";

const DEG = 180 / Math.PI;

/** The status bar's line. */
export function sceneStatus(): string {
	const moving = gizmoStatus();
	if (moving) return moving;
	const many = selectedNodes().length;
	if (many > 1) return `${many} nodes · Drag them to move them · G T S move, turn and size by key · ⌫ deletes them`;
	const orbit = is3d() ? ` · ${sc.viewName.value || "free"} · middle-drag orbits` : "";
	return sc.sel.value ? `${sc.sel.value} · Arrows move along an axis, rings turn · G T S move, turn and size by key${orbit}` : `Click an instance to choose its node · + places a file of the project${orbit}`;
}

/** The path bar's right side: the scene's clock, which every clip reads. */
export function SceneTools() {
	void sc.rev.value;
	return (
		<>
			<ToolBar tools={[]} current="" modes={[gridMode()]} />
			<span class="ur-pathbar-sep" />
			<Transport name="the scene's clips" playing={sc.playing.value} onPlay={() => run("clip.play")} onRewind={() => (sc.time.value = 0)} readout={`${sc.time.value.toFixed(2)}s`} progress={0} />
		</>
	);
}

const CAMERAS = Object.keys(VIEWS).filter((v) => v !== "side");

/** The View tab's own section: the camera laid on a 3D scene. */
export function SceneView() {
	void sc.rev.value;
	if (!is3d()) return null;
	return (
		<InspectorSection title="Camera" hint="a turn laid on the scene before it is drawn">
			<div class="insp-wrap">
				<SegmentedControl options={CAMERAS.slice(0, 3)} value={sc.viewName.value} onChange={setView} label="Camera" />
				<SegmentedControl options={CAMERAS.slice(3)} value={sc.viewName.value} onChange={setView} label="Camera" />
			</div>
			<Property label="Angle" layout="trio">
				{([0, 1, 2] as const).map((ax) => (
					<NumberField
						axis={(["x", "y", "z"] as const)[ax]}
						value={Math.round(sc.turn.value[ax] * DEG * 100) / 100}
						step={15}
						suffix="°"
						stepper={false}
						onChange={(v) => {
							const t = [...sc.turn.value] as [number, number, number];
							t[ax] = v / DEG;
							setTurn(t);
						}}
					/>
				))}
			</Property>
		</InspectorSection>
	);
}

function NodeRow({ node, path, depth }: { node: SceneNode; path: string; depth: number }) {
	const [ren, setRen] = useState(false);
	const [open, setOpen] = useState(true);
	const kids = node.children ?? [];
	const placed = !!node.ref?.endsWith(".shart");
	const icon: IconName = !node.ref ? "group" : placed ? "layout-template" : is3d() ? "box" : "image";
	const stem = node.ref ? stripExt(basename(node.ref)) : "";
	const what = !node.ref ? "A group" : `${placed ? "Places the scene" : "An instance of"} ${node.ref}`;
	return (
		<>
			<SidebarRow
				label={
					ren ? (
						<InlineName
							value={node.name}
							onCommit={(n) => {
								renameNode(path, n);
								setRen(false);
							}}
							onCancel={() => setRen(false)}
						/>
					) : (
						node.name
					)
				}
				icon={icon}
				depth={depth}
				expandable={kids.length > 0}
				open={open}
				onToggle={() => setOpen(!open)}
				selected={path === sc.sel.value}
				inactive={sidebar.focus.value !== "nav"}
				title={`${what}${node.clip ? ` · plays ${node.clip}` : ""}${node.attach ? ` · hangs from ${node.attach.to}` : ""}`}
				chip={node.clip ?? (stem && stem !== node.name ? stem : undefined)}
				link={node.attach?.to}
				onClick={() => (sc.sel.value = path)}
				onDoubleClick={() => setRen(true)}
				onDelete={() => deleteNode(path)}
				onContextMenu={(e) => {
					sc.sel.value = path;
					menuAt(e, [
						{ label: "Rename", keys: "↩", run: () => setRen(true) },
						{ label: "Add instance under…", run: () => run("scene.addInstance") },
						{ label: "Add group under", run: () => run("scene.addGroup") },
						{ label: "Duplicate", run: () => duplicateNode(path), sep: true },
						{ label: "Raise (paints later)", run: () => moveNode(path, true) },
						{ label: "Lower (paints earlier)", run: () => moveNode(path, false) },
						{ label: "Delete", keys: "⌫", danger: true, sep: true, run: () => deleteNode(path) },
					]);
				}}
			/>
			{open && kids.map((c) => <NodeRow key={c.name} node={c} path={`${path}/${c.name}`} depth={depth + 1} />)}
		</>
	);
}

export function SceneSidebar() {
	void sc.rev.value;
	const nodes = scene().nodes ?? [];
	return (
		<>
			<GroupHeader
				title="The scene's tree: instances of files, placed scenes, groups; children ride their parents. List order is paint order in 2D."
				addLabel="Add a node"
				addItems={[
					{ label: "Instance…", icon: is3d() ? "box" : "image", run: () => run("scene.addInstance") },
					{ label: "Group", icon: "group", run: () => run("scene.addGroup") },
				]}
			>
				Nodes
			</GroupHeader>
			{nodes.map((n) => (
				<NodeRow key={n.name} node={n} path={n.name} depth={0} />
			))}
			{nodes.length === 0 && <div class="nav-empty">Nothing placed yet · + places a file of the project</div>}
		</>
	);
}

/** The node's name: typed freely, taken when the field is left or Return is pressed. */
function NodeName({ path, name }: { path: string; name: string }) {
	const [v, setV] = useState(name);
	useEffect(() => setV(name), [name, path]);
	const commit = () => {
		const t = v.trim();
		if (t && t !== name) renameNode(path, t);
		// a name the scene refused (taken, or with a slash in it) falls back
		if (nodeAt(path)) setV(name);
	};
	return <TextField value={v} mono onChange={setV} onSubmit={commit} onBlur={commit} />;
}

/** The scene's own palettes: a list, + adds a palette file, ⌫ takes the chosen one off. */
function Palettes({ pals, rel }: { pals: string[]; rel: string }) {
	const refs = scene().palette_refs ?? [];
	const [sel, setSel] = useState<number | null>(null);
	const add = (): MenuItem[] => (pals.length ? pals.map((p) => ({ label: stripExt(basename(p)), icon: "palette" as const, run: () => addPaletteRef(relOf(rel, p)) })) : [{ label: "No palette files in the project", disabled: true }]);
	const remove = (i: number) => {
		removePaletteRef(i);
		setSel(null);
	};
	return (
		<InspectorSection
			title="Palettes"
			hint="palettes laid over every instance, in order; later ones win"
			tail={refs.length ? String(refs.length) : undefined}
			actions={
				<button type="button" title="Add a palette" aria-label="Add a palette" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, add(), { align: "right" })}>
					<Icon name="plus" size={14} />
				</button>
			}
		>
			<div class="ur-tree scene-list" role="tree">
				{refs.map((r, i) => (
					<SidebarRow
						key={`${i}:${r}`}
						label={stripExt(basename(r))}
						title={r}
						icon="palette"
						selected={sel === i}
						inactive={sidebar.focus.value !== "insp"}
						onClick={() => setSel(i)}
						onDelete={() => remove(i)}
						onContextMenu={(e) => {
							setSel(i);
							menuAt(e, [{ label: "Remove from the scene", keys: "⌫", danger: true, run: () => remove(i) }]);
						}}
					/>
				))}
			</div>
			<div class="insp-hint flush">{refs.length ? "Later palettes win · ⌫ removes the chosen one" : "No palettes laid over the scene · + adds one"}</div>
		</InspectorSection>
	);
}

export function SceneInspector() {
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
	const deg = (r: number) => Math.round(r * DEG * 1000) / 1000;
	const posStep = d3 ? 0.1 : 1;
	return (
		<div class="inspector">
			{n && path && (
				<>
					<InspectorSection title="Node" hint="a placed thing, or a group" tail={n.ref ? (n.ref.endsWith(".shart") ? "scene" : "instance") : "group"}>
						<Property label="Name">
							<NodeName path={path} name={n.name} />
						</Property>
						<Property label="File" title="the file this node places; a scene places the whole of another scene">
							<Select
								value={n.ref ?? ""}
								onChange={(v) => setNode(path, { ref: v, state: undefined, clip: undefined, attach: undefined })}
								options={[{ value: "", label: "None (a group)" }, ...(n.ref && !options.some((o) => o.rel === n.ref) ? [{ value: n.ref, label: n.ref }] : []), ...options.map((o) => ({ value: o.rel, label: o.label }))]}
							/>
						</Property>
						{n.ref && (
							<Property label="Palette" title="a palette laid over this instance's colours">
								<Select
									value={n.palette ?? ""}
									onChange={(v) => setNode(path, { palette: v })}
									options={[{ value: "", label: "None" }, ...(n.palette && !pals.some((p) => relOf(rel, p) === n.palette) ? [{ value: n.palette, label: n.palette }] : []), ...pals.map((p) => ({ value: relOf(rel, p), label: stripExt(basename(p)) }))]}
								/>
							</Property>
						)}
						<div class="insp-actions">
							<Button onClick={() => duplicateNode(path)}>Duplicate</Button>
							<Button title="Paints later (2D)" onClick={() => moveNode(path, true)}>
								Raise
							</Button>
							<Button title="Paints earlier (2D)" onClick={() => moveNode(path, false)}>
								Lower
							</Button>
							<Button variant="danger" onClick={() => deleteNode(path)}>
								Delete
							</Button>
						</div>
					</InspectorSection>
					<InspectorSection title="Transform" hint="where the file's origin lands, in the parent's frame">
						<Property label="Position" layout={d3 ? "trio" : "pair"} title="where the file's origin lands, in the parent's frame">
							<NumberField axis="x" value={at[0]} step={posStep} stepper={false} onDone={endGesture} onChange={(v) => setNode(path, { at: d3 ? [v, at[1], at[2] ?? 0] : [v, at[1]] }, "at-x")} />
							<NumberField axis="y" value={at[1]} step={posStep} stepper={false} onDone={endGesture} onChange={(v) => setNode(path, { at: d3 ? [at[0], v, at[2] ?? 0] : [at[0], v] }, "at-y")} />
							{d3 && <NumberField axis="z" value={at[2] ?? 0} step={posStep} stepper={false} onDone={endGesture} onChange={(v) => setNode(path, { at: [at[0], at[1], v] }, "at-z")} />}
						</Property>
						{d3 ? (
							<Property label="Turn" layout="trio">
								{([0, 1, 2] as const).map((ax) => (
									<NumberField
										axis={(["x", "y", "z"] as const)[ax]}
										value={deg(rot[ax])}
										step={5}
										suffix="°"
										stepper={false}
										onDone={endGesture}
										onChange={(v) => {
											const r = [...rot] as [number, number, number];
											r[ax] = v / DEG;
											setNode(path, { rotate: r }, `rot-${ax}`);
										}}
									/>
								))}
							</Property>
						) : (
							<Property label="Turn">
								<NumberField value={deg(rot[0])} step={5} suffix="°" label="Turn" onDone={endGesture} onChange={(v) => setNode(path, { rotate: v / DEG }, "rot")} />
							</Property>
						)}
						<Property label="Scale">
							<NumberField value={n.scale ?? 1} min={0} step={0.05} label="Scale" onDone={endGesture} onChange={(v) => setNode(path, { scale: v }, "scale")} />
						</Property>
						<Property label="">
							<Checkbox checked={!!n.mirror} label="Mirror" title="flipped across x" onChange={(v) => setNode(path, { mirror: v })} />
						</Property>
					</InspectorSection>
					{doc && (
						<InspectorSection title="Shows" hint="what the instance shows: a state, or a clip at a time">
							<Property label="State or clip" title="what the instance shows: a state, or a clip at a time">
								<Select
									value={n.clip ? `clip:${n.clip}` : n.state ? `state:${n.state}` : ""}
									onChange={(v) => {
										if (v.startsWith("clip:")) setNode(path, { clip: v.slice(5), state: undefined });
										else if (v.startsWith("state:")) setNode(path, { state: v.slice(6), clip: undefined, t: undefined });
										else setNode(path, { state: undefined, clip: undefined, t: undefined });
									}}
									options={[{ value: "", label: "First state" }, ...(doc.states ?? []).map((s) => ({ value: `state:${s.name}`, label: `State ${s.name}` })), ...(doc.clips ?? []).map((c) => ({ value: `clip:${c.name}`, label: `Clip ${c.name}` }))]}
								/>
							</Property>
							{n.clip && (
								<Property label="Starts at" title="where the clip starts, seconds">
									<NumberField value={n.t ?? 0} min={0} step={0.05} suffix="s" label="Starts at" onDone={endGesture} onChange={(v) => setNode(path, { t: v }, "t")} />
								</Property>
							)}
						</InspectorSection>
					)}
					{parent?.ref && parentDoc && n.ref && !n.ref.endsWith(".shart") && (
						<InspectorSection title="Attachment" hint="hang this node from a socket of the parent's art: positions matched, directions too">
							<Property label="Hangs from" title="hang this node from a socket of the parent's art: positions matched, directions too">
								<Select
									value={n.attach?.to ?? ""}
									onChange={(v) => setNode(path, { attach: v ? { to: v, ...(n.attach?.by ? { by: n.attach.by } : {}) } : undefined })}
									options={[{ value: "", label: "The parent's origin" }, ...anchorsOfDoc(parentDoc).map((a) => ({ value: a, label: a }))]}
								/>
							</Property>
							{n.attach && (
								<Property label="By" title="by this art's own anchor; none: its origin">
									<Select value={n.attach.by ?? ""} onChange={(v) => setNode(path, { attach: { to: n.attach!.to, ...(v ? { by: v } : {}) } })} options={[{ value: "", label: "Its origin" }, ...anchorsOfDoc(doc).map((a) => ({ value: a, label: a }))]} />
								</Property>
							)}
						</InspectorSection>
					)}
				</>
			)}
			<InspectorSection title="Scene" hint="the file itself">
				<Property label="Name">
					<TextField value={scene().name ?? ""} onChange={setSceneName} onBlur={endGesture} />
				</Property>
			</InspectorSection>
			<Palettes pals={pals} rel={rel} />
			{!n && <div class="insp-hint">Click an instance to choose its node</div>}
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

export function SceneCanvasView() {
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
	return <SceneCanvas />;
}

/** The sidebar's Add menu for a scene. */
/** + instance: pick a file of the project, place it under the chosen node. */
export async function askInstance() {
	const options = placeable();
	if (!options.length) {
		project.error.value = "nothing to place: the project has no files of this scene's space";
		return;
	}
	const place = (rel: string, label: string) => {
		const parent = sc.sel.value && nodeAt(sc.sel.value) && !nodeAt(sc.sel.value)!.ref?.endsWith(".shart") ? sc.sel.value : null;
		addNode(parent, { ref: rel }, stripExt(basename(label)));
	};
	const root = project.root.value;
	if (shell.kind !== "wails" || root === null) {
		// the served studio has no file dialog: the files, as a menu
		const { openContextMenu } = await import("../state/menu.ts");
		openContextMenu(window.innerWidth / 2 - 100, 120, options.map((o) => ({ label: o.label, run: () => place(o.rel, o.label) })));
		return;
	}
	// the platform's own open dialog, in the scene's folder
	let file: string | null;
	try {
		file = await shell.pickFile(root, dirname(sc.path.value ?? ""), "Place a file in the scene", "Place", ["fart", "shart"]);
	} catch (e) {
		project.error.value = String(e).replace(/^Error: /, "");
		return;
	}
	if (!file) return;
	const pick = options.find((o) => o.label === file);
	if (!pick) {
		project.error.value = `${basename(file)} cannot be placed here: it is not of this scene's space, or it is the scene itself`;
		return;
	}
	place(pick.rel, pick.label);
}
export function addGroupNow() {
	const parent = sc.sel.value && nodeAt(sc.sel.value) && !nodeAt(sc.sel.value)!.ref?.endsWith(".shart") ? sc.sel.value : null;
	addNode(parent, {}, "group");
}
