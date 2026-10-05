// The menu layer: one dropdown at a time, fixed to the window so no
// column clips it. ↑ ↓ move, Return chooses, Escape closes, a pointer
// down outside closes. (A right click in the app never comes here: the
// platform draws that menu itself.)

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { contextMenu, closeContextMenu, menuAnchor } from "../state/menu.ts";
import { Icon, cx } from "./ur.tsx";

export function ContextMenu() {
	const m = contextMenu.value;
	const ref = useRef<HTMLDivElement>(null);
	const [act, setAct] = useState(-1);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	useEffect(() => {
		setAct(-1);
		if (!m) return;
		const down = (e: PointerEvent) => {
			const t = e.target as HTMLElement;
			if (t.closest(".ur-menu")) return;
			// the button that opened it closes it itself
			if (menuAnchor.value?.contains(t)) return;
			closeContextMenu();
		};
		window.addEventListener("pointerdown", down, true);
		window.addEventListener("blur", closeContextMenu);
		return () => {
			window.removeEventListener("pointerdown", down, true);
			window.removeEventListener("blur", closeContextMenu);
		};
	}, [m]);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!m || !el) return setPos(null);
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		let left = m.align === "right" ? m.x - w : m.x;
		let top = m.y;
		left = Math.max(6, Math.min(left, window.innerWidth - w - 6));
		if (top + h > window.innerHeight - 6) top = Math.max(6, window.innerHeight - h - 6);
		setPos({ left, top });
		el.focus();
	}, [m]);
	if (!m) return null;
	const live = m.items.map((it, i) => (it.header || it.disabled ? -1 : i)).filter((i) => i >= 0);
	const pick = (i: number) => {
		const it = m.items[i];
		if (!it || it.disabled || it.header) return;
		closeContextMenu();
		it.run?.();
	};
	return (
		<div
			ref={ref}
			class={cx("ur-menu", "ur-menu-layer", m.class)}
			role="menu"
			tabIndex={-1}
			style={{ left: `${pos?.left ?? m.x}px`, top: `${pos?.top ?? m.y}px`, minWidth: m.minWidth ? `${m.minWidth}px` : undefined, visibility: pos ? "visible" : "hidden" }}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Escape") {
					e.preventDefault();
					closeContextMenu();
				} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					e.preventDefault();
					if (!live.length) return;
					const at = live.indexOf(act);
					setAct(live[e.key === "ArrowDown" ? (at + 1) % live.length : at <= 0 ? live.length - 1 : at - 1]);
				} else if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					pick(act);
				}
			}}
		>
			{m.items.map((it, i) => (
				<>
					{it.sep && <div class="ur-menu-sep" role="separator" />}
					{it.header ? (
						<div class="ur-menu-head">{it.label}</div>
					) : (
						<div role="menuitem" aria-disabled={!!it.disabled} class={cx("ur-menu-item", i === act && "active", it.danger && "danger", it.disabled && "disabled")} onMouseEnter={() => setAct(it.disabled ? -1 : i)} onClick={() => pick(i)}>
							<span class="ur-menu-check">{it.checked ? <Icon name="check" strokeWidth={2.5} /> : null}</span>
							{it.icon && <Icon name={it.icon} />}
							<span class="ur-menu-label">{it.label}</span>
							{it.keys && <span class="ur-menu-key">{it.keys}</span>}
						</div>
					)}
				</>
			))}
		</div>
	);
}
