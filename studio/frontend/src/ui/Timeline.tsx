// The clip timeline under the canvas: a ruler with the keys on it, a
// playhead to scrub, play and loop, and the selected key's state, ease and
// time. Keys name states; posing happens in the state.

import { useEffect, useRef } from "preact/hooks";
import { clipDuration, type Ease } from "@fastart/core";
import { ed, curClip, states, addKey, deleteKey, setKeyTime, setKeyState, setKeyEase, seek, endGesture } from "../state/editor.ts";

const EASES: Ease[] = ["linear", "in", "out", "in-out", "step"];
const PAD = 14;

export function Timeline() {
	void ed.rev.value;
	const clip = curClip();
	const track = useRef<HTMLDivElement>(null);
	const playing = ed.playing.value;

	// playback: advance the clock each frame
	useEffect(() => {
		if (!playing || !clip) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const dt = (now - last) / 1000;
			last = now;
			const dur = clipDuration(clip);
			let t = ed.clipTime.value + dt;
			if (dur <= 0) t = 0;
			else if (t >= dur) {
				if (clip.loop) t = t % dur;
				else {
					t = dur;
					ed.playing.value = false;
				}
			}
			ed.clipTime.value = t;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, clip]);

	if (!clip) return null;
	const dur = clipDuration(clip);
	const span = Math.max(dur, 1);
	const t = ed.clipTime.value;
	const ki = ed.curKey.value;
	const key = clip.keys[ki];

	const toT = (clientX: number) => {
		const r = track.current!.getBoundingClientRect();
		const u = (clientX - r.left - PAD) / Math.max(r.width - 2 * PAD, 1);
		return Math.max(0, Math.min(span, u * span));
	};
	const pct = (time: number) => `${PAD + (time / span) * 100}%`;
	const left = (time: number) => `calc(${PAD}px + (100% - ${2 * PAD}px) * ${time / span})`;

	const scrub = (e: PointerEvent) => {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		ed.playing.value = false;
		seek(toT(e.clientX));
		const move = (ev: PointerEvent) => seek(toT(ev.clientX));
		const up = () => {
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
	};
	const dragKey = (i: number, e: PointerEvent) => {
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		ed.playing.value = false;
		ed.curKey.value = i;
		ed.clipTime.value = clip.keys[i].t; // picking a key is also going there
		let idx = i;
		const move = (ev: PointerEvent) => {
			const nt = Math.round(toT(ev.clientX) * 100) / 100;
			setKeyTime(idx, nt, "key-time");
			idx = ed.curKey.value;
			ed.clipTime.value = nt;
		};
		const up = () => {
			endGesture();
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
	};

	void pct;
	return (
		<div class="timeline">
			<button class="btn small" title="play / pause  (Space)" onClick={() => (ed.playing.value = !playing)}>
				{playing ? "❚❚" : "▶"}
			</button>
			<span class="time">
				{t.toFixed(2)} / {dur.toFixed(2)} s
			</span>
			<div class="track" ref={track} onPointerDown={scrub}>
				{Array.from({ length: Math.floor(span) + 1 }, (_, s) => (
					<span class="tick" style={{ left: left(s) }}>
						{s}s
					</span>
				))}
				{clip.keys.map((k, i) => (
					<span class={`key ${i === ki ? "active" : ""}`} style={{ left: left(k.t) }} title={`${k.state ?? "inline"} @ ${k.t}s`} onPointerDown={(e) => dragKey(i, e)} />
				))}
				<span class="playhead" style={{ left: left(t) }} />
			</div>
			<button class="btn small ghost" title="a key at the playhead" onClick={addKey}>
				+ key
			</button>
			{key && (
				<>
					<select class="picker" value={key.state ?? ""} onChange={(e) => setKeyState(ki, (e.target as HTMLSelectElement).value)} title="the state this key shows">
						{key.state === undefined && <option value="">inline pose</option>}
						{states().map((s) => (
							<option value={s.name}>{s.name}</option>
						))}
					</select>
					<select class="picker" value={key.ease ?? "linear"} onChange={(e) => setKeyEase(ki, (e.target as HTMLSelectElement).value as Ease)} title="how time approaches this key">
						{EASES.map((e) => (
							<option value={e}>{e}</option>
						))}
					</select>
					<input
						class="num"
						type="number"
						min={0}
						step={0.05}
						value={key.t}
						onChange={(e) => setKeyTime(ki, Number((e.target as HTMLInputElement).value))}
						title="seconds"
					/>
					<button class="btn x" title="delete key" disabled={clip.keys.length < 2} onClick={() => deleteKey(ki)}>
						×
					</button>
				</>
			)}
		</div>
	);
}
