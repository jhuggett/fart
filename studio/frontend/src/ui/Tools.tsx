// What the path bar carries on its right for an editor: the drawing
// tools and modes (inline, so nothing floats over the canvas) and, while
// a clip is chosen, its transport. Each screen fills these in.

import { run } from "../state/commands.ts";
import { view } from "../canvas/view.ts";
import { Button, ToolPalette, type IconName, type ToolItem } from "./ur.tsx";

export interface ToolSpec<T extends string> {
	tool: T;
	label: string;
	key: string;
	icon: IconName;
	/** a word on what it makes, for the status bar while it is the tool */
	makes?: string;
}

export interface ModeSpec {
	id: string;
	/** the command the toggle runs */
	command: string;
	label: string;
	icon: IconName;
	key?: string;
	on: boolean;
	disabled?: boolean;
	why?: string;
}

/** The snap-to-grid toggle every canvas has. */
export const gridMode = (): ModeSpec => ({ id: "grid", command: "view.snapGrid", label: "Snap to grid", icon: "grid-3x3", key: "⌘'", on: view.snapGrid.value });

/** The tools, a separator, the modes: one inline palette. */
export function ToolBar<T extends string>({ tools, current, disabled, why, modes }: { tools: ToolSpec<T>[]; current: T; disabled?: (t: T) => boolean; why?: string; modes: ModeSpec[] }) {
	const items: (ToolItem | "|")[] = tools.map((t) => ({ id: t.tool, icon: t.icon, label: t.label, key: t.key, disabled: disabled?.(t.tool) ?? false, why }));
	if (tools.length && modes.length) items.push("|");
	for (const m of modes) items.push({ id: m.id, icon: m.icon, label: m.label, key: m.key, toggle: true, disabled: m.disabled, why: m.why });
	return (
		<ToolPalette
			inline
			tools={items}
			value={current}
			toggles={Object.fromEntries(modes.map((m) => [m.id, m.on]))}
			onChange={(id) => run(`tool.${id}`)}
			onToggle={(id) => {
				const m = modes.find((x) => x.id === id);
				if (m) run(m.command);
			}}
		/>
	);
}

/** A clip's transport: rewind, play or pause, where it is, how far along. */
export function Transport({ name, playing, onPlay, onRewind, readout, progress }: { name: string; playing: boolean; onPlay: () => void; onRewind: () => void; readout: string; progress: number }) {
	return (
		<div class="ur-transport" title={`previewing ${name}`}>
			<Button variant="toolbar" icon="skip-back" title="Back to the start" class="ur-btn-sm" onClick={onRewind} />
			<Button variant="toolbar" icon={playing ? "pause" : "play"} title={playing ? "Pause (Space)" : "Play (Space)"} class="ur-btn-sm" active={playing} onClick={onPlay} />
			<span class="ur-transport-read">{readout}</span>
			<span class="ur-activity-bar">
				<i style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }} />
			</span>
		</div>
	);
}

/** "key 3 / 13" for a clip at a time: the key the playhead has reached. */
export function keyReadout(keys: { t: number }[], t: number): string {
	if (!keys.length) return "no keys";
	let at = 0;
	for (let i = 0; i < keys.length; i++) if (keys[i].t <= t + 1e-6) at = i;
	return `key ${at + 1} / ${keys.length}`;
}
