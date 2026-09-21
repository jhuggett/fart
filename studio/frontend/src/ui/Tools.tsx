// The floating tool bar at the bottom of the canvas, and the hint line
// above it. Each screen fills it; this is the shell around them.

import type { ComponentChildren } from "preact";
import type { JSX } from "preact";
import { run } from "../state/commands.ts";
import { view } from "../canvas/view.ts";

export interface ToolSpec<T extends string> {
	tool: T;
	label: string;
	key: string;
	icon: (p: { size?: number }) => JSX.Element;
	/** a word on what it makes, for the tooltip */
	makes?: string;
}

/** The tool buttons: icon and key, the label in the tooltip. */
export function ToolButtons<T extends string>({ tools, current, disabled, why }: { tools: ToolSpec<T>[]; current: T; disabled?: (t: T) => boolean; why?: string }) {
	return (
		<div class="group">
			{tools.map((t) => {
				const off = disabled?.(t.tool) ?? false;
				return (
					<button class={`tool ${current === t.tool ? "active" : ""}`} disabled={off} title={off && why ? why : `${t.label}  (${t.key})${t.makes ? ` · ${t.makes}` : ""}`} onClick={() => run(`tool.${t.tool}`)}>
						<t.icon />
						<span class="key">{t.key}</span>
					</button>
				);
			})}
		</div>
	);
}

/** Floats over the canvas: the hint, then the bar. `zoom` shows the zoom at the corner. */
export function Tools({ hint, children, zoom = true }: { hint?: string; children?: ComponentChildren; zoom?: boolean }) {
	return (
		<>
			{(hint || children) && (
				<div class="tools-wrap">
					{hint && <div class="hint-line">{hint}</div>}
					{children && <div class="tools">{children}</div>}
				</div>
			)}
			{zoom && (
				<div class="zoom-hud" title="zoom · ⌘0 for 100%, ⇧1 to fit">
					{view.zoom.value.toFixed(1)}×{view.snapGrid.value ? " · grid" : ""}
				</div>
			)}
		</>
	);
}
