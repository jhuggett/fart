// The clip timeline under the canvas: a ruler with the keys on it, a
// playhead to scrub, play and loop, and the selected key's state, ease and
// time. Keys name states; posing happens in the state.

import { useEffect, useRef } from "preact/hooks";
import { clipDuration, type Curve, type Ease } from "@fastart/core";
import { ed, curClip, states, addKey, deleteKey, setKeyTime, setKeyState, setKeyEase, setKeyCurve, setKeyEvents, seek, endGesture } from "../state/editor.ts";

const EASES: Ease[] = ["linear", "in", "out", "in-out", "step"];
/** Curves worth a name (1.2); "custom" keeps whatever the numbers say. */
const CURVES: { name: string; curve: Curve; ease: Ease }[] = [
	{ name: "back out", curve: [0.34, 1.56, 0.64, 1], ease: "out" },
	{ name: "back in", curve: [0.36, 0, 0.66, -0.56], ease: "in" },
	{ name: "quint out", curve: [0.22, 1, 0.36, 1], ease: "out" },
	{ name: "quint in", curve: [0.64, 0, 0.78, 0], ease: "in" },
	{ name: "sine in-out", curve: [0.37, 0, 0.63, 1], ease: "in-out" },
];
const curveName = (c: Curve | undefined) => (c ? (CURVES.find((k) => k.curve.every((v, i) => Math.abs(v - c[i]) < 1e-6))?.name ?? "custom") : "");
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
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			// no live pointer to capture: the click still counts
		}
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
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			// as above
		}
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
					<span
						class={`key ${i === ki ? "active" : ""} ${k.events?.length ? "ev" : ""}`}
						style={{ left: left(k.t) }}
						title={`${k.state ?? "inline"} @ ${k.t}s${k.events?.length ? ` · ${k.events.join(", ")}` : ""}`}
						onPointerDown={(e) => dragKey(i, e)}
					/>
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
					<select class="picker" value={key.ease ?? "linear"} onChange={(e) => setKeyEase(ki, (e.target as HTMLSelectElement).value as Ease)} title="how time approaches this key" disabled={!!key.curve}>
						{EASES.map((e) => (
							<option value={e}>{e}</option>
						))}
					</select>
					<select
						class="picker"
						value={curveName(key.curve)}
						title="a bezier curve toward this key; it wins over the ease, which stays as the nearest name for older readers"
						onChange={(e) => {
							const v = (e.target as HTMLSelectElement).value;
							if (!v) return setKeyCurve(ki, undefined);
							const preset = CURVES.find((c) => c.name === v);
							if (preset) {
								setKeyCurve(ki, preset.curve);
								setKeyEase(ki, preset.ease);
							} else setKeyCurve(ki, key.curve ?? [0.42, 0, 0.58, 1]);
						}}
					>
						<option value="">no curve</option>
						{CURVES.map((c) => (
							<option value={c.name}>{c.name}</option>
						))}
						<option value="custom">custom…</option>
					</select>
					{key.curve &&
						key.curve.map((v, j) => (
							<input
								class="num"
								type="number"
								step={0.01}
								value={v}
								title={["x1", "y1", "x2", "y2"][j]}
								onInput={(e) => {
									const n = Number((e.target as HTMLInputElement).value);
									if (!Number.isFinite(n)) return;
									const c = [...key.curve!] as Curve;
									c[j] = n;
									setKeyCurve(ki, c, `curve-${ki}`);
								}}
								onBlur={endGesture}
								onKeyDown={(e) => e.stopPropagation()}
							/>
						))}
					<input
						class="text"
						placeholder="events"
						value={key.events?.join(", ") ?? ""}
						title="names a game hears when the playhead crosses this key: footstep, hit, …  (comma-separated)"
						onChange={(e) => setKeyEvents(ki, (e.target as HTMLInputElement).value.split(","))}
						onKeyDown={(e) => e.stopPropagation()}
					/>
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
