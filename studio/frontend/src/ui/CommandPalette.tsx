// Cmd K: every command the studio has, by name.

import { useEffect, useRef } from "preact/hooks";
import { commands, run, keysFor, commandRev } from "../state/commands.ts";
import { palette, closePalette } from "../state/menu.ts";
import { Icon, cx } from "./ur.tsx";

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
		<div class="cmdk-layer" onPointerDown={(e) => e.target === e.currentTarget && closePalette()}>
			<div class="cmdk" role="dialog" aria-label="Commands">
				<div class="ur-tf cmdk-field">
					<Icon name="search" size={14} />
					<input
						ref={ref}
						placeholder="Do what?"
						spellcheck={false}
						autocomplete="off"
						aria-label="Command"
						value={palette.query.value}
						onInput={(e) => {
							palette.query.value = (e.target as HTMLInputElement).value;
							palette.index.value = 0;
						}}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") closePalette();
							else if (e.key === "ArrowDown") {
								e.preventDefault();
								palette.index.value = Math.min(idx + 1, list.length - 1);
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								palette.index.value = Math.max(idx - 1, 0);
							} else if (e.key === "Enter") go(idx);
						}}
					/>
				</div>
				<div class="cmdk-list" role="listbox">
					{list.map((c, i) => {
						const keys = keysFor(c.id) ?? c.keys ?? "";
						return (
							<div
								key={c.id}
								class={cx("ur-menu-item", i === idx && "active")}
								role="option"
								aria-selected={i === idx}
								ref={(el) => {
									if (el && i === idx) el.scrollIntoView({ block: "nearest" });
								}}
								onPointerEnter={() => (palette.index.value = i)}
								onClick={() => go(i)}
							>
								<span class="ur-menu-label">{c.title}</span>
								<span class="cmdk-group">{c.group}</span>
								{keys && <span class="ur-menu-key">{keys}</span>}
							</div>
						);
					})}
					{list.length === 0 && <div class="cmdk-empty">Nothing by that name</div>}
				</div>
			</div>
		</div>
	);
}
