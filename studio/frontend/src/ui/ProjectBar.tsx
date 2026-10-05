// The content column's two bars. The header: the project picker (the
// project over its branch), the activity view dead centre, the
// appearance button. Under it the path bar: back and forward, the
// breadcrumb project › folders › document › state with every segment a
// menu of its siblings, and on the right whatever the content needs.

import type { ComponentChildren } from "preact";
import { signal } from "@preact/signals";
import { project, goDocs, goSetup, goWelcome, goFolder, goBack, goForward, openDoc, openProject, switchBranch, toggleServe, revealFile, inlineLights } from "../state/project.ts";
import { sidebar, toggleSidebar, toggleInspector, openAsset, tree, type TreeNode } from "../state/sidebar.ts";
import { ed, states, clips, selectState, selectClip, curClip } from "../state/editor.ts";
import { md, states as states3, clips as clips3, selectState as selectState3, selectClip as selectClip3, curClip as curClip3 } from "../state/model.ts";
import { sc } from "../state/scene.ts";
import { openDocNow, hardIssues } from "../state/doc.ts";
import { activity, ago } from "../state/activity.ts";
import { nav, canBack, canForward } from "../state/nav.ts";
import { theme, toggleAppearance } from "../state/theme.ts";
import { setup } from "../state/setup.ts";
import { shell } from "../shell/shell.ts";
import { run } from "../state/commands.ts";
import type { MenuItem } from "../state/menu.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { commitSheet, newBranchSheet } from "./Sheets.tsx";
import { kindOf, kindIcon } from "./kinds.ts";
import { ActivityView, Button, PaneHeader, PaneToggle, PathBar, ProjectPicker, type ActivityDetails, type CrumbItem } from "./ur.tsx";
import type { Issue } from "@fastart/core";

/** the issues panel over the canvas is showing */
export const showIssues = signal(false);

/** The open asset's issues, whichever store holds it. */
export function issuesNow(): Issue[] {
	const s = project.screen.value;
	return s === "edit" ? ed.issues.value : s === "model" ? md.issues.value : s === "scene" ? sc.issues.value : [];
}

/** The picker's menu: the projects opened before, this one's own actions, its branches. */
function projectMenu(): MenuItem[] {
	const native = shell.kind === "wails";
	const serve = project.serve.value;
	const caps = project.caps.value;
	const items: MenuItem[] = [];
	if (native) {
		items.push({ label: "Project", header: true });
		items.push({ label: project.name.value, checked: true, icon: "folder" });
		for (const r of project.recents.value.filter((r) => r !== project.root.value).slice(0, 6)) items.push({ label: basename(r), icon: "folder", run: () => void openProject(r) });
		if (caps.reveal) items.push({ label: `Reveal in ${caps.reveal}`, icon: "external-link", sep: true, run: () => void revealFile("") });
		items.push({ label: serve?.on ? `Stop serving (${serve.url})` : "Serve on the network…", icon: "wifi", sep: !caps.reveal, checked: !!serve?.on, run: () => void toggleServe() });
		items.push({ label: "Close project", icon: "x", run: () => void goWelcome() });
	}
	const cur = project.branch.value;
	if (cur) {
		items.push({ label: "Branch", header: true, sep: items.length > 0 });
		for (const b of project.branches.value.length ? project.branches.value : [cur]) items.push({ label: b, icon: "git-branch", checked: b === cur, run: () => void switchBranch(b) });
		items.push({ label: "New branch…", icon: "plus", sep: true, run: newBranchSheet });
	}
	if (!native) {
		// the served studio has no menu bar: its help lives here
		items.push({ label: "Uranus docs", icon: "book-open", sep: items.length > 0, run: () => goDocs("guide") });
		items.push({ label: "The format", icon: "book-open", run: () => goDocs("format") });
		if (shell.setup) items.push({ label: `Setup…${setup.attention.value ? " · something is missing" : ""}`, icon: "settings", run: goSetup });
	}
	return items;
}

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

