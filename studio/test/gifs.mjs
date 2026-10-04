// Record the examples/curves clips playing in the served studio as GIFs:
// node studio/test/gifs.mjs <out dir>  (needs the app built, playwright's chromium, ImageMagick)
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createHash } from "node:crypto";
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-gifs-"));
fs.cpSync(path.join(repo, "examples/curves"), P, { recursive: true });
const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", P], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { await fetch("http://127.0.0.1:4747/"); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
const browser = await chromium.launch();
const TAKES = [
  { file: "head", clip: "talk", turn: [0.15, 0.45, 0], zoom: 14, frames: 40, dt: 35 },
  { file: "head", clip: "moods", turn: [0.1, -0.3, 0], zoom: 14, frames: 48, dt: 55 },
  { file: "flag", clip: "wave", turn: [0.25, 0.55, 0], zoom: 11, pan: [8, -4], frames: 36, dt: 35 },
  { file: "slime", clip: "bounce", turn: [0.3, 0.5, 0], zoom: 12, frames: 36, dt: 30 },
  { file: "face", clip: "speak", zoom: 12, frames: 44, dt: 35 },
  { file: "blob", clip: "bounce", zoom: 11, frames: 32, dt: 30 },
];
try {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 }, colorScheme: "dark" })).newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto("http://localhost:4747/"); await page.waitForTimeout(1800);
  for (const take of TAKES) {
    await page.locator(".scheme .seg.asset").click(); await page.waitForTimeout(120);
    await page.locator(".ctx .row", { hasText: take.file }).first().click(); await page.waitForTimeout(1000);
    const is3d = await page.evaluate(() => fastart.project.screen.value === "model");
    await page.evaluate(({ take, is3d }) => {
      fastart.view.zoom.value = take.zoom;
      fastart.view.pan.value = take.pan ?? [0, is3d ? -2 : 0];
      if (is3d && take.turn) fastart.md.turn.value = take.turn;
    }, { take, is3d });
    // the clip's row, not a state that shares the name: clip rows carry a "keys" chip
    await page.locator(".side-body .row", { hasText: /keys/ }).filter({ hasText: take.clip }).first().click(); await page.waitForTimeout(200);
    await page.keyboard.press("Space"); // play
    const dir = path.join(P, `frames-${take.file}-${take.clip}`);
    fs.mkdirSync(dir);
    const hashes = new Set();
    const box = await page.locator(".canvas-wrap").boundingBox();
    const clip = { x: box.x + box.width / 2 - 260, y: box.y + box.height / 2 - 220, width: 520, height: 440 };
    for (let i = 0; i < take.frames; i++) {
      const buf = await page.screenshot({ clip });
      fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, "0")}.png`), buf);
      hashes.add(createHash("md5").update(buf).digest("hex"));
      await page.waitForTimeout(take.dt);
    }
    await page.keyboard.press("Space"); // pause
    const gif = path.join(out, `${take.file}-${take.clip}.gif`);
    const sh = (cmd) => { try { execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { console.log("magick:", String(e.stderr)); throw e; } };
    // ImageMagick: the frames as a looping GIF at ~18 fps, and six of them as a strip
    sh(`magick -delay 6 -loop 0 "${dir}/f*.png" -resize 390x -colors 128 -layers optimize "${gif}"`);
    const every = Math.max(1, Math.floor(take.frames / 6));
    const pick = Array.from({ length: 6 }, (_, k) => `"${dir}/f${String(k * every).padStart(3, "0")}.png"`).join(" ");
    sh(`magick ${pick} -resize 200x -bordercolor none -border 2x0 +append "${out}/${take.file}-${take.clip}-strip.png"`);
    console.log(`${take.file}/${take.clip}: ${take.frames} frames, ${hashes.size} distinct → ${hashes.size > take.frames / 2 ? "animating" : "STATIC"} · ${(fs.statSync(gif).size / 1024).toFixed(0)} KB`);
  }
} finally { await browser.close(); server.kill(); fs.rmSync(P, { recursive: true, force: true }); }
