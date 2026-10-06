// The launcher: the welcome window, small and fixed, the way Xcode opens.
// On the left the mark, the version and the three ways in; on the right
// the projects opened before. A folder or a .fart dropped on it opens too.

import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { project, pickFolder, openProject, forgetRecent, showLauncher, setShowLauncher, inlineLights } from "../state/project.ts";
import { shell } from "../shell/shell.ts";
import { basename, pretty } from "../state/paths.ts";
import { sheetOpen } from "../state/prompt.ts";
import { createProjectSheet, cloneSheet } from "../ui/Sheets.tsx";
import { HelpButton } from "../ui/Help.tsx";
import { BUTTONS } from "../state/help.ts";
import { Checkbox, Icon, cx, middleTruncate, type IconName } from "../ui/ur.tsx";

const version = signal("");

function Action(p: { icon: IconName; title: string; subtitle: string; shortcut: string; onClick: () => void }) {
	return (
		<div
			class="ur-action"
			role="button"
			tabIndex={0}
			onClick={p.onClick}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					p.onClick();
				}
			}}
		>
			<span class="ur-action-icon">
				<Icon name={p.icon} />
			</span>
			<span>
				<div class="ur-action-title">{p.title}</div>
				<div class="ur-action-sub">{p.subtitle}</div>
			</span>
			<span class="ur-kbd">{p.shortcut}</span>
		</div>
	);
}

async function open(r: string) {
	if (await shell.isDir(r)) return openProject(r);
	project.error.value = `${basename(r)} is gone from ${pretty(r, project.home.value)}`;
	return forgetRecent(r);
}

export function Welcome() {
	const recents = project.recents.value;
	const branches = project.recentBranches.value;
	const [sel, setSel] = useState(0);
	const at = Math.min(sel, recents.length - 1);
	useEffect(() => {
		if (shell.updates && !version.value) void shell.version().then((v) => (version.value = v));
	}, []);
	const remove = (i: number) => {
		void forgetRecent(recents[i]);
		if (sel >= recents.length - 1) setSel(Math.max(0, recents.length - 2));
	};
	const onKey = (e: KeyboardEvent) => {
		if (!recents.length || sheetOpen()) return;
		if (e.key === "ArrowDown") setSel(Math.min(recents.length - 1, at + 1));
		else if (e.key === "ArrowUp") setSel(Math.max(0, at - 1));
		else if (e.key === "Enter") void open(recents[at]);
		else if (e.key === "Backspace" || e.key === "Delete") remove(at);
		else return;
		e.preventDefault();
		e.stopPropagation();
	};
	return (
		<div class={cx("ur", "ur-launcher", inlineLights() && "lights")} role="dialog" aria-label="Welcome to Uranus">
			<div class="ur-welcome">
				<div class="ur-appicon" aria-hidden="true">
					U
				</div>
				<h1>Uranus</h1>
				<div class="ur-welcome-ver">{version.value ? `Version ${version.value.replace(/^v/, "")}` : "The reference editor for the Fast Art Format"}</div>
				<div class="ur-actions">
					<Action icon="plus" title="Create new project…" subtitle="A folder with assets/ inside" shortcut="⇧⌘N" onClick={createProjectSheet} />
					<Action icon="folder-open" title="Open existing project…" subtitle="Any folder of .fart files" shortcut="⌘O" onClick={() => void pickFolder()} />
					<Action icon="download" title="Clone git repository…" subtitle="Check out a project from a remote" shortcut="⌥⌘C" onClick={cloneSheet} />
				</div>
				<div class="ur-welcome-foot">
					<Checkbox checked={showLauncher.value} label="Show this window when Uranus launches" onChange={setShowLauncher} />
					<HelpButton topics={BUTTONS.launcher} title="What Uranus is, and how projects work" />
				</div>
			</div>
			<div class="ur-recents" role="listbox" tabIndex={0} aria-label="Recent projects" ref={(el) => {
					if (el && !sheetOpen() && document.activeElement === document.body) el.focus();
				}} onKeyDown={onKey}>
				{recents.length === 0 && <div class="ur-recents-empty">No recent projects</div>}
				{recents.map((r, i) => (
					<div key={r} class={cx("ur-recent", i === at && "selected")} role="option" aria-selected={i === at} title={r} onClick={() => setSel(i)} onDblClick={() => void open(r)}>
						<Icon name="folder" />
						<div class="ur-recent-text">
							<div class="ur-recent-name">
								{basename(r)}
								{branches[r] && <span class="ur-recent-branch">⎇ {branches[r]}</span>}
							</div>
							<div class="ur-recent-path">{middleTruncate(pretty(r, project.home.value), 34)}</div>
						</div>
						<button
							type="button"
							class="ur-recent-x"
							title="Remove from recents"
							aria-label={`Remove ${basename(r)} from recents`}
							onClick={(e) => {
								e.stopPropagation();
								remove(i);
							}}
						>
							<Icon name="x" size={12} strokeWidth={2.5} />
						</button>
					</div>
				))}
			</div>
		</div>
	);
}
