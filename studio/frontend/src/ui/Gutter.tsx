// A gutter on a panel's edge: drag it to resize the panel, double-click
// to put it back. It sits on the edge named, outside the panel's scroll.

import { layout, setSize, resetSize, saveLayout, type SizeKey } from "../state/layout.ts";

export function Gutter({ k, edge }: { k: SizeKey; edge: "left" | "right" | "top" }) {
	const onDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		const el = e.currentTarget as HTMLElement;
		try {
			el.setPointerCapture(e.pointerId);
		} catch {
			// no live pointer: the drag still follows the events it gets
		}
		const start = layout.sizes.value[k];
		const x0 = e.clientX;
		const y0 = e.clientY;
		layout.dragging.value = k;
		document.body.classList.add(edge === "top" ? "resizing-y" : "resizing-x");
		const move = (ev: PointerEvent) => {
			const d = edge === "right" ? ev.clientX - x0 : edge === "left" ? x0 - ev.clientX : y0 - ev.clientY;
			setSize(k, start + d);
		};
		const up = () => {
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
			el.removeEventListener("pointercancel", up);
			document.body.classList.remove("resizing-x", "resizing-y");
			layout.dragging.value = null;
			saveLayout();
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
		el.addEventListener("pointercancel", up);
		e.preventDefault();
	};
	return <div class={`gutter ${edge} ${layout.dragging.value === k ? "active" : ""}`} title="drag to resize · double-click to reset" onPointerDown={onDown} onDblClick={() => resetSize(k)} />;
}
