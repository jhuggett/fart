import { endGesture } from "../state/editor.ts";
import { Property } from "./ur.tsx";

export function Slider(props: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	title?: string;
	show?: (v: number) => string;
	onInput: (v: number) => void;
}) {
	return (
		<Property label={props.label} title={props.title}>
			<input
				class="ed-range"
				type="range"
				aria-label={props.label}
				min={props.min}
				max={props.max}
				step={props.step ?? 1}
				value={props.value}
				onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))}
				onChange={endGesture}
				onPointerUp={endGesture}
				onKeyUp={endGesture}
			/>
			<span class="ed-range-val">{props.show ? props.show(props.value) : Math.round(props.value)}</span>
		</Property>
	);
}
