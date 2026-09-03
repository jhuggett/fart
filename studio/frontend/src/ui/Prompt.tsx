import { useEffect, useRef } from "preact/hooks";
import { prompt, promptCommit, promptCancel } from "../state/prompt.ts";

export function Prompt() {
	const ref = useRef<HTMLInputElement>(null);
	const open = prompt.open.value;
	useEffect(() => {
		if (open) {
			ref.current?.focus();
			ref.current?.select();
		}
	}, [open]);
	if (!open) return null;
	return (
		<div class="modal" onPointerDown={(e) => e.target === e.currentTarget && promptCancel()}>
			<div class="dialog">
				<div class="t">{prompt.title.value}</div>
				<input
					ref={(el) => {
						ref.current = el;
						el?.focus(); // on mount, before any effect: a fast typist wins
					}}
					value={prompt.value.value}
					onInput={(e) => (prompt.value.value = (e.target as HTMLInputElement).value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") promptCommit();
						else if (e.key === "Escape") promptCancel();
						e.stopPropagation();
					}}
				/>
				<div class="hint">Enter confirms · Esc cancels</div>
			</div>
		</div>
	);
}
