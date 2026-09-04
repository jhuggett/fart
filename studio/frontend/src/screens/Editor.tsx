import { Toolbar, showIssues } from "../ui/Toolbar.tsx";
import { Layers } from "../ui/Layers.tsx";
import { Inspector } from "../ui/Inspector.tsx";
import { BottomBar, StatesList, ClipsList } from "../ui/BottomBar.tsx";
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
							: "drawing · shapes and parts are edited here · pick a state on the left to arrange them";
	const issues = ed.issues.value;
	return (
		<div class="app">
			<Toolbar />
			<div class={`editor ${explorer.open.value ? "" : "no-explorer"}`}>
				<Explorer />
				<div class="panel left">
					<Layers />
					<StatesList />
					<ClipsList />
				</div>
				<div class="canvas-col">
					<div class="canvas-wrap">
						<Canvas />
						<div class="hud">
							{hint}
							{` · zoom ${view.zoom.value.toFixed(1)}×${view.snapGrid.value ? " · grid snap" : ""}`}
						</div>
						{issues.length > 0 && showIssues.value && (
							<div class="issues">
								{issues.slice(0, 8).map((i) => (
									<div class={["unknown", "reserved", "unresolved"].includes(i.code) ? "w" : "e"}>
										{i.code} {i.path}: {i.message}
									</div>
								))}
								{issues.length > 8 && <div>… and {issues.length - 8} more</div>}
							</div>
						)}
					</div>
					<BottomBar />
				</div>
				<Inspector />
			</div>
		</div>
	);
}
