import { useEffect } from "preact/hooks";
import { contextMenu, closeContextMenu } from "../state/menu.ts";

export function ContextMenu() {
	const m = contextMenu.value;
	useEffect(() => {
		if (!m) return;
		const down = (e: PointerEvent) => {
			if (!(e.target as HTMLElement).closest(".ctx")) closeContextMenu();
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeContextMenu();
		};
		window.addEventListener("pointerdown", down, true);
		window.addEventListener("keydown", key, true);
		return () => {
			window.removeEventListener("pointerdown", down, true);
			window.removeEventListener("keydown", key, true);
		};
	}, [m]);
	if (!m) return null;
	const left = Math.min(m.x, window.innerWidth - 220);
	const top = Math.min(m.y, window.innerHeight - 40 - m.items.length * 26);
	return (
		<div class="ctx" style={{ left, top }}>
			{m.items.map((it) => (
				<>
					{it.sep && <div class="hairline" style="margin:4px 0" />}
					<div
						class={`row ${it.danger ? "danger" : ""} ${it.disabled ? "off" : ""}`}
						onClick={() => {
							if (it.disabled) return;
							closeContextMenu();
							it.run?.();
						}}
					>
						<span class="name">{it.label}</span>
						{it.keys && <span class="chip">{it.keys}</span>}
					</div>
				</>
			))}
		</div>
	);
}
