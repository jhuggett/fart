// A part's shapes as rows in the outline, end to end, in the served studio
// with a headless browser and real pointer events: which parts open, the
// rows listed (count, order, labels), folding, a click on a row choosing
// the shape as the canvas does, a click on the canvas opening and marking
// the row, the row's menu and Delete as one undo step each, and the file
// on disk untouched by folding and choosing. Then the same list in the 2D
// editor. `node studio/test/layers.mjs [dir for screenshots]` (needs the
// app built: npx vite build in studio/frontend, go build -o bin/studio .
// in studio).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { box, stringifyDoc } from "../../packages/core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus")].filter((b) => fs.existsSync(b)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!bin) {
	console.error("no studio binary: go build -o bin/studio . in studio/");
	process.exit(2);
}
const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

// ------------------------------------------------------------- the project
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-layers-"));
const palette = [
	{ name: "steel", rgb: [150, 160, 175, 255] },
	{ name: "skin", rgb: [224, 172, 140, 255] },
	{ name: "trim", rgb: [200, 150, 40, 255] },
];
// one part holding shapes of every kind, spread along x so each can be clicked; a child of one shape; a child of many
const main = [
	box("steel", [-12, 0, 0], [3, 3, 3]),
	{ kind: "ball", color: "skin", at: [-6, 0, 0], r: 1.6 },
	{ kind: "rod", color: "trim", a: [-1, -2, 0], b: [1, 2, 0], w: 1 },
	{ kind: "sweep", color: "trim", op: "pipe", segments: 8, path: { points: [[5, -2, 0], [6, 0, 0], [7, 2, 0]] }, radius: 0.6 },
	box("steel", [12, 0, 0], [3, 3, 3]),
	{ kind: "ball", color: "trim", at: [0, 7, 0], r: 1 },
];
const many = Array.from({ length: 14 }, (_, k) => ({ kind: "ball", color: k % 2 ? "skin" : "steel", at: [-13 + k * 2, -8, 0], r: 0.7 }));
const crate = {
	version: 1,
	space: "3d",
	name: "crate",
	palette,
	parts: [
		{ name: "main", pivot: [0, 0, 0], shapes: main },
		{ name: "lid", parent: "main", pivot: [0, 0, 0], shapes: [box("trim", [0, -5, 0], [4, 1, 4])] },
		{ name: "studs", parent: "main", pivot: [0, 0, 0], shapes: many },
	],
	states: [{ name: "rest", parts: ["main", "lid", "studs"].map((part) => ({ part, offset: [0, 0, 0] })) }],
};
fs.writeFileSync(path.join(P, "crate.fart"), stringifyDoc(crate));
const flag = {
	version: 1,
	name: "flag",
	palette: [
		{ name: "ink", rgb: [30, 30, 40, 255] },
		{ name: "red", rgb: [200, 40, 40, 255] },
	],
	parts: [
		{
			name: "flag",
			pivot: [0, 0],
			shapes: [
				{ kind: "line", color: "ink", a: [-10, -10], b: [-10, 10], w: 1 },
				{ kind: "poly", color: "red", points: [[-9, -10], [4, -10], [4, -2], [-9, -2]] },
				{ kind: "circle", color: "ink", at: [-2, -6], r: 2 },
				{ kind: "circle", color: "ink", at: [8, 6], r: 2 },
			],
		},
	],
	states: [{ name: "rest", parts: [{ part: "flag", offset: [0, 0] }] }],
};
fs.writeFileSync(path.join(P, "flag.fart"), stringifyDoc(flag));

