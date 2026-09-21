// The workspace, end to end, against served copies of examples/space and
// examples/models: the split view with no top bar, the sidebar as a
// stack (assets, then the open asset), the project bar's switchers, the
// floating tools, and the inspector letting go on an empty click. Run
// with `make check-ui` (needs the app built and playwright's chromium).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus"), path.join(repo, "studio/bin/Uranus.app/Contents/MacOS/Uranus")]
	.filter((b) => fs.existsSync(b))
	.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!bin) {
	console.error("no studio binary: run make app (or go build -o bin/studio . in studio/)");
	process.exit(2);
}
const shots = process.argv[2] || "";
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

/** Serve a copy of an example folder, hand a page on it to `tour`, tear down. */
async function served(example, tour) {
	const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-ui-"));
	fs.cpSync(path.join(repo, "examples", example), P, { recursive: true });
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
		page.on("pageerror", (e) => console.log("pageerror:", e.message));
		await page.goto("http://localhost:4747/");
		await page.waitForTimeout(1500);
		const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
		const hdrs = async () => (await page.locator(".inspector .hdr").allTextContents()).map((t) => t.trim().split("\n")[0]);
		await tour(page, shot, hdrs);
	} finally {
		await browser.close();
		server.kill();
		await new Promise((r) => setTimeout(r, 300));
		fs.rmSync(P, { recursive: true, force: true });
	}
}

