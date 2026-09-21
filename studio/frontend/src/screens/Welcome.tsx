// The launcher: a small window. On the left, the mark and the two ways
// in (a new project, an existing one); on the right, the projects opened
// before. A folder or a .fart dropped on it opens too.

import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";
import { project, pickFolder, createProject, openProject, forgetRecent, goDocs, goSetup } from "../state/project.ts";
import { setup } from "../state/setup.ts";
import { shell } from "../shell/shell.ts";
import { basename, pretty } from "../state/paths.ts";
import { ThemeButton } from "../ui/ThemeMenu.tsx";
import { I } from "../ui/Icons.tsx";

const version = signal("");

export function Welcome() {
	const recents = project.recents.value;
	useEffect(() => {
		if (shell.updates && !version.value) void shell.version().then((v) => (version.value = v));
	}, []);
	return (
		<div class="launcher">
			<div class="launcher-left">
				<div class="mark">
					<span class="brand">Uranus</span>
					<span class="tag">the reference editor for the Fast Art Format</span>
					{version.value && <span class="ver">{version.value}</span>}
				</div>
				<div class="ways">
					<button class="way" onClick={() => void createProject()}>
						<span class="ico-box">
							<I.plus size={16} />
						</span>
						<span class="w">
							<b>Create New Project</b>
							<small>a folder with assets/ inside</small>
						</span>
					</button>
					<button class="way" onClick={() => void pickFolder()}>
						<span class="ico-box">
							<I.folder size={16} />
						</span>
						<span class="w">
							<b>Open Existing Project</b>
							<small>any folder of .fart files · ⌘⇧O</small>
						</span>
					</button>
				</div>
				<div class="launcher-foot">
					<button class="btn ghost small" onClick={() => goDocs("guide")}>
						Docs
					</button>
					{shell.setup && (
						<button class={`btn ghost small ${setup.attention.value ? "attention" : ""}`} title="agents and loaders: what is in place, what to install" onClick={goSetup}>
							Setup
						</button>
					)}
					<ThemeButton />
				</div>
			</div>
			<div class="launcher-right">
				<div class="hdr">Recent Projects</div>
				{recents.length === 0 && <p class="empty">Projects you open show up here. Drop a folder on this window to open it.</p>}
				<div class="recent">
					{recents.map((r) => (
						<div
							class="recent-row"
							key={r}
							onClick={() =>
								void shell.isDir(r).then((ok) => {
									if (ok) return openProject(r);
									project.error.value = `${basename(r)} is gone from ${pretty(r, project.home.value)}`;
									return forgetRecent(r);
								})
							}
						>
							<span class="glyph">
								<I.folder size={14} />
							</span>
							<span class="n">
								<b>{basename(r)}</b>
								<small>{pretty(r, project.home.value)}</small>
							</span>
							<button
								class="btn x"
								title="forget"
								onClick={(e) => {
									e.stopPropagation();
									void forgetRecent(r);
								}}
							>
								×
							</button>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