const server = spawn(bin, ["--serve", P], { stdio: "ignore" });
for (let i = 0; i < 80; i++) {
	try {
		await fetch("http://127.0.0.1:4747/");
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 250));
	}
}
const browser = await chromium.launch();
try {
	const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
	page.on("pageerror", (e) => {
		console.log("pageerror:", e.message);
		fails++;
	});
	await page.goto("http://localhost:4747/");
	await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
	await page.evaluate(() => fastart.openDoc("crate.fart"));
	await page.waitForFunction(() => fastart.project.screen.value === "model" && fastart.md.path.value === "crate.fart");
	await page.evaluate(() => (fastart.sidebar.view.value = "asset"));
	await page.waitForTimeout(900);
	const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
	const wait = (ms = 160) => page.waitForTimeout(ms);
	const ev = (fn, arg) => page.evaluate(fn, arg);
	const disk = (f) => fs.readFileSync(path.join(P, f), "utf8");
	/** every row of the Parts group, as the outline shows it */
	const rows = () =>
		ev(() => {
			const out = [];
			for (const el of document.querySelector(".outline").children) {
				if (el.classList.contains("ur-group")) {
					if (out.length) break;
					continue;
				}
				if (!el.classList.contains("ur-row")) continue;
				out.push({
					shape: el.classList.contains("ur-shape"),
					label: el.querySelector(".ur-row-label").textContent,
					selected: el.classList.contains("selected"),
					current: el.classList.contains("current"),
					expanded: el.getAttribute("aria-expanded"),
					swatch: el.querySelector(".ur-swatch") ? getComputedStyle(el.querySelector(".ur-swatch")).backgroundColor : null,
					missing: !!el.querySelector(".ur-swatch.missing"),
					count: el.querySelector(".ur-row-count")?.textContent ?? null,
				});
			}
			return out;
		});
	const labels = async () => (await rows()).map((r) => (r.shape ? "  " : "") + r.label);
	const row = (text) => page.locator(".outline .ur-row", { has: page.locator(`.ur-row-label:text-is("${text}")`) }).first();
	const sel = () => ev(() => ({ sel: fastart.md.sel.value, also: fastart.md.also.value }));
	const text0 = disk("crate.fart");

	// ------------------------------------------------------------- what is listed
	const first = await rows();
	check(
		"a part of several shapes opens to them, in file order, then its child parts",
		JSON.stringify(first.map((r) => r.label)) === JSON.stringify(["main", "mesh · steel 1", "ball · skin", "rod · trim", "pipe · trim", "mesh · steel 2", "ball · trim", "lid", "studs"]),
		(await labels()).join(" | "),
	);
	check("the shapes are shape rows, the parts are not", first.map((r) => (r.shape ? "s" : "p")).join("") === "pssssssPp".toLowerCase());
	check("two that would read the same are numbered, the rest are not", first[1].label.endsWith(" 1") && first[5].label.endsWith(" 2") && !/\d$/.test(first[2].label));
	check("each wears its colour from the palette", first[1].swatch === "rgb(150, 160, 175)" && first[2].swatch === "rgb(224, 172, 140)" && first[3].swatch === "rgb(200, 150, 40)", `${first[1].swatch} ${first[2].swatch} ${first[3].swatch}`);
	check("none is marked as naming a colour the palette lacks", first.every((r) => !r.missing));
	check("a part of one shape is a plain row", first[7].expanded === null && first[7].count === "1");
	check("a part of many shapes starts folded", first[8].expanded === "false" && first[8].count === "14");
	check("main's row still counts its shapes", first[0].count === "6" && first[0].expanded === "true");
	const icons = await ev(() => [...document.querySelectorAll(".outline .ur-shape")].map((el) => el.querySelector("svg.ur-icon, .ur-icon")?.innerHTML.length ?? 0));
	check("each shape row has an icon, and the kinds differ", icons.length === 6 && icons.every((n) => n > 0) && new Set(icons.slice(0, 4)).size === 4, icons.join(" "));
	await shot("01-listed");

	// ------------------------------------------------------------- folding
	await row("main").locator(".ur-row-disc").click();
	await wait();
	check("folding main hides its shapes and its children", JSON.stringify((await rows()).map((r) => r.label)) === JSON.stringify(["main"]), (await labels()).join(" | "));
	await row("main").locator(".ur-row-disc").click();
	await wait();
	check("opening it brings them back", (await rows()).length === 9);
	await row("studs").locator(".ur-row-disc").click();
	await wait();
	const openMany = await rows();
	check("opening the part of many lists all fourteen, numbered", openMany.length === 23 && openMany[9].label === "ball · steel 1" && openMany[10].label === "ball · skin 1" && openMany[22].label === "ball · skin 7", openMany.slice(9).map((r) => r.label).join(" | "));
	await row("studs").locator(".ur-row-disc").click();
	await wait();
	check("and it folds again", (await rows()).length === 9);

	// ------------------------------------------------------------- a row chooses the shape
	await row("ball · skin").click();
	await wait();
	let s = await sel();
	check("a click on a row chooses that shape", s.sel?.part === 0 && s.sel.shape === 1 && s.also.length === 0, JSON.stringify(s));
	let now = await rows();
	check("its row is marked, and the part's is tinted", now[2].selected && !now[0].selected && now[0].current && now.filter((r) => r.selected).length === 1);
	const insp = page.locator(".inspector");
	check("the inspector shows that shape", (await insp.locator(".ur-insp-head", { hasText: "Shape" }).first().innerText()).includes("ball"), await insp.locator(".ur-insp-head").first().innerText());
	check("with its colour", (await insp.locator(".model-fill-name").first().innerText()) === "skin");
	await row("pipe · trim").click();
	await wait();
	s = await sel();
	check("another row, another shape", s.sel?.shape === 3 && (await insp.locator(".ur-insp-head", { hasText: "Shape" }).first().innerText()).includes("sweep"));
	await row("rod · trim").click({ modifiers: ["Shift"] });
	await wait();
	s = await sel();
	check("⇧-click adds a shape to what is chosen, as on the canvas", s.sel?.shape === 2 && s.also.length === 1 && s.also[0].shape === 3, JSON.stringify(s));
	check("both rows are marked", (await rows()).filter((r) => r.selected).map((r) => r.label).join("|") === "rod · trim|pipe · trim");
	await row("rod · trim").click({ modifiers: ["Shift"] });
	await wait();
	s = await sel();
	check("⇧-click again takes it out", s.sel?.shape === 3 && s.also.length === 0, JSON.stringify(s));
	await shot("02-row-chosen");

	// ------------------------------------------------------------- the keys walk the rows
	await row("ball · skin").click();
	await page.keyboard.press("ArrowDown");
	await wait();
	check("↓ on a shape row goes to the next shape", (await sel()).sel?.shape === 2);
	await page.keyboard.press("ArrowUp");
	await page.keyboard.press("ArrowUp");
	await wait();
	check("↑ ↑ to the one before", (await sel()).sel?.shape === 0);
	await page.keyboard.press("ArrowUp");
	await wait();
	now = await rows();
	check("↑ from the first shape is the part's own row, and the shape is let go", now[0].selected && now.filter((r) => r.selected).length === 1 && (await sel()).sel === null && (await ev(() => fastart.md.curPart.value)) === 0);

	// ------------------------------------------------------------- the canvas opens and marks the row
	await row("main").locator(".ur-row-disc").click();
	await wait();
	check("main folded", (await rows()).length === 1);
	// nothing has been written by any of that
	await wait(700);
	check("folding and choosing left the file on disk as it was", disk("crate.fart") === text0);
	const box0 = await page.locator(".canvas-wrap canvas").last().boundingBox();
	const at = (x, y) =>
		ev(
			({ x, y, box }) => {
				const z = fastart.view.zoom.value;
				const p = fastart.view.pan.value;
				const [W, H] = fastart.view.size.value;
				return [box.x + (x - p[0]) * z + W / 2, box.y + (y - p[1]) * z + H / 2];
			},
			{ x, y, box: box0 },
		);
	await page.keyboard.press("Escape");
	let c = await at(-6, 0);
	await page.mouse.click(c[0], c[1]);
	await wait(300);
	s = await sel();
	check("a click on the ball on the canvas chooses it", s.sel?.part === 0 && s.sel.shape === 1, JSON.stringify(s));
	now = await rows();
	check("its part's row opened", now.length === 9 && now[0].expanded === "true", (await labels()).join(" | "));
	check("and its row is the marked one", now.filter((r) => r.selected).map((r) => r.label).join("|") === "ball · skin");
	c = await at(-9, -8);
	await page.mouse.click(c[0], c[1]);
	await wait(300);
	s = await sel();
	now = await rows();
	check("a click on a stud opens the folded part of many", s.sel?.part === 2 && s.sel.shape === 2 && now.length === 23 && now.filter((r) => r.selected).map((r) => r.label).join("|") === "ball · steel 2", JSON.stringify(s) + " " + now.length);
	const inView = await ev(() => {
		const el = document.querySelector(".outline .ur-shape.selected");
		const body = el.closest(".nav-body");
		const a = el.getBoundingClientRect();
		const b = body.getBoundingClientRect();
		return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
	});
	check("and the row is in view", inView);
	await shot("03-canvas-chose");
	await wait(700);
	check("still nothing written", disk("crate.fart") === text0);

	// ------------------------------------------------------------- delete, the menu: one undo step each
	const before = await ev(() => JSON.stringify(fastart.md.doc.value));
	await row("rod · trim").click();
	await page.keyboard.press("Backspace");
	await wait();
	let kinds = await ev(() => fastart.md.doc.value.parts[0].shapes.map((x) => x.kind + (x.op ? ":" + x.op : "")));
	check("⌫ on a shape's row deletes that shape", kinds.join(" ") === "mesh ball sweep:pipe mesh ball", kinds.join(" "));
	check("the rows follow", JSON.stringify((await rows()).slice(0, 6).map((r) => r.label)) === JSON.stringify(["main", "mesh · steel 1", "ball · skin", "pipe · trim", "mesh · steel 2", "ball · trim"]), (await labels()).join(" | "));
	await ev(() => fastart.model.undo());
	await wait();
	check("one undo brings it back whole", (await ev(() => JSON.stringify(fastart.md.doc.value))) === before);
	// a mesh with a corner chosen: Delete on its row still means the shape
	await row("mesh · steel 1").click();
	await ev(() => fastart.model.chooseVerts([0]));
	await row("mesh · steel 1").focus();
	await page.keyboard.press("Delete");
	await wait();
	kinds = await ev(() => fastart.md.doc.value.parts[0].shapes.map((x) => x.kind));
	check("Delete on a mesh's row takes the shape, not a chosen corner", kinds.join(" ") === "ball rod sweep mesh ball", kinds.join(" "));
	check("the one left of its kind and colour loses its number", (await rows())[4].label === "mesh · steel");
	await ev(() => fastart.model.undo());
	await wait();
	check("one undo again", (await ev(() => JSON.stringify(fastart.md.doc.value))) === before);

	await row("ball · skin").click({ button: "right" });
	await wait();
	const items = await page.locator(".ur-menu .ur-menu-label").allInnerTexts();
	check("a right click on a row offers what the canvas does for a shape", JSON.stringify(items) === JSON.stringify(["Duplicate", "Mirror across x", "Delete"]), items.join(" | "));
	check("and chose the shape", (await sel()).sel?.shape === 1);
	await page.locator(".ur-menu .ur-menu-item", { hasText: "Duplicate" }).click();
	await wait();
	check("Duplicate from the row copies it after itself and chooses the copy", (await ev(() => fastart.md.doc.value.parts[0].shapes.length)) === 7 && (await sel()).sel?.shape === 2);
	now = await rows();
	check("the twins are numbered, the copy marked", now[2].label === "ball · skin 1" && now[3].label === "ball · skin 2" && now[3].selected && !now[2].selected, (await labels()).slice(0, 5).join(" | "));
	await ev(() => fastart.model.undo());
	await wait();
	check("one undo", (await ev(() => JSON.stringify(fastart.md.doc.value))) === before);
	await row("ball · skin").click({ button: "right" });
	await page.locator(".ur-menu .ur-menu-item", { hasText: "Delete" }).click();
	await wait();
	check("Delete from the menu", (await ev(() => fastart.md.doc.value.parts[0].shapes.length)) === 5);
	await ev(() => fastart.model.undo());
	await wait(700);
	check("one undo, and the document is as it began", (await ev(() => JSON.stringify(fastart.md.doc.value))) === before);
	await shot("04-after");

	// ------------------------------------------------------------- the 2D editor's list
	await page.evaluate(() => void fastart.openDoc("flag.fart"));
	await wait(300);
	// the model has changed since its checkpoint (edits, each undone): leaving it asks once
	const leave = page.locator(".ur-sheet button", { hasText: "Don't save" });
	if (await leave.count()) await leave.click();
	await page.waitForFunction(() => fastart.project.screen.value === "edit" && fastart.ed.path.value === "flag.fart");
	await page.evaluate(() => (fastart.sidebar.view.value = "asset"));
	await wait(700);
	const flag0 = disk("flag.fart");
	let two = await rows();
	check("2D: a part of several shapes opens to them, in paint order", JSON.stringify(two.map((r) => r.label)) === JSON.stringify(["flag", "line · ink", "poly · red", "circle · ink 1", "circle · ink 2"]), (await labels()).join(" | "));
	check("2D: with their colours", two[1].swatch === "rgb(30, 30, 40)" && two[2].swatch === "rgb(200, 40, 40)", `${two[1].swatch} ${two[2].swatch}`);
	await row("poly · red").click();
	await wait();
	check("2D: a click on a row chooses the shape", JSON.stringify(await ev(() => fastart.ed.sel.value)) === JSON.stringify([{ p: 0, s: 1 }]));
	check("2D: its row is marked", (await rows()).filter((r) => r.selected).map((r) => r.label).join("|") === "poly · red");
	await row("flag").locator(".ur-row-disc").click();
	await wait();
	check("2D: the part folds", (await rows()).length === 1);
	await wait(700);
	check("2D: folding and choosing left the file as it was", disk("flag.fart") === flag0);
	const cbox = await page.locator(".canvas-wrap canvas").last().boundingBox();
	const sp = await ev(() => fastart.toScreen([8, 6], ...fastart.view.size.value));
	await page.keyboard.press("Escape");
	await page.mouse.click(cbox.x + sp[0], cbox.y + sp[1]);
	await wait(300);
	two = await rows();
	check("2D: a click on the canvas opens the part and marks the shape's row", two.length === 5 && two.filter((r) => r.selected).map((r) => r.label).join("|") === "circle · ink 2", JSON.stringify(await ev(() => fastart.ed.sel.value)) + " " + (await labels()).join(" | "));
	const before2 = await ev(() => JSON.stringify(fastart.ed.doc.value));
	await row("line · ink").click();
	await page.keyboard.press("Backspace");
	await wait();
	check("2D: ⌫ on a row deletes the shape", (await ev(() => fastart.ed.doc.value.parts[0].shapes.map((x) => x.kind).join(" "))) === "poly circle circle");
	await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
	await wait();
	check("2D: one undo brings it back", (await ev(() => JSON.stringify(fastart.ed.doc.value))) === before2);
	await row("circle · ink 2").click({ button: "right" });
	await wait();
	const items2 = await page.locator(".ur-menu .ur-menu-label").allInnerTexts();
	check("2D: the row's menu is the canvas's for a shape", JSON.stringify(items2) === JSON.stringify(["Duplicate", "Copy", "Raise", "Lower", "Delete"]), items2.join(" | "));
	await page.locator(".ur-menu .ur-menu-item", { hasText: "Lower" }).click();
	await wait();
	check("2D: Lower moves the shape, and its row, one earlier", JSON.stringify((await rows()).map((r) => r.label + (r.selected ? "*" : ""))) === JSON.stringify(["flag", "line · ink", "poly · red", "circle · ink 1*", "circle · ink 2"]) && (await ev(() => fastart.ed.doc.value.parts[0].shapes[2].at[0])) === 8, (await labels()).join(" | "));
	await shot("05-2d");
} finally {
	await browser.close();
	server.kill();
	await new Promise((r) => setTimeout(r, 300));
	fs.rmSync(P, { recursive: true, force: true });
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
