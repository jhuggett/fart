import { cssColor, type Rgba } from "@fastart/core";
import { ed, palette, addToken, deleteToken, renameToken, setTokenColor, paintSel } from "../state/editor.ts";
import { ask } from "../state/prompt.ts";
import { Slider } from "./Slider.tsx";

export function PalettePanel() {
	void ed.rev.value;
	const toks = palette();
	const shared = ed.shared.value;
	const cur = ed.curTok.value;
	const tk = toks[cur];
	const chan = (i: number, v: number) => {
		if (!tk) return;
		const rgb = [...tk.rgb] as Rgba;
		rgb[i] = Math.round(v);
		setTokenColor(cur, rgb);
	};
	return (
		<>
			<div class="hdr">Palette</div>
			{toks.map((t, k) => (
				<div
					class={`row ${k === cur ? "active" : ""}`}
					onClick={() => {
						ed.curTok.value = k;
						paintSel(t.name);
					}}
					onDblClick={() => void ask("New name for the token", t.name).then((n) => n && renameToken(k, n))}
				>
					<span class="swatch" style={{ background: cssColor(t.rgb) }} />
					<span class="name">{t.name}</span>
					{k === cur && (
						<span class="tail">
							<button
								class="btn x"
								title="delete token"
								onClick={(e) => {
									e.stopPropagation();
									deleteToken(k);
								}}
							>
								×
							</button>
						</span>
					)}
				</div>
			))}
			{shared.length > 0 && (
				<>
					<div class="hdr">Shared</div>
					{shared.map((t) => (
						<div class="row dim" title="shared through palette_refs: paint with it here, edit it in its own file" onClick={() => paintSel(t.name)}>
							<span class="swatch" style={{ background: cssColor(t.rgb) }} />
							<span class="name">{t.name}</span>
						</div>
					))}
				</>
			)}
			<button class="add-row" onClick={() => void ask("Name the new token").then((n) => n && addToken(n))}>
				+ token
			</button>
			{tk && (
				<>
					<div class="hdr">
						Colour <span class="hint">{tk.name}</span>
					</div>
					<Slider label="R" value={tk.rgb[0]} min={0} max={255} onInput={(v) => chan(0, v)} />
					<Slider label="G" value={tk.rgb[1]} min={0} max={255} onInput={(v) => chan(1, v)} />
					<Slider label="B" value={tk.rgb[2]} min={0} max={255} onInput={(v) => chan(2, v)} />
					<Slider label="A" value={tk.rgb[3]} min={0} max={255} onInput={(v) => chan(3, v)} />
					<div class="preview" style={{ background: cssColor(tk.rgb) }} />
				</>
			)}
		</>
	);
}
