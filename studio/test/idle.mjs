// Is the workspace quiet when nothing happens? Counts DOM mutations and
// long frames over two idle seconds on each screen, and the frame rate
// of a drag. `node studio/test/idle.mjs [dir]` (default examples/models).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.argv[2] || path.join(repo, "examples/models");
const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", dir], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch("http://127.0.0.1:4747/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
page.on("pageerror", (e) => console.log("pageerror:", e.message));
const t0 = Date.now();
await page.goto("http://localhost:4747/");
await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
console.log(`files listed after ${Date.now() - t0}ms: ${await page.evaluate(() => fastart.project.files.value.length)}`);
await page.waitForFunction(() => document.querySelectorAll(".ur-tile img").length >= Math.min(8, fastart.project.files.value.length), null, { timeout: 120000 }).catch(() => {});
console.log(`first tiles pictured after ${Date.now() - t0}ms (${await page.evaluate(() => document.querySelectorAll(".ur-tile img").length)} pictures, ${await page.evaluate(() => fastart.project.thumbs.value.size)} files read)`);
const idle = (label) => page.evaluate(async (label) => {
	let muts = 0, frames = 0, long = 0, last = performance.now();
	const mo = new MutationObserver((l) => (muts += l.length));
	mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
	await new Promise((done) => { const tick = (now) => { frames++; if (now - last > 50) long++; last = now; if (frames < 120) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
	mo.disconnect();
	return `${label}: ${muts} mutations, ${long} long frames over 120 frames`;
}, label);
console.log(await idle("browser, while the rest reads"));
const rel = await page.evaluate(() => fastart.project.files.value.find((f) => f.endsWith(".fart")));
await page.evaluate((r) => fastart.openDoc(r), rel);
await page.waitForTimeout(1500);
console.log(await idle(`${rel}, idle`));
const box = await page.locator(".canvas-wrap").boundingBox();
const t1 = Date.now();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let i = 0; i < 60; i++) await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i);
await page.mouse.up();
console.log(`60 drag moves: ${Date.now() - t1}ms`);
await browser.close();
server.kill();
