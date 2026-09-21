// The top of the canvas, the way Xcode heads its editor: the project and
// its branch, then the asset and the state as quick switchers; at the far
// ends the sidebar and inspector toggles, and the few things that are
// about the file rather than in it (save, issues, Ask).

import { signal } from "@preact/signals";
import { project, goBrowse, goDocs, goSetup, goWelcome, openDoc, switchBranch, toggleServe, revealFile, inWorkspace } from "../state/project.ts";
import { sidebar, toggleSidebar, toggleInspector, openAsset } from "../state/sidebar.ts";
import { ed, states, clips, selectState, selectClip, curClip, save } from "../state/editor.ts";
import { md, states as states3, clips as clips3, selectState as selectState3, selectClip as selectClip3, curClip as curClip3, save as save3 } from "../state/model.ts";
import { sc, save as saveScene } from "../state/scene.ts";
import { chat, toggleChat } from "../state/chat.ts";
import { setup } from "../state/setup.ts";
import { shell } from "../shell/shell.ts";
import { openMenuBelow, type MenuItem } from "../state/menu.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { ThemeButton } from "./ThemeMenu.tsx";
import { I } from "./Icons.tsx";
import type { Issue } from "@fastart/core";

/** the issues panel over the canvas is showing */
export const showIssues = signal(false);

/** The open asset's issues, whichever store holds it. */
export function issuesNow(): Issue[] {
	const s = project.screen.value;
	return s === "edit" ? ed.issues.value : s === "model" ? md.issues.value : s === "scene" ? sc.issues.value : [];
}
const soft = (code: string) => ["unknown", "reserved", "unresolved"].includes(code);

function assetMenu(): MenuItem[] {
	const cur = openAsset();
	const files = project.files.value;
	if (!files.length) return [{ label: "no assets yet", disabled: true }];
	let lastDir: string | null = null;
	return files.map((rel) => {
		const dir = dirname(rel);
		const sep = lastDir !== null && dir !== lastDir;
		lastDir = dir;
		const t = project.thumbs.value.get(rel);
		const kind = rel.endsWith(".shart") ? (t?.space3d ? "3D scene" : "scene") : t?.space3d ? "3D" : t && !t.doc.parts?.length && t.doc.palette?.length ? "palette" : "";
		return { label: `${rel === cur ? "✓ " : ""}${dir ? `${dir}/` : ""}${stripExt(basename(rel))}`, keys: kind, sep, run: () => void openDoc(rel) };
	});
}

function stateMenu(): MenuItem[] {
	const s = project.screen.value;
	if (s === "edit") {
		const sts = states();
		const cs = clips();
		const cur = ed.curClip.value < 0 ? ed.curState.value : -1;
		return [
			...sts.map((st, k) => ({ label: `${k === cur ? "✓ " : ""}${st.name}`, run: () => selectState(k) })),
			...cs.map((c, k) => ({ label: `${k === ed.curClip.value ? "✓ " : ""}${c.name}`, keys: "clip", sep: k === 0, run: () => selectClip(k) })),
		];
	}
	if (s === "model") {
		const sts = states3();
		const cs = clips3();
		const cur = md.curClip.value < 0 ? md.curState.value : -1;
		return [
			...sts.map((st, k) => ({ label: `${k === cur ? "✓ " : ""}${st.name}`, run: () => selectState3(k) })),
			...cs.map((c, k) => ({ label: `${k === md.curClip.value ? "✓ " : ""}${c.name}`, keys: "clip", sep: k === 0, run: () => selectClip3(k) })),
		];
	}
	return [];
}

/** The word on the state switcher: the state, or the clip previewing. */
function stateLabel(): string | null {
	const s = project.screen.value;
	if (s === "edit") {
		if (ed.isPalette.value) return null;
		const c = curClip();
		return c ? `▶ ${c.name}` : (states()[ed.curState.value]?.name ?? null);
	}
	if (s === "model") {
		const c = curClip3();
		return c ? `▶ ${c.name}` : (states3()[md.curState.value]?.name ?? null);
	}
	return null;
}

function branchMenu(): MenuItem[] {
	const cur = project.branch.value;
	const bs = project.branches.value;
	if (!bs.length) return [{ label: cur || "no branches", disabled: true }];
	return bs.map((b) => ({ label: `${b === cur ? "✓ " : ""}${b}`, run: () => void switchBranch(b) }));
}

