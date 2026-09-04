// Renaming, inline: a field that takes the row's place. Enter commits,
// Esc cancels, leaving the field commits too.

export function InlineName(props: { value: string; onCommit: (name: string) => void; onCancel: () => void; class?: string; focus?: boolean }) {
	let done = false;
	const commit = (el: HTMLInputElement) => {
		if (done) return;
		done = true;
		const v = el.value.trim();
		if (v && v !== props.value) props.onCommit(v);
		else props.onCancel();
	};
	return (
		<input
			class={`rename ${props.class ?? ""}`}
			defaultValue={props.value}
			ref={(el) => {
				if (props.focus === false) return;
				if (el && document.activeElement !== el) {
					el.focus();
					el.select();
				}
			}}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Enter") commit(e.currentTarget);
				else if (e.key === "Escape") {
					done = true;
					props.onCancel();
				}
			}}
			onBlur={(e) => commit(e.currentTarget)}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
			onDblClick={(e) => e.stopPropagation()}
		/>
	);
}
