// The save model, end to end, against a served copy of examples/space:
// the file on disk is the document, ⌘S is a checkpoint, nothing reverts
// by itself. Run with `make check-save` (needs the app built and
// playwright's chromium: `npx playwright install chromium` once).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
// the newest binary wins: make check-save builds bin/studio from the current sources
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus"), path.join(repo, "studio/bin/Uranus.app/Contents/MacOS/Uranus")]
	.filter((b) => fs.existsSync(b))
	.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!bin) {
	console.error("no studio binary: run make app (or go build -o bin/studio . in studio/)");
	process.exit(2);
}
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-save-"));
fs.cpSync(path.join(repo, "examples/space"), P, { recursive: true });
for (const f of fs.readdirSync(path.join(P, "ships"))) if (f.endsWith("~")) fs.rmSync(path.join(P, "ships", f));
const file = path.join(P, "ships/fighter.fart");
const ck = `${file}~`;
const pivot = (p) => JSON.parse(fs.readFileSync(p, "utf8")).parts[0].pivot;
const mtime = (p) => fs.statSync(p).mtimeMs;
const tmps = () => fs.readdirSync(path.join(P, "ships")).filter((f) => f.includes(".tmp"));
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

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
	await page.waitForTimeout(1200);
	const open = async (name) => {
		const folder = page.locator(".tree-row.folder", { hasText: "ships" });
		if (!(await folder.locator(".caret.open").count())) await folder.click();
		await page.waitForTimeout(150);
		await page.locator(".tree-row.leaf", { hasText: name }).first().click();
		await page.waitForTimeout(700);
	};
	const dirty = () => page.evaluate(() => fastart.ed.dirty.value);
	const docPivot = () => page.evaluate(() => fastart.ed.doc.value.parts[0].pivot);
	const setPivot = (x, y) => page.evaluate(([x, y]) => { const d = JSON.parse(JSON.stringify(fastart.ed.doc.value)); d.parts[0].pivot = [x, y]; fastart.applyExternalDoc(d); }, [x, y]);

	const until = async (fn, ms = 4000) => {
		const t0 = Date.now();
		while (Date.now() - t0 < ms) {
			if (await fn()) return true;
			await new Promise((r) => setTimeout(r, 100));
		}
		return await fn();
	};
	const raw0 = fs.readFileSync(file, "utf8");
	const m0 = mtime(file);
	await open("fighter");
	await until(() => fs.existsSync(ck));
	check("open leaves the file untouched", fs.readFileSync(file, "utf8") === raw0 && mtime(file) === m0);
	check("open makes a checkpoint identical to the file", fs.existsSync(ck) && fs.readFileSync(ck, "utf8") === raw0, fs.existsSync(ck) ? `checkpoint ${fs.readFileSync(ck, "utf8").length} bytes vs file ${raw0.length}` : "no checkpoint");
	check("a clean open is not dirty", !(await dirty()));

	await setPivot(1, 2);
	await until(() => JSON.stringify(pivot(file)) === "[1,2]");
	await page.waitForTimeout(200);
	check("the edit is on disk", JSON.stringify(pivot(file)) === "[1,2]", `disk pivot ${JSON.stringify(pivot(file))}`);
	check("the mtime advanced", mtime(file) > m0);
	check("no temp files left", tmps().length === 0, tmps().join(","));
	check("the document is dirty", await dirty());
	const status = await page.evaluate(() => [...document.querySelectorAll(".topbar .sub")].map((e) => e.textContent.trim()).find((t) => t.startsWith("on disk")) ?? "");
	check("the toolbar says when it wrote", /on disk \d\d:\d\d:\d\d/.test(status), status || `written=${await page.evaluate(() => fastart.ed.written.value)}`);
	check("the explorer marks the file", (await page.locator(".tree-row.leaf.active .dot").count()) === 1);

	await page.locator(".canvas-wrap canvas").click({ position: { x: 30, y: 30 } });
	await page.keyboard.press("Meta+s");
	await page.waitForTimeout(700);
	check("after ⌘S the checkpoint equals the file", fs.readFileSync(ck, "utf8") === fs.readFileSync(file, "utf8"));
	check("after ⌘S the document is clean", !(await dirty()));

	const alt = JSON.parse(fs.readFileSync(ck, "utf8"));
	alt.parts[0].pivot = [9, 9];
	fs.writeFileSync(ck, JSON.stringify(alt, null, 2) + "\n");
	const m1 = mtime(file);
	await open("cruiser");
	await open("fighter");
	check("reopening keeps the file's content, not the checkpoint's", JSON.stringify(await docPivot()) === "[1,2]");
	check("reopening did not rewrite the file", mtime(file) === m1);
	check("a differing checkpoint opens dirty", await dirty());
	check("the checkpoint was not replaced", JSON.stringify(pivot(ck)) === "[9,9]");

	await page.evaluate(() => fastart.revertToCheckpoint());
	await page.waitForTimeout(900);
	check("revert takes the checkpoint's content, and the disk follows", JSON.stringify(await docPivot()) === "[9,9]" && JSON.stringify(pivot(file)) === "[9,9]");
	check("after revert the document is clean", !(await dirty()));
	await page.keyboard.press("Meta+z");
	await page.waitForTimeout(900);
	check("revert is one undo step, and undo reaches the disk", JSON.stringify(pivot(file)) === "[1,2]");

	await setPivot(3, 3);
	await open("cruiser");
	await page.waitForTimeout(300);
	check("leaving flushes, never reverts", JSON.stringify(pivot(file)) === "[3,3]", `disk pivot ${JSON.stringify(pivot(file))}`);

	// 7. meta and unknown fields round-trip through the studio untouched
	const withMeta = JSON.parse(fs.readFileSync(file, "utf8"));
	withMeta.meta = { forward: "up", about: "the game's own words", game: { situations: { drowse: "curl", hunt: ["shuffle", "reach"] }, weight: 3 } };
	withMeta.custom_top = { kept: true };
	fs.writeFileSync(file, JSON.stringify(withMeta, null, 2) + "\n");
	fs.rmSync(ck, { force: true });
	await open("fighter");
	await setPivot(5, 5);
	await until(() => JSON.stringify(pivot(file)) === "[5,5]");
	await page.locator(".canvas-wrap canvas").click({ position: { x: 30, y: 30 } });
	await page.keyboard.press("Meta+s");
	await page.waitForTimeout(700);
	const saved = JSON.parse(fs.readFileSync(file, "utf8"));
	check("meta survives edit and save, byte for byte", JSON.stringify(saved.meta) === JSON.stringify(withMeta.meta), JSON.stringify(saved.meta));
	check("unknown top-level fields survive too", JSON.stringify(saved.custom_top) === JSON.stringify(withMeta.custom_top));
	check("the checkpoint carries meta as well", JSON.stringify(JSON.parse(fs.readFileSync(ck, "utf8")).meta) === JSON.stringify(withMeta.meta));

	// 8. another tool writes the file: with nothing pending the studio reloads it
	const external = JSON.parse(fs.readFileSync(file, "utf8"));
	external.meta.about = "changed by the game";
	external.meta.game.added = true;
	fs.writeFileSync(file, JSON.stringify(external, null, 2) + "\n");
	await until(async () => (await page.evaluate(() => fastart.ed.doc.value.meta?.about)) === "changed by the game", 5000);
	await page.waitForTimeout(200);
	check("an external change is reloaded", (await page.evaluate(() => fastart.ed.doc.value.meta?.about)) === "changed by the game");
	check("the reload took the whole file", (await page.evaluate(() => fastart.ed.doc.value.meta?.game?.added)) === true);
	check("the reload is an undo step", await page.evaluate(() => fastart.ed.canUndo.value));
	await setPivot(6, 6);
	await until(() => JSON.stringify(pivot(file)) === "[6,6]");
	const afterEdit = JSON.parse(fs.readFileSync(file, "utf8"));
	check("an edit after the reload keeps the external meta", afterEdit.meta.about === "changed by the game" && afterEdit.meta.game.added === true);

	// 9. a change on disk while an edit is pending: the studio asks before writing
	const external2 = JSON.parse(fs.readFileSync(file, "utf8"));
	external2.meta.about = "changed again";
	fs.writeFileSync(file, JSON.stringify(external2, null, 2) + "\n");
	await setPivot(7, 7); // pending: the flush runs before the watch does
	await until(async () => (await page.locator(".dialog").count()) > 0, 3000);
	const dialogUp = (await page.locator(".dialog").count()) > 0;
	check("a conflict asks instead of overwriting", dialogUp);
	check("the file was not overwritten meanwhile", JSON.parse(fs.readFileSync(file, "utf8")).meta.about === "changed again" && JSON.stringify(pivot(file)) !== "[7,7]");
	if (dialogUp) await page.locator(".dialog .btn.primary").click();
	await page.waitForTimeout(500);
	check("Reload takes the file's version", (await page.evaluate(() => fastart.ed.doc.value.meta?.about)) === "changed again" && JSON.stringify(await docPivot()) === "[6,6]");
	await page.keyboard.press("Meta+z");
	await page.waitForTimeout(600);
	check("and the edit is one ⌘Z away", JSON.stringify(await docPivot()) === "[7,7]");
	check("no temp files at the end", tmps().length === 0);
} finally {
	await browser.close();
	server.kill();
	fs.rmSync(P, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
