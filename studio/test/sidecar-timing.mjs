// How long until the first picture of a model that is not being edited:
// placed in a scene, shown as the mannequin, painted on a tile; from
// JSON generation (sidecars off, as the studio drew before 1.8), from a
// sidecar that has to be built first, and from a fresh one.
// `node studio/test/sidecar-timing.mjs <model.fart> [more.fart…]`
// (needs the app built). Each number is the median of three page loads,
// in a headless browser on this machine: compare them with each other.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus")].filter((b) => fs.existsSync(b)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const files = process.argv.slice(2);
if (!bin || !files.length) {
	console.error(bin ? "name a 3D .fart or several" : "no studio binary: go build -o bin/studio . in studio/");
	process.exit(2);
}
const RUNS = 3;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ms = (x) => (x >= 1000 ? `${(x / 1000).toFixed(2)} s` : `${Math.round(x)} ms`);

const browser = await chromium.launch();
try {
	for (const file of files) {
		const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-timing-"));
		// the model in a folder of its own, and what shows it in another: the asset browser opens on the root, where neither
		// has a tile, so nothing reads the model (or makes its sidecar) before the clock starts. tiles/ holds a copy to be a tile.
		for (const d of ["m", "s", "tiles"]) fs.mkdirSync(path.join(P, d));
		fs.copyFileSync(file, path.join(P, "m/model.fart"));
		fs.copyFileSync(file, path.join(P, "tiles/model.fart"));
		fs.writeFileSync(path.join(P, "s/yard.shart"), JSON.stringify({ version: 1, space: "3d", name: "yard", nodes: [{ name: "it", ref: "../m/model.fart", at: [0, 0, 0] }] }) + "\n");
		fs.writeFileSync(path.join(P, "s/stand.fart"), JSON.stringify({ version: 1, space: "3d", name: "stand", palette: [{ name: "ink", rgb: [0, 0, 0, 255] }], parts: [{ name: "a", pivot: [0, 0, 0], shapes: [] }] }) + "\n");
		const glbOf = (what) => path.join(P, what === "tile" ? "tiles/model.fart.glb" : "m/model.fart.glb");
		const server = spawn(bin, ["--serve", P], { stdio: "ignore" });
		for (let i = 0; i < 80; i++) {
			try {
				await fetch("http://127.0.0.1:4747/");
				break;
			} catch {
				await new Promise((r) => setTimeout(r, 250));
			}
		}
		/** one page load: what to show, with sidecars on or off; the milliseconds to the first frame that drew the model, and how many triangles it drew */
		const once = async (what, sidecars) => {
			const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
			const page = await ctx.newPage();
			// (the asset browser would paint the model's tile, and make its sidecar, before the clock starts: tiles are measured apart)
			await page.addInitScript((off) => {
				if (off) localStorage.setItem("fastart.sidecars", "off");
				else localStorage.removeItem("fastart.sidecars");
			}, !sidecars);
			await page.goto("http://localhost:4747/");
			await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
			let out;
			if (what === "tile") {
				// into the folder: its tile is read, parsed and painted off the page's thread
				await page.evaluate(() => fastart.goFolder("tiles"));
				await page.waitForFunction(() => fastart.thumbLog.some((l) => l.rel === "tiles/model.fart"), null, { timeout: 180000 });
				out = await page.evaluate(() => ({ ms: fastart.thumbLog.find((l) => l.rel === "tiles/model.fart").ms, triangles: 0, how: fastart.thumbHow.get("tiles/model.fart") }));
			} else {
				// straight to the asset: the tile is never asked for
				out = await page.evaluate(async (what) => {
					const drawn = () => new Promise((r) => {
						const tick = () => (fastart.glStats.triangles > 0 ? r() : requestAnimationFrame(tick));
						requestAnimationFrame(tick);
					});
					fastart.glStats.triangles = 0;
					if (what === "scene") {
						const t0 = performance.now();
						await fastart.openDoc("s/yard.shart");
						await drawn();
						return { ms: performance.now() - t0, triangles: fastart.glStats.triangles, how: fastart.sidecar.sidecars.log.filter((l) => l.rel === "m/model.fart").map((l) => l.how).join(",") || "generated" };
					}
					await fastart.openDoc("s/stand.fart");
					await new Promise((r) => setTimeout(r, 300));
					fastart.glStats.triangles = 0;
					const t0 = performance.now();
					fastart.model.chooseMannequin({ path: "m/model.fart" });
					await drawn();
					return { ms: performance.now() - t0, triangles: fastart.glStats.triangles, how: fastart.sidecar.sidecars.log.filter((l) => l.rel === "m/model.fart").map((l) => l.how).join(",") || "generated" };
				}, what);
			}
			await ctx.close();
			return out;
		};
		const size = fs.statSync(file).size;
		console.log(`\n${path.basename(file)} · ${(size / 1024).toFixed(0)} KB of JSON`);
		for (const what of ["scene", "mannequin", "tile"]) {
			const row = {};
			for (const mode of ["json", "built", "fresh"]) {
				const times = [];
				let last;
				for (let i = 0; i < RUNS; i++) {
					// json: no sidecar is read or made. built: none on disk, so it is built first. fresh: the one the last run left.
					if (mode !== "fresh") fs.rmSync(glbOf(what), { force: true });
					last = await once(what, mode !== "json");
					times.push(last.ms);
				}
				row[mode] = { ms: median(times), ...last };
			}
			const tri = row.fresh.triangles || row.json.triangles;
			console.log(`  ${what.padEnd(9)} from JSON ${ms(row.json.ms).padStart(8)} · sidecar built first ${ms(row.built.ms).padStart(8)} (${row.built.how}) · fresh sidecar ${ms(row.fresh.ms).padStart(8)} (${row.fresh.how}) · ${(row.json.ms / row.fresh.ms).toFixed(1)}× ${tri ? `· ${tri} triangles` : ""}`);
		}
		if (fs.existsSync(glbOf("scene"))) console.log(`  the sidecar: ${(fs.statSync(glbOf("scene")).size / 1024).toFixed(0)} KB`);
		server.kill();
		await new Promise((r) => setTimeout(r, 400));
		fs.rmSync(P, { recursive: true, force: true });
	}
} finally {
	await browser.close();
}
