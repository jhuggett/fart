// Themes: one token set, several palettes. The stylesheet defines every
// colour as a variable on :root and overrides them per [data-theme]; the
// canvas reads the same variables, so the grid, selection and handles
// follow the panels. The choice persists per device (localStorage), and
// "system" follows the OS between the default dark and light themes.

import { signal } from "@preact/signals";

export interface ThemeInfo {
	id: string;
	name: string;
	blurb: string;
	light?: boolean;
	/** background, panel, accent: the swatch trio in the picker */
	trio: [string, string, string];
}

export const THEMES: ThemeInfo[] = [
	{ id: "graphite", name: "Graphite", blurb: "neutral dark, amber where it counts", trio: ["#131315", "#1c1c1f", "#f5c451"] },
	{ id: "midnight", name: "Midnight", blurb: "blue-black, ice accents", trio: ["#0d1117", "#161b22", "#6fb8ff"] },
	{ id: "moss", name: "Moss", blurb: "deep green, lime accents", trio: ["#10150f", "#182018", "#d7e26a"] },
	{ id: "plum", name: "Plum", blurb: "dark violet, rose accents", trio: ["#16111c", "#1f1826", "#f28cc4"] },
	{ id: "paper", name: "Paper", blurb: "warm light, terracotta accents", light: true, trio: ["#f4f1ea", "#eae6dc", "#c9531f"] },
	{ id: "contrast", name: "High contrast", blurb: "black, white, yellow, thicker lines", trio: ["#000000", "#0a0a0a", "#ffe600"] },
];

export const SYSTEM = "system";
const KEY = "fastart.theme";

export const theme = {
	/** what the user picked: a theme id, or "system" */
	choice: signal<string>(SYSTEM),
	/** the theme actually on the page */
	applied: signal<string>("graphite"),
	/** bumps whenever the palette changes, so canvases redraw */
	rev: signal(0),
};

const lightQuery = () => window.matchMedia("(prefers-color-scheme: light)");

function systemPick(): string {
	return lightQuery().matches ? "paper" : "graphite";
}

function apply() {
	const id = theme.choice.value === SYSTEM ? systemPick() : theme.choice.value;
	const known = THEMES.some((t) => t.id === id) ? id : "graphite";
	document.documentElement.dataset.theme = known;
	theme.applied.value = known;
	colorCache = null;
	theme.rev.value++;
}

export function setTheme(id: string) {
	theme.choice.value = id;
	try {
		localStorage.setItem(KEY, id);
	} catch {
		// a private window, or storage turned off: the choice lasts the session
	}
	apply();
}

export function initTheme() {
	try {
		const saved = localStorage.getItem(KEY);
		if (saved) theme.choice.value = saved;
	} catch {
		// see above
	}
	apply();
	lightQuery().addEventListener("change", () => {
		if (theme.choice.value === SYSTEM) apply();
	});
}

export function isLight(): boolean {
	return THEMES.find((t) => t.id === theme.applied.value)?.light ?? false;
}

/** What the canvas paints with: the stylesheet's tokens, read once per theme. */
export interface CanvasColors {
	bg: string;
	grid: string;
	gridStrong: string;
	accent: string;
	accentSoft: string;
	hover: string;
	handleFill: string;
	ok: string;
	text2: string;
	text3: string;
	marquee: string;
	/** outline weight, in pixels: 1 normally, more for high contrast */
	line: number;
}

let colorCache: CanvasColors | null = null;

export function canvasColors(): CanvasColors {
	if (colorCache) return colorCache;
	const cs = getComputedStyle(document.documentElement);
	const v = (name: string) => cs.getPropertyValue(name).trim();
	colorCache = {
		bg: v("--bg"),
		grid: v("--grid"),
		gridStrong: v("--grid-strong"),
		accent: v("--accent"),
		accentSoft: v("--accent-line"),
		hover: v("--canvas-hover"),
		handleFill: v("--raised"),
		ok: v("--ok"),
		text2: v("--text-2"),
		text3: v("--text-3"),
		marquee: v("--accent-dim"),
		line: parseFloat(v("--line")) || 1,
	};
	return colorCache;
}
