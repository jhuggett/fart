// A number field: a label and a typed value. Live as you type; the
// gesture (for undo) closes when the field is left. The look is the
// design system's (ur-field, ur-tf); the liveness is the editor's.

import { useEffect, useRef, useState } from "preact/hooks";
import { endGesture } from "../state/editor.ts";
import { Property, TextField, cx } from "./ur.tsx";

const tidy = (n: number) => String(Math.round(n * 1000) / 1000);

/** The field alone: every keystroke that reads as a number lands at once; ↑ ↓ step (⇧ ×10). */
export function LiveNumber(props: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; title?: string; label?: string; axis?: "x" | "y" | "z"; suffix?: string; width?: number; disabled?: boolean }) {
	const shown = Number.isFinite(props.value) ? tidy(props.value) : "";
	const [v, set] = useState(shown);
	const live = useRef(false);
	useEffect(() => {
		if (!live.current) set(shown);
	}, [shown]);
	const bump = (d: number) => {
		let n = (Number(v) || 0) + d * (props.step ?? 0.1);
		if (props.min != null) n = Math.max(props.min, n);
		if (props.max != null) n = Math.min(props.max, n);
		n = Math.round(n * 1000) / 1000;
		set(tidy(n));
		props.onChange(n);
	};
	const scrub = (e: PointerEvent) => {
		if (props.disabled) return;
		const el = e.currentTarget as HTMLElement;
		const x0 = e.clientX;
		const start = Number(v) || 0;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			const n = Math.round((start + Math.round((ev.clientX - x0) / 3) * (props.step ?? 0.1) * (ev.shiftKey ? 10 : 1)) * 1000) / 1000;
			set(tidy(n));
			props.onChange(n);
		};
		const up = () => {
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
			endGesture();
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
		e.preventDefault();
	};
	return (
		<div class={cx("ur-field", props.disabled && "disabled")} title={props.title} style={props.width ? { width: `${props.width}px` } : undefined}>
			{props.axis && (
				<span class={`ur-field-axis ${props.axis}`} onPointerDown={scrub}>
					{props.axis.toUpperCase()}
				</span>
			)}
			<input
				value={v}
				inputMode="decimal"
				disabled={props.disabled}
				aria-label={props.label ?? props.axis ?? props.title}
				onFocus={() => (live.current = true)}
				onInput={(e) => {
					const raw = (e.target as HTMLInputElement).value;
					set(raw);
					const n = Number(raw);
					if (raw.trim() !== "" && Number.isFinite(n)) props.onChange(n);
				}}
				onBlur={() => {
					live.current = false;
					set(shown);
					endGesture();
				}}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
					else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						bump((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
					}
				}}
			/>
			{props.suffix && <span class="ur-field-suffix">{props.suffix}</span>}
		</div>
	);
}

export function Num(props: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; title?: string; wide?: boolean }) {
	return (
		<Property label={props.label} title={props.title}>
			<LiveNumber label={props.label} value={props.value} step={props.step} min={props.min} max={props.max} onChange={props.onChange} />
		</Property>
	);
}

export function Text(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
	return (
		<Property label={props.label}>
			<TextField value={props.value} placeholder={props.placeholder} onChange={props.onChange} onBlur={endGesture} onSubmit={() => (document.activeElement as HTMLElement | null)?.blur()} />
		</Property>
	);
}
