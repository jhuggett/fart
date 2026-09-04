// A palette file on screen: no canvas, just its colour slots, big enough
// to see. Other files draw from these by name.

import { useState } from "preact/hooks";
import { cssColor, type Rgba } from "@fastart/core";
import { I } from "./Icons.tsx";
import { InlineName } from "./Rename.tsx";
import { ColorPicker } from "./ColorPicker.tsx";
import { ed, palette, addToken, deleteToken, renameToken, setTokenColor, freshName } from "../state/editor.ts";
import { linkedBy } from "../state/project.ts";
import { renaming, openContextMenu } from "../state/menu.ts";
import { basename, stripExt } from "../state/paths.ts";

function hex([r, g, b, a]: Rgba): string {
	const h = (n: number) => n.toString(16).padStart(2, "0");
	return `#${h(r)}${h(g)}${h(b)}${a < 255 ? h(a) : ""}`;
}

export function PaletteView() {
	const toks = palette();
	const rel = ed.path.value ?? "";
	const users = linkedBy(rel);
	const ren = renaming.value;
	const cur = ed.curTok.value;
	const [pick, setPick] = useState<{ k: number; x: number; y: number } | null>(null);
	const add = () => {
		addToken(freshName("colour", toks.map((t) => t.name)));
		renaming.value = { kind: "token", index: palette().length - 1 };
	};
	return (
		<div class="palette-view">
			<div class="pal-head">
				<div class="pal-title">{stripExt(basename(rel))}</div>
				<div class="pal-sub">
					a palette: colour slots other files draw from by name ·{" "}
					{users.length ? `linked by ${users.map((u) => stripExt(basename(u))).join(", ")}` : "no file links it yet"}
				</div>
			</div>
			<div class="pal-grid">
				{toks.map((t, k) => (
					<div
						class={`pal-tile ${k === cur ? "active" : ""}`}
						onClick={() => (ed.curTok.value = k)}
						onDblClick={() => (renaming.value = { kind: "token", index: k })}
						onContextMenu={(e) => {
							e.preventDefault();
							ed.curTok.value = k;
							openContextMenu(e.clientX, e.clientY, [
								{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "token", index: k }) },
								{ label: "Delete colour", danger: true, sep: true, run: () => deleteToken(k) },
							]);
						}}
					>
						<button
							class="pal-swatch"
							style={{ background: cssColor(t.rgb) }}
							title="edit the colour"
							onClick={(e) => {
								e.stopPropagation();
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								setPick({ k, x: r.left, y: r.bottom + 6 });
							}}
						/>
						<div class="pal-label">
							{ren?.kind === "token" && ren.index === k ? (
								<InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
							) : (
								<span class="name">{t.name}</span>
							)}
							<span class="hex">{hex(t.rgb)}</span>
						</div>
						<button
							class="btn x"
							title="delete colour"
							onClick={(e) => {
								e.stopPropagation();
								deleteToken(k);
							}}
						>
							×
						</button>
					</div>
				))}
				<button class="pal-tile add" onClick={add} title="a new colour slot">
					<I.plus size={14} /> colour
				</button>
			</div>
			{pick && toks[pick.k] && (
				<ColorPicker rgb={toks[pick.k].rgb} x={pick.x} y={pick.y} onChange={(rgb: Rgba) => setTokenColor(pick.k, rgb)} onClose={() => setPick(null)} />
			)}
		</div>
	);
}
