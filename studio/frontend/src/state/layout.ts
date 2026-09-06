// The panels' sizes: the explorer, the layers column, the inspector, the
// Ask panel in either dock. Each is a CSS variable the grids read, dragged
// at a gutter (ui/Gutter.tsx) and remembered per device.

import { signal } from "@preact/signals";

export type SizeKey = "explorer" | "left" | "right" | "chat" | "chatH";

const KEY = "fastart.layout";
const DEFAULTS: Record<SizeKey, number> = { explorer: 208, left: 232, right: 240, chat: 380, chatH: 280 };
const LIMITS: Record<SizeKey, [number, number]> = {
	explorer: [150, 420],
	left: [180, 480],
	right: [200, 560],
	chat: [280, 760],
	chatH: [160, 640],
};
const VARS: Record<SizeKey, string> = { explorer: "--explorer", left: "--left", right: "--right", chat: "--chat", chatH: "--chat-h" };

function saved(): Record<SizeKey, number> {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<SizeKey, number>>;
		const out = { ...DEFAULTS };
		for (const k of Object.keys(DEFAULTS) as SizeKey[]) if (typeof raw[k] === "number") out[k] = clamp(k, raw[k]!);
		return out;
	} catch {
		return { ...DEFAULTS };
	}
}

function clamp(k: SizeKey, px: number): number {
	const [lo, hi] = LIMITS[k];
	// never more than half the window, whatever was remembered
	const cap = k === "chatH" ? window.innerHeight * 0.6 : window.innerWidth * 0.5;
	return Math.round(Math.max(lo, Math.min(hi, cap, px)));
}

export const layout = {
	sizes: signal<Record<SizeKey, number>>(saved()),
	/** a gutter is being dragged */
	dragging: signal<SizeKey | null>(null),
};

/** Put the sizes on :root, where the stylesheet reads them. */
export function applyLayout() {
	const s = layout.sizes.value;
	for (const k of Object.keys(VARS) as SizeKey[]) document.documentElement.style.setProperty(VARS[k], `${s[k]}px`);
}

export function setSize(k: SizeKey, px: number) {
	const next = clamp(k, px);
	if (next === layout.sizes.value[k]) return;
	layout.sizes.value = { ...layout.sizes.value, [k]: next };
	applyLayout();
}

export function resetSize(k: SizeKey) {
	setSize(k, DEFAULTS[k]);
	saveLayout();
}

export function saveLayout() {
	try {
		localStorage.setItem(KEY, JSON.stringify(layout.sizes.value));
	} catch {
		// the sizes last the session
	}
}