function moreMenu(): MenuItem[] {
	const native = shell.kind === "wails";
	const serve = project.serve.value;
	const items: MenuItem[] = [];
	if (native) {
		items.push({ label: serve?.on ? `Stop serving (${serve.url})` : "Serve on the network…", run: () => void toggleServe() });
		if (project.caps.value.reveal) items.push({ label: `Reveal project in ${project.caps.value.reveal}`, run: () => void revealFile("") });
	}
	if (shell.setup) items.push({ label: `Setup${setup.attention.value ? " · something is missing" : ""}`, sep: items.length > 0, run: goSetup });
	items.push({ label: "The format", run: () => goDocs("format") });
	if (native) items.push({ label: "Close project", sep: true, run: () => void goWelcome() });
	return items;
}

export function ProjectBar() {
	void ed.rev.value;
	void md.rev.value;
	void sc.rev.value;
	const s = project.screen.value;
	const asset = openAsset();
	const stLabel = stateLabel();
	const issues = issuesNow();
	const errors = issues.filter((i) => !soft(i.code)).length;
	const dirty = s === "edit" ? ed.dirty.value : s === "model" ? md.dirty.value : s === "scene" ? sc.dirty.value : false;
	const ckAt = s === "edit" ? ed.checkpointAt.value : s === "model" ? md.checkpointAt.value : s === "scene" ? sc.checkpointAt.value : 0;
	const written = s === "edit" ? ed.written.value : s === "model" ? md.written.value : s === "scene" ? sc.written.value : 0;
	const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });
	const doSave = s === "edit" ? save : s === "model" ? save3 : saveScene;
	const kind = s === "model" ? "3D" : s === "scene" ? (sc.scene.value.space === "3d" ? "3D scene" : "scene") : s === "edit" && ed.isPalette.value ? "palette" : "";
	return (
		<div class="projectbar">
			<button class={`btn ghost icon ${sidebar.open.value ? "" : "off"}`} title="sidebar  (⌘B)" onClick={toggleSidebar}>
				<I.sidebar size={15} />
			</button>
			<button class="btn ghost icon" title="the guide  (?)" onClick={() => goDocs("guide")}>
				<I.help size={15} />
			</button>
			<div class="scheme">
				<button class="seg" title={project.root.value || "the project"} onClick={() => void goBrowse()}>
					<I.folder size={13} />
					<span class="w">{project.name.value || "project"}</span>
				</button>
				{project.branch.value && (
					<button class="seg" title="the branch this project is on · click to switch" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, branchMenu())}>
						<I.branch size={13} />
						<span class="w">{project.branch.value}</span>
						<I.down size={10} />
					</button>
				)}
				<span class="arrow">›</span>
				<button class={`seg asset ${asset ? "" : "faint"}`} title="the asset on the canvas · click to switch  (⌘⇧P)" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, assetMenu())}>
					<I.asset size={13} />
					<span class="w">{asset ? stripExt(basename(asset)) : "No asset"}</span>
					{kind && <span class="chip">{kind}</span>}
					<I.down size={10} />
				</button>
				{stLabel && (
					<>
						<span class="arrow">›</span>
						<button class="seg state" title="the state on the canvas (or the clip previewing) · click to switch  (⌘⇧S)" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, stateMenu())}>
							<I.state size={13} />
							<span class="w">{stLabel}</span>
							<I.down size={10} />
						</button>
					</>
				)}
			</div>
			<div class="spacer" />
			{issues.length > 0 && (
				<button
					class={`btn small ${showIssues.value ? "active" : "ghost"} ${errors ? "bad" : ""}`}
					title={errors ? "problems the format refuses; the file opened anyway" : "notes: fields this version does not know, and the like"}
					onClick={() => (showIssues.value = !showIssues.value)}
				>
					{errors ? `${errors} problem${errors === 1 ? "" : "s"}` : `${issues.length} note${issues.length === 1 ? "" : "s"}`}
				</button>
			)}
			{asset && (
				<button
					class={`btn small ${dirty ? "" : "ghost"}`}
					title={`Save keeps this version as the checkpoint to revert to  (⌘S)${ckAt ? ` · last ${clock(ckAt)}` : ""}${written ? ` · on disk ${clock(written)}` : ""}${dirty ? " · changed since the checkpoint" : ""}`}
					onClick={() => void doSave()}
				>
					{dirty && <span class="dot" />}
					Save
				</button>
			)}
			{shell.chat && inWorkspace(s) && (
				<button class={`btn small ${chat.open.value ? "active" : "ghost"}`} title="ask Claude to change this file  (⌘J)" onClick={toggleChat}>
					Ask
				</button>
			)}
			<ThemeButton />
			<button class="btn ghost icon" title="more" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, moreMenu())}>
				<I.dots size={15} />
			</button>
			<button class={`btn ghost icon ${sidebar.inspector.value ? "" : "off"}`} title="inspector  (⌘⌥0)" onClick={toggleInspector}>
				<I.inspector size={15} />
			</button>
		</div>
	);
}
