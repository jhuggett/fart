import { endGesture } from "../state/editor.ts";

export function Slider(props: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	show?: (v: number) => string;
	onInput: (v: number) => void;
}) {
	return (
		<label class="slider">
			<span>{props.label}</span>
			<input
				type="range"
				min={props.min}
				max={props.max}
				step={props.step ?? 1}
				value={props.value}
				onInput={(e) => props.onInput(Number((e.target as HTMLInputElement).value))}
				onChange={endGesture}
				onPointerUp={endGesture}
				onKeyUp={endGesture}
			/>
			<span class="v">{props.show ? props.show(props.value) : Math.round(props.value)}</span>
		</label>
	);
}