await served("space", async (page, shot, hdrs) => {
	check("workspace up", (await page.locator(".workspace").count()) === 1);
	check("no topbar", (await page.locator(".topbar").count()) === 0);
	check("project bar", (await page.locator(".projectbar").count()) === 1);
	check("sidebar at assets", (await page.locator(".side-hdr .t").first().textContent()).trim() === "Assets");
	check("shelf shows", (await page.locator(".shelf-card").count()) > 0, `${await page.locator(".shelf-card").count()} cards`);
	check("project inspector", (await page.locator(".inspector .hdr").first().textContent()).includes("Project"));
	await shot("1-shelf");
	// open an asset from the tree
	const folder = page.locator(".tree-row.folder", { hasText: "ships" });
	await folder.click(); await page.waitForTimeout(150);
	await page.locator(".tree-row.leaf", { hasText: "fighter" }).first().click();
	await page.waitForTimeout(800);
	check("editor open", await page.evaluate(() => fastart.project.screen.value === "edit"));
	check("sidebar pushed", await page.evaluate(() => fastart.sidebar.view.value === "asset"));
	check("sidebar shows layers", (await page.locator(".side-body .hdr", { hasText: "Layers" }).count()) === 1);
	check("floating tools", (await page.locator(".tools .tool").count()) >= 5);
	check("asset seg", (await page.locator(".scheme .seg.asset .w").textContent()).trim() === "fighter");
	const stLabel = (await page.locator(".scheme .seg.state .w").textContent()).trim();
	check("state seg", stLabel.length > 0, stLabel);
	// the inspector opens on the document
	let h = await hdrs();
	check("fresh asset: document inspector", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	await shot("2-editor");
	// pick a part in the layers: the part shows
	await page.locator(".side-body .layer").first().click(); await page.waitForTimeout(200);
	h = await hdrs();
	check("layer click: part inspector", h.some((t) => t.startsWith("Part")), h.join(" | "));
	// click the empty canvas: the document again
	const box = await page.locator(".canvas-wrap canvas").first().boundingBox();
	await page.mouse.click(box.x + 30, box.y + 60); await page.waitForTimeout(250);
	h = await hdrs();
	check("empty click: document only", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	// the state switcher
	await page.locator(".scheme .seg.state").click(); await page.waitForTimeout(150);
	const rows = await page.locator(".ctx .row .name").allTextContents();
	check("state menu", rows.length >= 1, rows.join(", "));
	await shot("3-state-menu");
	await page.keyboard.press("Escape"); await page.waitForTimeout(100);
	// the asset switcher
	await page.locator(".scheme .seg.asset").click(); await page.waitForTimeout(150);
	const arows = await page.locator(".ctx .row .name").allTextContents();
	check("asset menu lists files", arows.length >= 3, `${arows.length} rows`);
	await page.keyboard.press("Escape");
	// back to assets in the sidebar
	await page.locator(".side-hdr .btn.x.plain").first().click(); await page.waitForTimeout(150);
	check("back to assets", await page.evaluate(() => fastart.sidebar.view.value === "assets"));
	check("asset stays open", await page.evaluate(() => fastart.project.screen.value === "edit"));
	check("active row marked", (await page.locator(".tree-row.leaf.active").count()) === 1);
	// add menu at the root
	await page.locator(".side-hdr .btn.x.plain").first().click(); await page.waitForTimeout(150);
	const add = await page.locator(".ctx .row .name").allTextContents();
	check("add menu", add.join(",") === "Asset,3D Asset,Palette,Scene,3D Scene", add.join(","));
	await page.keyboard.press("Escape");
	// a 3D asset and a scene, if the corpus has them
	const files = await page.evaluate(() => fastart.project.files.value);
	const scene = files.find((f) => f.endsWith(".shart"));
	// open by the asset menu instead: pick a palette and a scene by name
	const openVia = async (name) => { await page.locator(".scheme .seg.asset").click(); await page.waitForTimeout(120); await page.locator(".ctx .row", { hasText: name }).first().click(); await page.waitForTimeout(800); };
	const pal = files.find((f) => f.includes("palette"));
	if (pal) { await openVia(pal.replace(/\.fart$/, "").split("/").pop()); check("palette opens", await page.evaluate(() => fastart.ed.isPalette.value)); check("palette: no tools", (await page.locator(".tools").count()) === 0); await shot("4-palette"); }
	if (scene) { await openVia(scene.replace(/\.shart$/, "").split("/").pop()); check("scene opens", await page.evaluate(() => fastart.project.screen.value === "scene")); check("scene sidebar nodes", (await page.locator(".side-body .hdr", { hasText: "Nodes" }).count()) === 1); await shot("5-scene"); }
	// sidebar toggle, inspector toggle
	await page.keyboard.press("Meta+b"); await page.waitForTimeout(100);
	check("cmd+b hides sidebar", (await page.locator(".sidebar").count()) === 0);
	await page.keyboard.press("Meta+b");
	await page.keyboard.press("Meta+w"); await page.waitForTimeout(400);
	check("cmd+w closes asset", await page.evaluate(() => fastart.project.screen.value === "browse"));
	await shot("6-back-to-shelf");
});

await served("models", async (page, shot, hdrs) => {
	await shot("7-models-shelf");
	const leaf = page.locator(".tree-row.leaf", { hasText: "dog" }).first();
	if (!(await leaf.count())) { const f = page.locator(".tree-row.folder").first(); if (await f.count()) await f.click(); }
	await page.locator(".tree-row.leaf", { hasText: "dog" }).first().click();
	await page.waitForTimeout(1200);
	check("model screen", await page.evaluate(() => fastart.project.screen.value === "model"));
	check("sidebar parts", (await page.locator(".side-body .hdr", { hasText: "Parts" }).count()) === 1);
	check("model tools", (await page.locator(".tools select").count()) === 1 && (await page.locator(".tools .tool").count()) >= 7);
	let h = await hdrs();
	check("fresh model: view + document, no part", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	await page.locator(".side-body .layer").first().click(); await page.waitForTimeout(200);
	h = await hdrs();
	check("part row: part inspector", h.some((t) => t.startsWith("Part")) && !h.some((t) => t.startsWith("Document")), h.join(" | "));
	const box = await page.locator(".canvas-wrap canvas").first().boundingBox();
	await page.mouse.click(box.x + 20, box.y + 40); await page.waitForTimeout(250);
	h = await hdrs();
	check("empty click: document again", h.some((t) => t.startsWith("Document")) && !h.some((t) => t.startsWith("Part")), h.join(" | "));
	const stLabel = (await page.locator(".scheme .seg.state .w").textContent()).trim();
	check("state seg", stLabel.length > 0, stLabel);
	await shot("8-model");

});

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
