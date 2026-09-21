// The inspector with nothing open: the project itself.

import { project } from "../state/project.ts";
import { pretty } from "../state/paths.ts";
import { shell } from "../shell/shell.ts";

export function ProjectInspector() {
	const files = project.files.value;
	const scenes = files.filter((f) => f.endsWith(".shart")).length;
	const native = shell.kind === "wails";
	return (
		<div class="panel right inspector">
			<div class="hdr" title="the folder that is the project">
				Project
			</div>
			<div class="line">
				<span class="k">name</span>
				<span class="name">{project.name.value}</span>
			</div>
			{native && (
				<div class="line" title={project.root.value ?? ""}>
					<span class="k">folder</span>
					<span class="name sub">{pretty(project.root.value ?? "", project.home.value)}</span>
				</div>
			)}
			{project.branch.value && (
				<div class="line">
					<span class="k">branch</span>
					<span class="name">{project.branch.value}</span>
				</div>
			)}
			<div class="line">
				<span class="k">assets</span>
				<span class="name">
					{files.length - scenes} file{files.length - scenes === 1 ? "" : "s"}
					{scenes ? ` · ${scenes} scene${scenes === 1 ? "" : "s"}` : ""}
				</span>
			</div>
			{project.hasAssets.value && (
				<div class="line">
					<span class="k">new assets</span>
					<span class="name sub">land in assets/</span>
				</div>
			)}
			<div class="empty" style="margin-top:14px">
				click an asset to open it · the inspector then shows what is selected on the canvas, or the asset itself
			</div>
		</div>
	);
}
