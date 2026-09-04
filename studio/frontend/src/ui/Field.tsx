// A number field: a label and a typed value. Live as you type; the
// gesture (for undo) closes when the field is left.

import { endGesture } from "../state/editor.ts";

export function Num(props: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; title?: string; wide?: boolean }) {
	return (
		<label class={`field ${props.wide ? "wide" : ""}`} title={props.title}>
			<span class="k">{props.label}</span>
			<input
				class="num"
				type="number"
				step={props.step ?? 0.1}
				min={props.min}
				max={props.max}
				value={Math.round(props.value * 1000) / 1000}
				onInput={(e) => {
					const v = Number((e.target as HTMLInputElement).value);
					if (Number.isFinite(v)) props.onChange(v);
				}}
				onBlur={endGesture}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
				}}
			/>
		</label>
	);
}

export function Text(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
	return (
		<label class="field wide">
			<span class="k">{props.label}</span>
			<input
				class="num text"
				type="text"
				value={props.value}
				placeholder={props.placeholder}
				onInput={(e) => props.onChange((e.target as HTMLInputElement).value)}
				onBlur={endGesture}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
				}}
			/>
		</label>
	);
}
