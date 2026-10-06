// Where a big asset's time goes: how long it takes to open, how long a
// frame takes after a pan, an orbit and a hover, and the functions the
// CPU spent longest in. `node studio/test/profile.mjs <project dir> <asset path>`.
// (Serve a copy of the project: the studio writes to what it opens.)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [dir, asset] = process.argv.slice(2);
const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", dir], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch("http://127.0.0.1:4747/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
// a real GPU when there is one (PROFILE_GPU=1): headless Chromium otherwise rasterises in software, which says little about the app
const browser = await chromium.launch(process.env.PROFILE_GPU ? { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } : {});
try {
	const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
	page.on("pageerror", (e) => console.log("pageerror:", e.message));
	const cdp = await page.context().newCDPSession(page);
	await page.goto("http://localhost:4747/");
	await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
	await cdp.send("Profiler.enable");
	await cdp.send("Profiler.start");
	let t = Date.now();
	await page.evaluate((a) => fastart.openDoc(a), asset);
	console.log(`open: ${Date.now() - t}ms  (screen ${await page.evaluate(() => fastart.project.screen.value)})`);
	// the first frames after opening
	const frame = (label, act) => page.evaluate(async ([label, act]) => {
		const times = [];
		for (let i = 0; i < 5; i++) {
			const t0 = performance.now();
			new Function("i", act)(i);
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			times.push(performance.now() - t0);
		}
		return `${label}: ${times.map((x) => x.toFixed(0)).join(" ")} ms`;
	}, [label, act]);
	console.log(await frame("idle frames", ""));
	console.log(await frame("pan", "fastart.view.pan.value = [i, i]"));
	console.log(await frame("zoom", "fastart.view.zoom.value = 4 + i"));
	const store = (await page.evaluate(() => fastart.project.screen.value)) === "scene" ? "sc" : "md";
	console.log(await frame("orbit", `fastart.${store}.turn.value = [0.3, 0.1 * (i + 1), 0]`));
	const box = await page.locator(".canvas-wrap canvas").last().boundingBox();
	t = Date.now();
	for (let i = 0; i < 10; i++) await page.mouse.move(box.x + 300 + i * 20, box.y + 300 + i * 10);
	console.log(`10 hover moves: ${Date.now() - t}ms`);
	console.log("gpu:", await page.evaluate(() => { const c = document.createElement("canvas").getContext("webgl"); const e = c.getExtension("WEBGL_debug_renderer_info"); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?"; }), "· last frame:", JSON.stringify(await page.evaluate(() => fastart.glStats)));
	const { profile } = await cdp.send("Profiler.stop");
	const self = new Map();
	const dt = profile.timeDeltas, ids = profile.samples;
	const byId = new Map(profile.nodes.map((n) => [n.id, n]));
	ids.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0)); });
	const total = [...self.values()].reduce((a, b) => a + b, 0);
	console.log("self time:");
	for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${(v / 1000).toFixed(0).padStart(6)}ms ${((v / total) * 100).toFixed(0).padStart(3)}%  ${k}`);
} finally {
	await browser.close();
	server.kill();
}