function Activity() {
	const d = openDocNow();
	const busy = activity.busy.value;
	const err = activity.error.value;
	const hard = d ? hardIssues(d.issues).length : 0;
	const changes = project.changes.value.length;
	const status = busy ? "busy" : err || hard ? "error" : d?.dirty ? "edited" : "saved";
	const message = busy ? busy.message : err ? err : hard ? `${hard} problem${hard === 1 ? "" : "s"}` : d?.dirty ? "Edited" : d ? "Saved" : changes ? `${changes} uncommitted` : "Up to date";
	const log: ActivityDetails["log"] = [];
	if (d?.dirty) log.push({ icon: "pencil", text: `${stripExt(basename(d.path))} changed since its checkpoint`, time: d.written ? clock(d.written) : "" });
	else if (d?.checkpointAt) log.push({ icon: "circle-check", text: `Checkpoint of ${stripExt(basename(d.path))}`, time: clock(d.checkpointAt) });
	for (const l of activity.log.value.slice(0, 6)) log.push({ icon: l.icon, text: l.text, time: ago(l.at) });
	const actions: NonNullable<ActivityDetails["actions"]> = [];
	if (d) {
		actions.push({ label: "Revert", disabled: !d.dirty, onClick: () => run("file.revert") });
		actions.push({ label: "Save", shortcut: "⌘S", primary: d.dirty, onClick: () => run("file.save") });
	}
	if (changes) actions.unshift({ label: "Review & commit…", onClick: commitSheet });
	return <ActivityView project={project.name.value || "project"} branch={project.branch.value || undefined} status={status} message={message} progress={busy?.progress ?? undefined} details={{ log, actions }} />;
}

/** The content column's header. When a side column is hidden, its show toggle (and the lights) come here. */
export function ContentHeader({ canvas }: { canvas: boolean }) {
	const navOpen = sidebar.open.value;
	const inspOpen = sidebar.inspector.value;
	const issues = issuesNow();
	const hard = hardIssues(issues).length;
	return (
		<PaneHeader
			pane={canvas ? "canvas" : "content"}
			lights={!navOpen && inlineLights()}
			leading={!navOpen && <PaneToggle side="left" open={false} onClick={toggleSidebar} />}
			center={<Activity />}
			trailing={
				<>
					{issues.length > 0 && (
						<Button variant="borderless" icon={hard ? "triangle-alert" : "info"} active={showIssues.value} title={hard ? "Problems the format refuses; the file opened anyway" : "Notes: fields this version does not know, and the like"} onClick={() => (showIssues.value = !showIssues.value)}>
							{hard || issues.length}
						</Button>
					)}
					<Button variant="toolbar" icon={theme.applied.value === "light" ? "moon" : "sun"} title={theme.applied.value === "light" ? "Dark appearance" : "Light appearance"} onClick={toggleAppearance} />
					{!inspOpen && <PaneToggle side="right" open={false} onClick={toggleInspector} />}
				</>
			}
		>
			<ProjectPicker project={project.name.value || "project"} branch={project.branch.value} items={projectMenu} />
		</PaneHeader>
	);
}

// ------------------------------------------------------------- path bar

function folderNode(path: string): TreeNode | null {
	let node = tree();
	if (!path) return node;
	for (const seg of path.split("/")) {
		const next = node.children.find((c) => c.kind === "folder" && c.name === seg);
		if (!next) return null;
		node = next;
	}
	return node;
}

/** Every asset of the project, grouped by folder: the quick switcher. */
export function assetMenu(): MenuItem[] {
	const cur = openAsset();
	const files = project.files.value;
	if (!files.length) return [{ label: "No assets yet", disabled: true }];
	let lastDir: string | null = null;
	const items: MenuItem[] = [];
	for (const rel of files) {
		const dir = dirname(rel);
		if (dir !== lastDir && dir) items.push({ label: dir, header: true, sep: lastDir !== null });
		lastDir = dir;
		const t = project.thumbs.value.get(rel);
		items.push({ label: stripExt(basename(rel)), icon: kindIcon(rel, t), checked: rel === cur, run: () => void openDoc(rel) });
	}
	return items;
}

