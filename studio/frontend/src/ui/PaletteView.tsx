// A palette file on screen: no canvas, just its colour slots, big enough
// to see. Other files draw from these by name.

import { useState } from "preact/hooks";
import { cssColor, type Rgba } from "@fastart/core";
import { InlineName } from "./Rename.tsx";
import { ColorPicker, hexOf } from "./ColorPicker.tsx";
import { Icon, cx } from "./ur.tsx";
import { ed, palette, addToken, deleteToken, renameToken, setTokenColor, setTokenEmissive, freshName } from "../state/editor.ts";
import { linkedBy } from "../state/project.ts";
import { renaming, menuAt } from "../state/menu.ts";
import { basename, stripExt } from "../state/paths.ts";

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
			<div class="ed-pal-head">
				<div class="ed-pal-title">{stripExt(basename(rel))}</div>
				<div class="ed-pal-sub">
					A palette: colour slots other files draw from by name · {users.length ? `linked by ${users.map((u) => stripExt(basename(u))).join(", ")}` : "no file links it yet"}
				</div>
			</div>
			<div class="ed-pal-grid" role="listbox" aria-label="Colours">
				{toks.map((t, k) => (
					<div
						class={cx("ed-pal-tile", k === cur && "selected")}
						role="option"
						tabIndex={0}
						aria-selected={k === cur}
						onClick={() => (ed.curTok.value = k)}
						onDblClick={() => (renaming.value = { kind: "token", index: k })}
						onKeyDown={(e) => {
							if (e.target !== e.currentTarget) return;
							if (e.key === "Enter") renaming.value = { kind: "token", index: k };
							else if (e.key === "Backspace" || e.key === "Delete") deleteToken(k);
							else if (e.key === " ") ed.curTok.value = k;
							else return;
							e.preventDefault();
							e.stopPropagation();
						}}
						onContextMenu={(e) => {
							ed.curTok.value = k;
							menuAt(e, [
								{ label: "Rename", keys: "Enter", run: () => (renaming.value = { kind: "token", index: k }) },
								{ label: "Delete colour", danger: true, sep: true, run: () => deleteToken(k) },
							]);
						}}
					>
						<button
							type="button"
							class="ed-pal-swatch"
							style={{ background: cssColor(t.rgb) }}
							title="Edit the colour"
							aria-label={`Edit ${t.name}`}
							onClick={(e) => {
								e.stopPropagation();
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								setPick({ k, x: r.left, y: r.bottom + 6 });
							}}
						/>
						<div class="ed-pal-label">
							{ren?.kind === "token" && ren.index === k ? (
								<InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
							) : (
								<span class="ed-pal-name">{t.name}</span>
							)}
							<span class="ed-pal-hex">
								{hexOf(t.rgb)}
								{(t.emissive ?? 0) > 0 && (
									<span title="Emissive: gives off light in a game that has it">
										{" · "}
										<Icon name="sun" size={11} /> {t.emissive}
									</span>
								)}
							</span>
						</div>
					</div>
				))}
				<button type="button" class="ed-pal-tile add" onClick={add} title="A new colour slot">
					<Icon name="plus" size={14} /> New colour
				</button>
			</div>
			{pick && toks[pick.k] && (
				<ColorPicker rgb={toks[pick.k].rgb} emissive={toks[pick.k].emissive ?? 0} onEmissive={(v) => setTokenEmissive(pick.k, v)} x={pick.x} y={pick.y} onChange={(rgb: Rgba) => setTokenColor(pick.k, rgb)} onClose={() => setPick(null)} />
			)}
		</div>
	);
}
