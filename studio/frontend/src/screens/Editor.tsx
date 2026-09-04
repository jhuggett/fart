import { Toolbar, showIssues } from "../ui/Toolbar.tsx";
import { PalettePanel } from "../ui/PalettePanel.tsx";
import { SelectedCard } from "../ui/SelectedCard.tsx";
import { PartsPanel } from "../ui/PartsPanel.tsx";
import { StatesPanel } from "../ui/StatesPanel.tsx";
import { ClipsPanel } from "../ui/ClipsPanel.tsx";
import { ChainsPanel } from "../ui/ChainsPanel.tsx";
import { Timeline } from "../ui/Timeline.tsx";
import { Canvas } from "../canvas/Canvas.tsx";
import { Explorer } from "../ui/Explorer.tsx";
import { explorer } from "../state/explorer.ts";
import { ed, curState, curClip } from "../state/editor.ts";
import { view } from "../canvas/view.ts";

export function Editor() {
	void ed.rev.value;
	const st = curState();
	const clip = curClip();
	const hint = ed.collide.value
		? "collision lens: shapes a game may treat as solid · C flips back"
		: clip
			? `previewing "${clip.name}" · Space plays · keys name states, pose those to change a key`
			: st
				? `posing "${st.name}": drag a part to place it, pull the lever to turn, drag a ring to reach · geometry is locked`
			: ed.pending.value === "pivot"
				? "click the canvas to place the pivot"
				: ed.pending.value === "anchor"
					? "click the canvas to place the anchor"
					: ed.tool.value === "poly"
						? "click to add points · click the first point or press Enter to close · Esc drops it"
						: "";
	const issues = ed.issues.value;
	return (
		<div class="app">
			<Toolbar />
			<div class={`editor ${explorer.open.value ? "" : "no-explorer"}`}>
				<Explorer />
				<div class="panel left">
					<PalettePanel />
					<SelectedCard />
				</div>
				<div class="canvas-col">
				<div class="canvas-wrap">
					<Canvas />
					<div class="hud">
						{hint || `zoom ${view.zoom.value.toFixed(1)}×`}
					</div>
					{issues.length > 0 && showIssues.value && (
						<div class="issues">
							{issues.slice(0, 6).map((i) => (
								<div class={["json", "version", "schema", "path", "ref.token", "ref.part", "tris", "dup.part", "dup.state", "dup.token"].includes(i.code) ? "e" : "w"}>
									{i.code} {i.path}: {i.message}
								</div>
							))}
							{issues.length > 6 && <div>… and {issues.length - 6} more</div>}
						</div>
					)}
				</div>
				<Timeline />
				</div>
				<div class="panel right">
					<PartsPanel />
					<StatesPanel />
					<ClipsPanel />
					<ChainsPanel />
				</div>
			</div>
		</div>
	);
}
