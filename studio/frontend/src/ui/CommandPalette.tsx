// Cmd K: every command the studio has, by name.

import { useEffect, useRef } from "preact/hooks";
import { commands, run, keysFor, commandRev } from "../state/commands.ts";
import { palette, closePalette } from "../state/menu.ts";

export function CommandPalette() {
	const open = palette.open.value;
	const ref = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (open) ref.current?.focus();
	}, [open]);
	if (!open) return null;
	void commandRev.value;
	const q = palette.query.value.trim().toLowerCase();
	const list = commands()
		.filter((c) => !c.when || c.when())
		.filter((c) => !q || c.title.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
		.slice(0, 40);
	const idx = Math.min(palette.index.value, Math.max(list.length - 1, 0));
	const go = (i: number) => {
		const c = list[i];
		if (!c) return;
		closePalette();
		run(c.id);
	};
	return (
		<div class="modal" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
			<div class="cmdk">
				<input
					ref={ref}
					placeholder="Do what?"
					value={palette.query.value}
					onInput={(e) => {
						palette.query.value = (e.target as HTMLInputElement).value;
						palette.index.value = 0;
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Escape") closePalette();
						else if (e.key === "ArrowDown") palette.index.value = Math.min(idx + 1, list.length - 1);
						else if (e.key === "ArrowUp") palette.index.value = Math.max(idx - 1, 0);
						else if (e.key === "Enter") go(idx);
					}}
				/>
				<div class="list">
					{list.map((c, i) => (
						<div class={`row ${i === idx ? "active" : ""}`} onPointerEnter={() => (palette.index.value = i)} onClick={() => go(i)}>
							<span class="chip" style="margin:0 8px 0 0;min-width:52px">{c.group}</span>
							<span class="name">{c.title}</span>
							<span class="chip">{keysFor(c.id) ?? c.keys ?? ""}</span>
						</div>
					))}
					{list.length === 0 && <div class="empty">nothing by that name</div>}
				</div>
			</div>
		</div>
	);
}
