import { useEffect, useRef } from "preact/hooks";
import { prompt, promptCommit, promptCancel, confirmBox, confirmAnswer } from "../state/prompt.ts";

/** A yes/no: Enter is yes, Esc is no, and the yes button holds focus. */
export function Confirm() {
	if (!confirmBox.open.value) return null;
	return (
		<div class="modal" onPointerDown={(e) => e.target === e.currentTarget && confirmAnswer(false)}>
			<div
				class="dialog"
				onKeyDown={(e) => {
					if (e.key === "Enter") confirmAnswer(true);
					else if (e.key === "Escape") confirmAnswer(false);
					e.stopPropagation();
				}}
			>
				<div class="t">{confirmBox.title.value}</div>
				{confirmBox.body.value && <div class="body">{confirmBox.body.value}</div>}
				<div class="actions">
					<button class="btn ghost" onClick={() => confirmAnswer(false)}>
						Cancel
					</button>
					<button class={`btn ${confirmBox.danger.value ? "danger" : "primary"}`} ref={(el) => el?.focus()} onClick={() => confirmAnswer(true)}>
						{confirmBox.ok.value}
					</button>
				</div>
			</div>
		</div>
	);
}

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
