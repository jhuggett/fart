// Screenshots of examples/curves in the served studio, for a look at the 1.7 demos:
// node studio/test/shots.mjs <dir> (needs the app built and playwright's chromium).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const repo = "/Users/jhuggett/Documents/Sandbox/fastart";
const shots = process.argv[2];
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-demos-"));
fs.cpSync(path.join(repo, "examples/curves"), P, { recursive: true });
const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", P], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch("http://127.0.0.1:4747/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 }, colorScheme: "dark" })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("http://localhost:4747/"); await page.waitForTimeout(1800);
  await page.screenshot({ path: `${shots}/d0-shelf.png` });
  const openVia = async (name) => { await page.locator(".scheme .seg.asset").click(); await page.waitForTimeout(120); await page.locator(".ctx .row", { hasText: name }).first().click(); await page.waitForTimeout(1000); };
  await openVia("blob");
  console.log("blob issues", await page.evaluate(() => JSON.stringify(fastart.ed.issues.value)));
  await page.locator(".side-body .row", { hasText: "bounce" }).click(); await page.waitForTimeout(150);
  for (const [t, n] of [[0, "idle"], [0.25, "squash"], [0.55, "stretch"], [0.75, "mid"]]) {
    await page.evaluate((t) => (fastart.ed.clipTime.value = t), t); await page.waitForTimeout(200);
    await page.screenshot({ path: `${shots}/d1-blob-${n}.png`, clip: { x: 240, y: 38, width: 912, height: 760 } });
  }
  await openVia("slime");
  console.log("slime issues", await page.evaluate(() => JSON.stringify(fastart.md.issues.value)));
  await page.evaluate(() => { fastart.md.turn.value = [0.35, 0.5, 0]; }); await page.waitForTimeout(200);
  await page.locator(".side-body .layer").first().click(); await page.waitForTimeout(100);
  const b3 = await page.locator(".canvas-wrap canvas").first().boundingBox();
  await page.mouse.click(b3.x + b3.width / 2, b3.y + b3.height / 2 + 20); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/d2-slime-cage.png` });
  await page.locator(".side-body .row", { hasText: "bounce" }).click(); await page.waitForTimeout(150);
  for (const [t, n] of [[0, "rest"], [0.3, "squash"], [0.6, "stretch"], [0.8, "mid"]]) {
    await page.evaluate((t) => (fastart.md.clipTime.value = t), t); await page.waitForTimeout(250);
    await page.screenshot({ path: `${shots}/d3-slime-${n}.png`, clip: { x: 240, y: 38, width: 912, height: 760 } });
  }
  await openVia("vase");
  console.log("vase issues", await page.evaluate(() => JSON.stringify(fastart.md.issues.value)));
  await page.evaluate(() => { fastart.md.turn.value = [0.3, 0.7, 0]; }); await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/d4-vase.png` });
  await openVia("shelf");
  await page.waitForTimeout(600);
  await page.evaluate(() => { fastart.sc.turn.value = [0.3, 0.5, 0]; fastart.sc.time.value = 0.45; }); await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/d5-scene.png` });
} finally { await browser.close(); server.kill(); fs.rmSync(P, { recursive: true, force: true }); }
console.log("demos shot");
