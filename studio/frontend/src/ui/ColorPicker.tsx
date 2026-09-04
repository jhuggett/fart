// A colour picker: saturation and value on the square, hue and alpha on
// strips, hex and the four channels as fields. Edits a token live.

import { useState } from "preact/hooks";
import type { Rgba } from "@fastart/core";
import { endGesture } from "../state/editor.ts";

function rgbToHsv([r, g, b]: Rgba): [number, number, number] {
	const R = r / 255;
	const G = g / 255;
	const B = b / 255;
	const max = Math.max(R, G, B);
	const min = Math.min(R, G, B);
	const d = max - min;
	let h = 0;
	if (d > 0) {
		if (max === R) h = ((G - B) / d) % 6;
		else if (max === G) h = (B - R) / d + 2;
		else h = (R - G) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let [r, g, b] = [0, 0, 0];
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const hex = (rgb: Rgba) => "#" + rgb.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join("");

export function ColorPicker(props: { rgb: Rgba; onChange: (rgb: Rgba) => void; onClose: () => void; x: number; y: number }) {
	const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(props.rgb));
	const [h, s, v] = hsv;
	const a = props.rgb[3];
	const emit = (nh: number, ns: number, nv: number, na = a) => {
		setHsv([nh, ns, nv]);
		const [r, g, b] = hsvToRgb(nh, ns, nv);
		props.onChange([r, g, b, Math.round(na)]);
	};
	const drag = (e: PointerEvent, fn: (u: number, w: number) => void) => {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const at = (ev: PointerEvent) => {
			const r = el.getBoundingClientRect();
			fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
		};
		at(e);
		const move = (ev: PointerEvent) => at(ev);
		const up = () => {
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
			endGesture();
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
	};
	const hueCss = `hsl(${h}, 100%, 50%)`;
	const cur = hex(props.rgb);
	const left = Math.min(props.x, window.innerWidth - 260);
	const top = Math.min(props.y, window.innerHeight - 320);
	return (
		<div class="pick-pop" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()}>
			<div class="sv" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueCss})` }} onPointerDown={(e) => drag(e, (u, w) => emit(h, u, 1 - w))}>
				<span class="knob" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: cur }} />
			</div>
			<div class="strip hue" onPointerDown={(e) => drag(e, (u) => emit(u * 360, s, v))}>
				<span class="knob" style={{ left: `${(h / 360) * 100}%`, background: hueCss }} />
			</div>
			<div class="strip alpha" onPointerDown={(e) => drag(e, (u) => emit(h, s, v, u * 255))}>
				<span class="fill" style={{ background: `linear-gradient(to right, transparent, ${cur})` }} />
				<span class="knob" style={{ left: `${(a / 255) * 100}%`, background: cur }} />
			</div>
			<div class="chan">
				<input
					class="num text"
					value={cur}
					onChange={(e) => {
						const m = /^#?([0-9a-f]{6})$/i.exec((e.target as HTMLInputElement).value.trim());
						if (!m) return;
						const n = parseInt(m[1], 16);
						const rgb: Rgba = [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
						setHsv(rgbToHsv(rgb));
						props.onChange(rgb);
						endGesture();
					}}
					onKeyDown={(e) => e.stopPropagation()}
				/>
				{(["R", "G", "B", "A"] as const).map((l, i) => (
					<input
						class="num"
						type="number"
						min={0}
						max={255}
						value={props.rgb[i]}
						title={l}
						onInput={(e) => {
							const n = Math.max(0, Math.min(255, Number((e.target as HTMLInputElement).value)));
							if (!Number.isFinite(n)) return;
							const rgb = [...props.rgb] as Rgba;
							rgb[i] = Math.round(n);
							setHsv(rgbToHsv(rgb));
							props.onChange(rgb);
						}}
						onBlur={endGesture}
						onKeyDown={(e) => e.stopPropagation()}
					/>
				))}
			</div>
			<button class="btn small ghost" style="width:100%;margin-top:6px" onClick={props.onClose}>
				done
			</button>
		</div>
	);
}
