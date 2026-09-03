import { ed, selShape, colShape, mutate, deleteSel, selOrder, selToPart, parts } from "../state/editor.ts";
import { Slider } from "./Slider.tsx";

export function SelectedCard() {
	void ed.rev.value;
	const collide = ed.collide.value;
	const sh = collide ? colShape() : selShape();
	const n = collide ? (ed.colSel.value >= 0 ? 1 : 0) : ed.sel.value.length;
	if (!sh || !n) return null;
	const elsewhere = !collide && ed.sel.value.some((r) => r.p !== ed.curPart.value);
	const partName = collide ? "collision" : parts()[ed.sel.value[ed.sel.value.length - 1].p]?.name;
	return (
		<>
			<div class="hdr">
				Selected <span class="hint">{n > 1 ? `${n} shapes` : sh.kind}</span>
			</div>
			<div class="card">
				<div class="line">
					<span class="k">kind</span>
					<span>{n > 1 ? "a crowd" : sh.kind}</span>
				</div>
				<div class="line">
					<span class="k">{collide ? "list" : "token"}</span>
					<span>{collide ? "collision" : (sh.color ?? "—")}</span>
				</div>
				{!collide && (
					<div class="line">
						<span class="k">part</span>
						<span>{partName}</span>
					</div>
				)}
				{sh.kind === "line" && n === 1 && (
					<Slider
						label={collide ? "girth" : "w"}
						value={sh.w}
						min={0.1}
						max={collide ? 40 : 10}
						step={0.1}
						show={(v) => v.toFixed(1)}
						onInput={(v) =>
							mutate(() => {
								sh.w = v;
							}, "width")
						}
					/>
				)}
				{!collide && (
					<div class="line" style="margin-top:8px">
						<button class="btn small ghost" title="raise  ]" onClick={() => selOrder(true)}>
							raise
						</button>
						<button class="btn small ghost" title="lower  [" onClick={() => selOrder(false)}>
							lower
						</button>
						{elsewhere && (
							<button class="btn small ghost" title="move into the current part" onClick={selToPart}>
								to part
							</button>
						)}
					</div>
				)}
				<div class="line">
					<button class="btn small ghost danger" title="delete  X" onClick={deleteSel}>
						delete
					</button>
				</div>
			</div>
		</>
	);
}
