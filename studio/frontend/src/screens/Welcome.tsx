import { project, pickFolder, openProject, forgetRecent, goDocs } from "../state/project.ts";
import { shell } from "../shell/shell.ts";
import { basename, pretty } from "../state/paths.ts";
import { ThemeButton } from "../ui/ThemeMenu.tsx";

export function Welcome() {
	const recents = project.recents.value;
	return (
		<div class="app">
			<div class="topbar">
				<span class="brand">fastart</span>
				<span class="sub">the Fast Art Format editor</span>
				<div class="spacer" />
				<ThemeButton label />
				<button class="btn ghost" onClick={goDocs}>
					Docs
				</button>
			</div>
			<div class="welcome">
				<div>
					<div class="hdr">Start</div>
					<div style="display:flex;align-items:center;gap:12px;margin:8px 0 22px">
						<button class="btn primary" onClick={() => void pickFolder()}>
							Open Folder…
						</button>
						<span class="chip">Cmd+O</span>
					</div>
					<p>A folder is a project: every .fart inside it, one shelf.</p>
					<p>Double-click a .fart in the Finder, or drop one on this window, to open it here.</p>
					<p>
						From a terminal: <code class="kbd">studio &lt;folder&gt;</code> or <code class="kbd">studio thing.fart</code>
					</p>
					<p style="margin-top:22px">
						New here? The <a onClick={goDocs}>docs</a> live inside the app: the guide, and the format itself.
					</p>
				</div>
				<div class="recent">
					<div class="hdr">Recent</div>
					{recents.length === 0 && <p style="color:var(--faint)">Projects you open will show up here.</p>}
					{recents.map((r) => (
						<div
							class="recent-row"
							onClick={() =>
								void shell.isDir(r).then((ok) => {
									if (ok) return openProject(r);
									project.error.value = `${basename(r)} is gone from ${pretty(r, project.home.value)}`;
									return forgetRecent(r);
								})
							}
						>
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
