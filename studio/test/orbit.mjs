// The 3D view's navigation, against examples/models: the orbit is a
// turntable (the horizon never rolls, the model never ends up on its
// head), it turns about what is chosen (which stays put on the canvas),
// a mouse wheel zooms, and 1 3 7 9 are the views. `node studio/test/orbit.mjs`.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-orbit-"));
fs.cpSync(path.join(repo, "examples/models"), P, { recursive: true });
const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", P], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch("http://127.0.0.1:4747/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`); if (!ok) fails++; };
const browser = await chromium.launch();
try {
	const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
	page.on("pageerror", (e) => console.log("pageerror:", e.message));
	await page.goto("http://localhost:4747/");
	await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
	await page.evaluate(() => fastart.openDoc(fastart.project.files.value.find((f) => f.endsWith("dog.fart"))));
	await page.waitForTimeout(1200);
	const box = await page.locator(".canvas-wrap canvas").last().boundingBox();
	const mid = [box.x + box.width / 2, box.y + box.height / 2];
	// where the chosen thing's middle is on the screen
	const centre = () => page.evaluate(() => { const b = fastart.chosenBounds(); const c = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2]; const z = fastart.view.zoom.value, p = fastart.view.pan.value; return [(c[0] - p[0]) * z, (c[1] - p[1]) * z]; });
	const up = () => page.evaluate(() => fastart.upOnScreen());
	const drag = async (button, dx, dy, mods = []) => {
		for (const m of mods) await page.keyboard.down(m);
		await page.mouse.move(mid[0] + 300, mid[1] + 250);
		await page.mouse.down({ button });
		for (let i = 1; i <= 10; i++) await page.mouse.move(mid[0] + 300 + (dx * i) / 10, mid[1] + 250 + (dy * i) / 10);
		await page.mouse.up({ button });
		for (const m of mods) await page.keyboard.up(m);
		await page.waitForTimeout(150);
	};
	// pick a part away from the middle: the tail
	await page.locator(".outline .ur-row", { hasText: "tail" }).first().click();
	await page.waitForTimeout(200);
	const c0 = await centre();
	await drag("middle", 180, 0);
	const c1 = await centre();
	let u = await up();
	check("middle drag orbits", await page.evaluate(() => fastart.md.viewName.value === "" && Math.abs(fastart.md.turn.value[1]) > 0.5));
	check("a sideways orbit keeps the horizon level", Math.abs(u[0]) < 1e-6, `up on screen ${u.map((x) => x.toFixed(3))}`);
	check("the chosen part stays where it is", Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < 12, `moved ${Math.hypot(c1[0] - c0[0], c1[1] - c0[1]).toFixed(1)}px`);
	await drag("middle", 120, 90);
	await drag("middle", -60, 140);
	u = await up();
	check("after tilting and turning, still no roll", Math.abs(u[0]) < 1e-6, `up on screen ${u.map((x) => x.toFixed(3))}`);
	await drag("middle", 0, 900);
	await drag("middle", 0, 900);
	u = await up();
	check("tilting stops before the model is on its head", u[1] >= -1e-6, `up on screen ${u.map((x) => x.toFixed(3))}`);
	const pan0 = await page.evaluate(() => fastart.view.pan.value.join(","));
	const t0 = await page.evaluate(() => fastart.md.turn.value.join(","));
	await drag("middle", 80, 40, ["Shift"]);
	check("shift + middle drag pans", (await page.evaluate(() => fastart.view.pan.value.join(","))) !== pan0 && (await page.evaluate(() => fastart.md.turn.value.join(","))) === t0);
	// the views, on the digits
	for (const [key, name] of [["1", "front"], ["3", "right"], ["7", "top"]]) {
		await page.keyboard.press(key);
		check(`${key} is the ${name} view`, await page.evaluate((n) => fastart.md.viewName.value === n, name));
	}
	await page.keyboard.press("1");
	await page.keyboard.press("9");
	check("9 is the other side", await page.evaluate(() => fastart.md.viewName.value === "back"));
	check("the tool digits gave way, the letters did not", await page.evaluate(() => fastart.md.tool.value === "select"));
	await page.keyboard.press("r");
	check("R is still the box tool", await page.evaluate(() => fastart.md.tool.value === "rect"));
	await page.keyboard.press("v");
	// the wheel: a mouse zooms, at the cursor
	const z0 = await page.evaluate(() => fastart.view.zoom.value);
	await page.mouse.move(mid[0], mid[1]);
	await page.mouse.wheel(0, -240);
	await page.waitForTimeout(150);
	const z1 = await page.evaluate(() => fastart.view.zoom.value);
	check("a mouse wheel zooms", z1 > z0, `${z0.toFixed(2)} → ${z1.toFixed(2)}`);
	// F frames what is chosen
	await page.keyboard.press("f");
	await page.waitForTimeout(150);
	const c2 = await centre();
	check("F frames the chosen part", Math.hypot(c2[0], c2[1]) < 4, `centre at ${c2.map((x) => x.toFixed(1))}`);
	// ---- transforms: the keys (G T S, an axis, a number) and the handles
	await page.keyboard.press("1");
	await page.keyboard.press("f");
	await page.waitForTimeout(150);
	const pose = () => page.evaluate(() => { const d = fastart.md.doc.value; const st = d.states[fastart.md.curState.value]; const p = d.parts[fastart.md.curPart.value]; const sp = st.parts.find((x) => x.part === p.name); return { offset: sp.offset ?? p.pivot ?? [0, 0, 0], rotate: sp.rotate ?? [0, 0, 0], scale: sp.scale ?? 1 }; });
	const near = (a, b, eps = 0.02) => a.every((x, i) => Math.abs(x - b[i]) < eps);
	const p0 = await pose();
	await page.mouse.move(mid[0] + 40, mid[1] + 40);
	await page.keyboard.press("g");
	check("G begins a move", await page.evaluate(() => fastart.modal3.value?.op === "move"));
	await page.keyboard.press("y");
	await page.keyboard.type("2.5");
	check("the status bar says what is happening", (await page.locator(".ur-statusbar-text").textContent()).startsWith("Move along Y: 2.5"), await page.locator(".ur-statusbar-text").textContent());
	await page.keyboard.press("Enter");
	const p1 = await pose();
	const moved = p1.offset.map((x, i) => x - p0.offset[i]);
	check("G Y 2.5 moves 2.5 along one axis", Math.abs(Math.hypot(...moved) - 2.5) < 0.01 && moved.filter((x) => Math.abs(x) > 0.01).length === 1, JSON.stringify(moved));
	check("the tool letters did not fire meanwhile", await page.evaluate(() => fastart.md.tool.value === "select" && !fastart.modal3.value));
	await page.keyboard.press("Meta+z");
	await page.waitForTimeout(150);
	check("one undo takes it back", near((await pose()).offset, p0.offset));
	await page.locator(".outline .ur-row", { hasText: "tail" }).first().click();
	await page.keyboard.press("g");
	await page.mouse.move(mid[0] + 140, mid[1] + 90, { steps: 4 });
	check("a free move follows the pointer", !near((await pose()).offset, p0.offset));
	await page.keyboard.press("Escape");
	check("Esc puts it back", near((await pose()).offset, p0.offset) && (await page.evaluate(() => !fastart.modal3.value)));
	await page.keyboard.press("t");
	await page.keyboard.press("z");
	await page.keyboard.type("90");
	await page.keyboard.press("Enter");
	const p2 = await pose();
	check("T Z 90 turns the part a quarter", !near(p2.rotate, p0.rotate) && near(p2.offset, p0.offset), JSON.stringify(p2.rotate));
	await page.keyboard.press("Meta+z");
	await page.locator(".outline .ur-row", { hasText: "tail" }).first().click();
	await page.keyboard.press("s");
	await page.keyboard.type("2");
	await page.keyboard.press("Enter");
	check("S 2 doubles its size", Math.abs((await pose()).scale - p0.scale * 2) < 0.01);
	await page.keyboard.press("Meta+z");
	await page.locator(".outline .ur-row", { hasText: "tail" }).first().click();
	await page.waitForTimeout(150);
	// the X arrow, dragged: the part moves along X only
	const screenOf = (p) => page.evaluate(([x, y]) => { const z = fastart.view.zoom.value, pan = fastart.view.pan.value; const r = document.querySelector(".canvas-wrap canvas:last-of-type").getBoundingClientRect(); return [r.left + r.width / 2 + (x - pan[0]) * z, r.top + r.height / 2 + (y - pan[1]) * z]; }, p);
	const hs = await page.evaluate(() => fastart.gizmoHandles());
	check("a picked part has three rings, and arrows for the axes that lie across the view", hs?.rings.length === 3 && hs.arrows.length === 2, `${hs?.arrows.length} arrows, ${hs?.rings.length} rings`);
	const ax = hs.arrows.find((a) => a.axis === 0);
	const tip = await screenOf(ax.tip);
	await page.mouse.move(tip[0], tip[1]);
	await page.mouse.down();
	await page.mouse.move(tip[0] + 50, tip[1] + 37, { steps: 5 });
	check("the status bar follows the drag", (await page.locator(".ur-statusbar-text").textContent()).startsWith("Move along X"));
	await page.mouse.up();
	const p3 = await pose();
	const d3 = p3.offset.map((x, i) => x - p0.offset[i]);
	check("dragging the X arrow moves along X only", d3.filter((x) => Math.abs(x) > 0.01).length === 1 && Math.abs(Math.hypot(...d3) - 50 / (await page.evaluate(() => fastart.view.zoom.value))) < 0.05, JSON.stringify(d3));
	await page.keyboard.press("Meta+z");
	// ---- every digit is the view's in 3D: none of them picks a tool
	await page.keyboard.press("1");
	const turn0 = await page.evaluate(() => fastart.md.turn.value.join(","));
	for (const k of ["2", "4", "5", "6", "8"]) await page.keyboard.press(k);
	check("2 4 5 6 8 never pick a tool", await page.evaluate(() => fastart.md.tool.value === "select"));
	await page.keyboard.press("1");
	await page.keyboard.press("4");
	check("4 turns the view a step", (await page.evaluate(() => fastart.md.turn.value.join(","))) !== turn0 && Math.abs((await up())[0]) < 1e-6);
	// ---- a drag on nothing is a marquee: every shape it touches is chosen, and they move as one
	await page.keyboard.press("1");
	await page.keyboard.press("Escape");
	await page.keyboard.press("5");
	await page.waitForTimeout(200);
	await page.mouse.move(box.x + 8, box.y + 8);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(150);
	const many = await page.evaluate(() => fastart.selected().length);
	check("a marquee over the model chooses its shapes", many > 3 && (await page.evaluate(() => fastart.md.viewName.value === "front")), `${many} shapes, view ${await page.evaluate(() => fastart.md.viewName.value)}`);
	const firstPoint = () => page.evaluate(() => fastart.selected().map((s) => { const sh = fastart.md.doc.value.parts[s.part].shapes[s.shape]; return (sh.points?.[0] ?? sh.at ?? sh.a)[0]; }));
	const xs0 = await firstPoint();
	await page.keyboard.press("g");
	await page.keyboard.press("x");
	await page.keyboard.type("3");
	await page.keyboard.press("Enter");
	const xs1 = await firstPoint();
	check("G X 3 moves every chosen shape", xs1.every((x, i) => Math.abs(Math.abs(x - xs0[i]) - 3) < 0.01), `${xs1.filter((x, i) => Math.abs(Math.abs(x - xs0[i]) - 3) < 0.01).length} of ${xs1.length}`);
	await page.keyboard.press("Meta+z");
	await page.waitForTimeout(150);
	await page.mouse.move(box.x + 8, box.y + 8);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 6 });
	await page.mouse.up();
	const xs2 = await firstPoint();
	check("and one undo takes them all back", xs2.length === xs0.length && xs2.every((x, i) => Math.abs(x - xs0[i]) < 0.01));
	await page.locator(".outline .ur-row", { hasText: "tail" }).first().click();
	// the axis key looks along an axis
	await page.locator(".axis-key .y").click();
	check("the Y of the axis key is the top view", await page.evaluate(() => fastart.md.viewName.value === "top"));
	await page.locator(".axis-key .y").click();
	check("again, the bottom", await page.evaluate(() => fastart.md.viewName.value === "bottom"));
} finally {
	await browser.close();
	server.kill();
	fs.rmSync(P, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
