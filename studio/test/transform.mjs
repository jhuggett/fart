// Transforms beyond the model's base mesh: Deform sends a mesh's move
// into the state's morph (and refuses a ball), and a 3D scene's nodes
// take the same handles, keys, marquee and orbit. `node studio/test/transform.mjs`.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let fails = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`); if (!ok) fails++; };
async function served(fill, tour) {
	const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-xf-"));
	fill(P);
	const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", P], { stdio: "ignore" });
	for (let i = 0; i < 80; i++) { try { await fetch("http://127.0.0.1:4747/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
	const browser = await chromium.launch();
	try {
		const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
		page.on("pageerror", (e) => console.log("pageerror:", e.message));
		await page.goto("http://localhost:4747/");
		await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
		await tour(page);
	} finally {
		await browser.close();
		server.kill();
		await new Promise((r) => setTimeout(r, 300));
		fs.rmSync(P, { recursive: true, force: true });
	}
}
const open = async (page, name) => { await page.evaluate((n) => fastart.openDoc(fastart.project.files.value.find((f) => f.endsWith(n))), name); await page.waitForTimeout(1200); };

// ---- Deform: the morph, never the base
await served((P) => fs.copyFileSync(path.join(repo, "spec/examples/valid/morph3d.fart"), path.join(P, "morph3d.fart")), async (page) => {
	await open(page, "morph3d.fart");
	await page.evaluate(() => { fastart.md.curState.value = 1; fastart.md.sel.value = { part: 0, shape: 0 }; fastart.md.partPicked.value = true; });
	await page.waitForTimeout(200);
	const read = () => page.evaluate(() => { const d = fastart.md.doc.value; return { base: d.parts[0].shapes[0].points.map((p) => p[0]), morph: d.states[1].parts.find((e) => e.part === d.parts[0].name).morph.find((m) => m.shape === 0).points.map((p) => p[0]), rest: JSON.stringify(d.states[0]) }; });
	const a = await read();
	await page.keyboard.press("d");
	check("Deform is on", await page.evaluate(() => fastart.md.deform.value));
	for (const k of ["g", "x", "2", "Enter"]) await page.keyboard.press(k);
	const b = await read();
	check("G X 2 in Deform moves the morph", b.morph.every((x, i) => Math.abs(Math.abs(x - a.morph[i]) - 2) < 0.01), JSON.stringify(b.morph.slice(0, 3)));
	check("the base mesh is untouched", JSON.stringify(b.base) === JSON.stringify(a.base));
	check("the other state is untouched", b.rest === a.rest);
	await page.keyboard.press("Meta+z");
	// the ball has no morph: a transform says so instead of changing every state
	await page.evaluate(() => { fastart.md.sel.value = { part: 0, shape: 1 }; });
	await page.waitForTimeout(150);
	const ball = () => page.evaluate(() => JSON.stringify(fastart.md.doc.value.parts[0].shapes[1]));
	const ball0 = await ball();
	await page.keyboard.press("g");
	check("a ball in Deform is refused, with a word why", (await page.evaluate(() => !fastart.modal3.value)) && /Deform/.test((await page.locator(".toast").textContent().catch(() => "")) ?? ""));
	check("and is not moved", (await ball()) === ball0);
	await page.keyboard.press("d");
	for (const k of ["g", "x", "1", "Enter"]) await page.keyboard.press(k);
	check("with Deform off the ball moves", (await ball()) !== ball0);
});

// ---- a 3D scene: nodes take the handles, the keys, the marquee, and the orbit turns about them
await served((P) => fs.cpSync(path.join(repo, "examples/cabin"), P, { recursive: true }), async (page) => {
	await open(page, "camp.shart");
	check("a 3D scene is up", await page.evaluate(() => fastart.project.screen.value === "scene" && fastart.sc.scene.value.space === "3d"));
	const names = await page.evaluate(() => fastart.sc.scene.value.nodes.map((n) => n.name));
	const first = names[0];
	await page.evaluate((n) => (fastart.sc.sel.value = n), first);
	await page.waitForTimeout(200);
	const node = (n) => page.evaluate((n) => { const x = fastart.sc.scene.value.nodes.find((q) => q.name === n); return { at: x.at ?? [0, 0, 0], rotate: x.rotate ?? 0, scale: x.scale ?? 1 }; }, n);
	const n0 = await node(first);
	const hs = await page.evaluate(() => fastart.gizmoHandles());
	check("the chosen node wears the handles", !!hs && hs.rings.length === 3 && hs.arrows.length >= 2, `${hs?.arrows.length} arrows, ${hs?.rings.length} rings`);
	const box = await page.locator(".canvas-wrap canvas").last().boundingBox();
	await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 60);
	for (const k of ["g", "x", "2", "Enter"]) await page.keyboard.press(k);
	const n1 = await node(first);
	const d = n1.at.map((x, i) => x - n0.at[i]);
	check("G X 2 moves the node 2 along one axis", Math.abs(Math.hypot(...d) - 2) < 0.01 && d.filter((x) => Math.abs(x) > 0.01).length === 1, JSON.stringify(d));
	await page.keyboard.press("Meta+z");
	await page.evaluate((n) => (fastart.sc.sel.value = n), first);
	for (const k of ["t", "y", "9", "0", "Enter"]) await page.keyboard.press(k);
	check("T Y 90 turns it", JSON.stringify((await node(first)).rotate) !== JSON.stringify(n0.rotate), JSON.stringify((await node(first)).rotate));
	await page.keyboard.press("Meta+z");
	await page.evaluate((n) => (fastart.sc.sel.value = n), first);
	for (const k of ["s", "2", "Enter"]) await page.keyboard.press(k);
	check("S 2 doubles it", Math.abs((await node(first)).scale - n0.scale * 2) < 0.01);
	await page.keyboard.press("Meta+z");
	await page.evaluate((n) => (fastart.sc.sel.value = n), first);
	await page.waitForTimeout(150);
	// the orbit turns about the chosen node: its origin stays where it is
	const origin = () => page.evaluate(() => { const h = fastart.gizmoHandles(); const z = fastart.view.zoom.value, p = fastart.view.pan.value; return [(h.centre[0] - p[0]) * z, (h.centre[1] - p[1]) * z]; });
	const o0 = await origin();
	await page.mouse.move(box.x + 80, box.y + 80);
	await page.mouse.down({ button: "middle" });
	await page.mouse.move(box.x + 260, box.y + 130, { steps: 8 });
	await page.mouse.up({ button: "middle" });
	await page.waitForTimeout(150);
	const o1 = await origin();
	check("middle drag orbits about the chosen node", (await page.evaluate(() => fastart.sc.viewName.value === "")) && Math.hypot(o1[0] - o0[0], o1[1] - o0[1]) < 2, `moved ${Math.hypot(o1[0] - o0[0], o1[1] - o0[1]).toFixed(2)}px`);
	// a marquee over everything chooses the nodes; they move as one
	await page.keyboard.press("Escape");
	await page.keyboard.press("1");
	await page.keyboard.press("5");
	await page.waitForTimeout(200);
	const turn = await page.evaluate(() => fastart.sc.turn.value.join(","));
	await page.mouse.move(box.x + 6, box.y + 6);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6, { steps: 6 });
	await page.mouse.up();
	await page.waitForTimeout(150);
	const many = await page.evaluate(() => fastart.selectedNodes());
	check("a marquee chooses the nodes it touches, and does not orbit", many.length > 1 && (await page.evaluate(() => fastart.sc.turn.value.join(","))) === turn, `${many.length} chosen`);
	// the outermost of them are what moves; a node inside another chosen one rides it
	const roots = many.filter((p) => !many.some((q) => q !== p && p.startsWith(q + "/")));
	const atOf = (paths) => page.evaluate((paths) => paths.map((path) => { let nodes = fastart.sc.scene.value.nodes, n; for (const name of path.split("/")) { n = nodes.find((x) => x.name === name); nodes = n.children ?? []; } return n.at ?? [0, 0, 0]; }), paths);
	const before = await atOf(many);
	for (const k of ["g", "y", "3", "Enter"]) await page.keyboard.press(k);
	const after = await atOf(many);
	const moved = many.map((p, i) => Math.hypot(...after[i].map((x, k) => x - before[i][k])));
	check("G Y 3 moves the outermost by 3, and the nodes inside them not twice", many.every((p, i) => Math.abs(moved[i] - (roots.includes(p) ? 3 : 0)) < 0.01), moved.map((m) => m.toFixed(2)).join(" "));
	await page.keyboard.press("Meta+z");
});
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
