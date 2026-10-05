// Screenshots of the workspace in both appearances, for eyes: the
// browser, the 2D editor, the model screen. `node studio/test/look.mjs
// <out dir> [example]`. Needs studio/bin/studio and playwright's chromium.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const out = process.argv[2] || path.join(os.tmpdir(), "uranus-look");
fs.mkdirSync(out, { recursive: true });

async function served(example, tour) {
	const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-look-"));
	fs.cpSync(path.join(repo, "examples", example), P, { recursive: true });
	const server = spawn(path.join(repo, "studio/bin/studio"), ["--serve", P], { stdio: "ignore" });
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
		for (const theme of ["light", "dark"]) {
			const page = await (await browser.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 2, colorScheme: theme })).newPage();
			page.on("pageerror", (e) => console.log("pageerror:", e.message));
			page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
			await page.goto("http://localhost:4747/");
			await page.waitForTimeout(1500);
			await tour(page, (n) => page.screenshot({ path: path.join(out, `${example}-${n}-${theme}.png`) }));
			await page.close();
		}
	} finally {
		await browser.close();
		server.kill();
		await new Promise((r) => setTimeout(r, 300));
		fs.rmSync(P, { recursive: true, force: true });
	}
}

const open = async (page, name) => {
	const rel = await page.evaluate((n) => fastart.project.files.value.find((f) => f.split("/").pop().startsWith(n)), name);
	if (!rel) return false;
	await page.evaluate((r) => fastart.openDoc(r), rel);
	await page.waitForTimeout(900);
	return true;
};

const which = process.argv[3];
if (!which || which === "space")
	await served("space", async (page, shot) => {
		await shot("1-browser");
		await page.locator(".ur-tile").first().click();
		await page.waitForTimeout(200);
		await shot("2-browser-picked");
		if (await open(page, "fighter")) {
			await shot("3-editor");
			await page.locator(".outline .ur-row, .outline .layer").first().click();
			await page.waitForTimeout(200);
			await shot("4-editor-part");
			await page.keyboard.press("Shift+Slash");
			await page.waitForTimeout(250);
			await shot("4b-help");
			await page.keyboard.press("Shift+Slash");
			await page.evaluate(() => fastart.ed.curClip.value < 0 && fastart.ed.doc.value.clips?.length && (fastart.ed.curClip.value = 0));
			await page.waitForTimeout(300);
			await shot("5-editor-clip");
		}
		await page.keyboard.press("Meta+0");
		await page.keyboard.press("Meta+Alt+0");
		await page.waitForTimeout(250);
		await shot("6-columns-hidden");
	});
if (!which || which === "models")
	await served("models", async (page, shot) => {
		if (await open(page, "dog")) {
			await shot("7-model");
			// a part picked, the view turned: the axis handles
			await page.locator(".outline .ur-row", { hasText: "head" }).first().click();
			await page.evaluate(() => (fastart.md.turn.value = [0.35, -0.6, 0]));
			await page.waitForTimeout(300);
			await shot("7b-model-handles");
			await page.keyboard.press("Meta+Slash");
			await page.waitForTimeout(300);
			await shot("7c-shortcuts");
			await page.keyboard.press("Escape");
			await page.locator('[role=tab][aria-label="View"]').click();
			await page.waitForTimeout(200);
			await shot("8-model-view");
		}
	});
console.log(out);