/** A folder's siblings (and itself), then the way down into it. */
function folderSiblings(path: string): MenuItem[] {
	const parent = folderNode(dirname(path));
	const items: MenuItem[] = (parent?.children ?? []).filter((c) => c.kind === "folder").map((c) => ({ label: c.name, icon: "folder", checked: c.path === path, run: () => void goFolder(c.path) }));
	return items;
}

/** The documents beside this one, then New asset…. */
function docSiblings(rel: string): MenuItem[] {
	const dir = dirname(rel);
	const items: MenuItem[] = project.files.value
		.filter((f) => dirname(f) === dir)
		.map((f) => ({ label: stripExt(basename(f)), icon: kindIcon(f, project.thumbs.value.get(f)), checked: f === rel, run: () => void openDoc(f) }));
	items.push({ label: "New asset…", icon: "plus", sep: true, run: () => run("file.new") });
	return items;
}

export function stateMenu(): MenuItem[] {
	const s = project.screen.value;
	const build = (sts: { name: string }[], cs: { name: string }[], curS: number, curC: number, pickS: (k: number) => void, pickC: (k: number) => void): MenuItem[] => [
		{ label: "States", header: true },
		...sts.map((st, k) => ({ label: st.name, icon: "circle-dot" as const, checked: curC < 0 && k === curS, run: () => pickS(k) })),
		...(cs.length ? [{ label: "Clips", header: true, sep: true } as MenuItem] : []),
		...cs.map((c, k) => ({ label: c.name, icon: "film" as const, checked: k === curC, run: () => pickC(k) })),
	];
	if (s === "edit") return build(states(), clips(), ed.curState.value, ed.curClip.value, selectState, selectClip);
	if (s === "model") return build(states3(), clips3(), md.curState.value, md.curClip.value, selectState3, selectClip3);
	return [];
}

/** The word on the state segment: the state, or the clip previewing. */
function stateCrumb(): CrumbItem | null {
	const s = project.screen.value;
	if (s === "edit" && !ed.isPalette.value) {
		const c = curClip();
		const label = c ? c.name : states()[ed.curState.value]?.name;
		return label ? { id: "state", label, icon: c ? "film" : "circle-dot", menu: stateMenu } : null;
	}
	if (s === "model") {
		const c = curClip3();
		const label = c ? c.name : states3()[md.curState.value]?.name;
		return label ? { id: "state", label, icon: c ? "film" : "circle-dot", menu: stateMenu } : null;
	}
	return null;
}

/** The bar under the header. `children` are the content's own controls. */
export function JumpBar({ children }: { children?: ComponentChildren }) {
	void ed.rev.value;
	void md.rev.value;
	void sc.rev.value;
	const d = openDocNow();
	const folder = d ? dirname(d.path) : nav.folder.value;
	const items: CrumbItem[] = [{ label: project.name.value || "project", icon: "folder", onClick: () => void goFolder("") }];
	let at = "";
	for (const seg of folder ? folder.split("/") : []) {
		at = at ? `${at}/${seg}` : seg;
		const path = at;
		items.push({ label: seg, icon: "folder", menu: () => folderSiblings(path), onClick: () => void goFolder(path) });
	}
	if (d) {
		const t = project.thumbs.value.get(d.path);
		const kind = kindOf(d.path, t);
		const path = d.path;
		items.push({ id: "asset", label: stripExt(basename(d.path)), icon: kindIcon(d.path, t), tag: project.screen.value === "scene" ? (sc.scene.value.space === "3d" ? "3D scene" : "scene") : project.screen.value === "model" ? "3D" : kind, edited: d.dirty, menu: () => docSiblings(path) });
		const st = stateCrumb();
		if (st) items.push(st);
	}
	return (
		<PathBar items={items} canBack={canBack()} canForward={canForward()} onBack={() => void goBack()} onForward={() => void goForward()}>
			{children}
		</PathBar>
	);
}
