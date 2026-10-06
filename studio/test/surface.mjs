// Format 1.8 in the model screen, end to end, in the served studio with
// a headless browser: paint, shades, modifiers and pipes drawn right;
// faces painted by button and by brush; the modifier stack; Shade
// corners; the pipe tool on the view plane and on a surface, with its
// twin; compiled sidecars (written, fresh, hidden, rebuilt, never drawn
// from when stale) behind thumbnails, a scene, the mannequin and render;
// the one offer about .gitignore; and the Ask panel's tools for all of
// it, called the way the relay calls them.
// `node studio/test/surface.mjs [dir for screenshots]` (needs the app
// built: npx vite build in studio/frontend, go build -o bin/studio . in studio).
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { box, lathe, stringifyDoc, validate, sidecarFresh, sidecarInfo, flattenPart, parseDoc } from "../../packages/core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus")].filter((b) => fs.existsSync(b)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!bin) {
	console.error("no studio binary: go build -o bin/studio . in studio/");
	process.exit(2);
}
const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

/** A PNG's pixels (8 bits, RGB or RGBA, not interlaced: what a screenshot is). */
function decodePng(buf) {
	let at = 8;
	let w = 0;
	let h = 0;
	let ch = 4;
	const idat = [];
	while (at < buf.length) {
		const len = buf.readUInt32BE(at);
		const type = buf.toString("latin1", at + 4, at + 8);
		const data = buf.subarray(at + 8, at + 8 + len);
		if (type === "IHDR") {
			w = data.readUInt32BE(0);
			h = data.readUInt32BE(4);
			ch = data[9] === 6 ? 4 : 3;
		} else if (type === "IDAT") idat.push(data);
		at += 12 + len;
	}
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const row = w * ch;
	const out = Buffer.alloc(h * row);
	for (let y = 0; y < h; y++) {
		const f = raw[y * (row + 1)];
		for (let x = 0; x < row; x++) {
			const v = raw[y * (row + 1) + 1 + x];
			const a = x >= ch ? out[y * row + x - ch] : 0;
			const b = y ? out[(y - 1) * row + x] : 0;
			const c = x >= ch && y ? out[(y - 1) * row + x - ch] : 0;
			let p = 0;
			if (f === 1) p = a;
			else if (f === 2) p = b;
			else if (f === 3) p = (a + b) >> 1;
			else if (f === 4) {
				const pa = Math.abs(b - c);
				const pb = Math.abs(a - c);
				const pc = Math.abs(a + b - 2 * c);
				p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[y * row + x] = (v + p) & 255;
		}
	}
	return { w, h, at: (x, y) => [...out.subarray((y * w + x) * ch, (y * w + x) * ch + 3)] };
}

// ------------------------------------------------------------- the project
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-surface-"));
// a repository of its own, so the one offer about .gitignore can be seen being made
execFileSync("git", ["init", "-q", P]);
const palette = [
	{ name: "steel", rgb: [150, 160, 175, 255] },
	{ name: "brass", rgb: [214, 168, 60, 255] },
	{ name: "lining", rgb: [110, 40, 46, 255] },
];
const doc = (name, shapes, extra = {}) => ({ version: 1, space: "3d", name, palette, parts: [{ name, pivot: [0, 0, 0], shapes }], states: [{ name: "rest", parts: [{ part: name, offset: [0, 0, 0] }] }], ...extra });
// half a hood: the x ≥ 0 half of a dome, open at the bottom and along the plane x = 0, wound outward
const hood = (() => {
	const points = [];
	const faces = [];
	const R = 4;
	const C = 4;
	points.push([0, -10, 0]);
	const rows = [0.55, 1.05, Math.PI / 2];
	for (const ph of rows) for (let c = 0; c <= C; c++) {
		const th = -Math.PI / 2 + (c / C) * Math.PI;
		points.push([+(R * Math.sin(ph) * Math.cos(th)).toFixed(3) + 0, +(-6 - R * Math.cos(ph)).toFixed(3), +(R * Math.sin(ph) * Math.sin(th)).toFixed(3)]);
	}
	const at = (r, c) => 1 + r * (C + 1) + c;
	for (let c = 0; c < C; c++) faces.push([0, at(0, c + 1), at(0, c)]);
	for (let r = 0; r + 1 < rows.length; r++) for (let c = 0; c < C; c++) faces.push([at(r, c), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c)]);
	// wound outward: every face's normal leans away from the dome's middle
	const mid = [0, -6, 0];
	const fixed = faces.map((f) => {
		const n = [0, 0, 0];
		const ctr = [0, 0, 0];
		for (let k = 0; k < f.length; k++) {
			const a = points[f[k]];
			const b = points[f[(k + 1) % f.length]];
			n[0] += (a[1] - b[1]) * (a[2] + b[2]);
			n[1] += (a[2] - b[2]) * (a[0] + b[0]);
			n[2] += (a[0] - b[0]) * (a[1] + b[1]);
			for (let i = 0; i < 3; i++) ctr[i] += a[i] / f.length;
		}
		return n[0] * (ctr[0] - mid[0]) + n[1] * (ctr[1] - mid[1]) + n[2] * (ctr[2] - mid[2]) < 0 ? [...f].reverse() : f;
	});
	return { kind: "mesh", color: "steel", points, faces: fixed };
})();
// the cap: the half hood, and a crest standing on its crown (something for the shades to find)
const cap = doc("cap", [hood, box("steel", [1.2, -10.4, 0], [1.6, 1.6, 1.6])]);
cap.states.push({ name: "worn", parts: [{ part: "cap", offset: [0, 0, 0], morph: [{ shape: 0, points: hood.points.map((p) => [+(p[0] * 1.1).toFixed(3), p[1], +(p[2] * 1.1).toFixed(3)]) }] }] });
fs.writeFileSync(path.join(P, "cap.fart"), stringifyDoc(cap));
// a plain box to paint
fs.writeFileSync(path.join(P, "crate.fart"), stringifyDoc(doc("crate", [box("steel", [0, -3, 0], [6, 6, 6])])));
// the body: its colour comes from a palette file, so a recolour changes no byte of the model
fs.writeFileSync(path.join(P, "skin.fart"), JSON.stringify({ version: 1, name: "skin", palette: [{ name: "skin", rgb: [224, 172, 140, 255] }] }, null, 2) + "\n");
const head = lathe("skin", [[0.01, -9.5], [1.6, -9.1], [2.4, -7.5], [2.2, -5.9], [1.2, -4.9], [1, -3.5], [0.01, -3.5]], "y", 12);
head.smooth = 1;
const body = { version: 1, space: "3d", name: "body", palette_refs: ["skin.fart"], parts: [{ name: "body", pivot: [0, 0, 0], shapes: [head, box("skin", [0, -1, 0], [5, 5, 3])] }], states: [{ name: "rest", parts: [{ part: "body", offset: [0, 0, 0] }] }] };
fs.writeFileSync(path.join(P, "body.fart"), stringifyDoc(body));
// a scene that places the two
fs.writeFileSync(path.join(P, "yard.shart"), JSON.stringify({ version: 1, space: "3d", name: "yard", nodes: [{ name: "man", ref: "body.fart", at: [-6, 0, 0] }, { name: "hat", ref: "cap.fart", at: [6, 0, 0] }] }, null, 2) + "\n");
// the corpus's 1.8 files and the example helm, to look at
for (const f of ["paint", "mods", "pipe"]) fs.copyFileSync(path.join(repo, "spec/examples/valid", `${f}.fart`), path.join(P, `${f}.fart`));
fs.copyFileSync(path.join(repo, "examples/helm/helm.fart"), path.join(P, "helm.fart"));
/** how many triangles core generates for a file: what the canvas should be drawing */
const trianglesOf = (file, state = 0) => {
	const d = parseDoc(fs.readFileSync(path.join(P, file), "utf8")).doc;
	const poses = d.states?.[state]?.parts;
	let n = 0;
	for (const part of d.parts) {
		const sp = poses?.find((x) => x.part === part.name);
		if (poses && !sp) continue;
		for (const tm of flattenPart(d, part, sp)) n += tm.count;
	}
	return n;
};
const sidecarOf = (file) => path.join(P, `${file}.glb`);
const fresh = (file) => fs.existsSync(sidecarOf(file)) && sidecarFresh(new Uint8Array(fs.readFileSync(sidecarOf(file))), new Uint8Array(fs.readFileSync(path.join(P, file))));
const valid = (file) => {
	const r = validate(JSON.parse(fs.readFileSync(path.join(P, file), "utf8")));
	return r.ok ? "" : r.errors.map((e) => `${e.code} ${e.path}`).join("; ");
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
	page.on("pageerror", (e) => {
		console.log("pageerror:", e.message);
		fails++;
	});
	await page.goto("http://localhost:4747/");
	await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
	const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
	const wait = (ms = 160) => page.waitForTimeout(ms);
	const ev = (fn, arg) => page.evaluate(fn, arg);
	const until = async (fn, ms = 15000) => {
		const t0 = Date.now();
		while (Date.now() - t0 < ms) {
			if (await fn()) return true;
			await wait(120);
		}
		return false;
	};
	const call = async (name, args) => {
		const r = await ev(({ name, args }) => fastart.callTool(name, args), { name, args });
		return { isError: !!r.isError, text: r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), images: r.content.filter((c) => c.type === "image").map((c) => c.data) };
	};
	const docNow = () => ev(() => JSON.stringify(fastart.md.doc.value));
	const shapeAt = (i) => ev((i) => fastart.md.doc.value.parts[0].shapes[i], i);
	const undo = async () => {
		await page.keyboard.press("Meta+z");
		await wait();
	};
	const redo = async () => {
		await page.keyboard.press("Meta+Shift+z");
		await wait();
	};
	/** does something as exactly one undo step: one undo puts the document back, one redo does it again */
	const oneStep = async (name, act, test = () => true, extra = "") => {
		const before = await docNow();
		await act();
		await wait();
		const after = await docNow();
		const did = after !== before && (await test());
		await undo();
		const back = (await docNow()) === before;
		await redo();
		const again = (await docNow()) === after;
		check(`${name}: done, and exactly one undo step`, did && back && again, `${did ? "" : "not done "}${back ? "" : "one undo did not put it back "}${again ? "" : "redo differs"}${extra}`);
	};
	const open = async (file) => {
		// leaving a model that has changed since its checkpoint asks first: keep the checkpoint, as a person would
		if (await ev(() => fastart.project.screen.value === "model" && fastart.md.dirty.value)) {
			await page.keyboard.press("Meta+s");
			await page.waitForFunction(() => !fastart.md.dirty.value);
		}
		await ev((f) => fastart.openDoc(f), file);
		await page.waitForFunction((f) => (f.endsWith(".shart") ? fastart.sc.path.value === f && fastart.sc.loaded.value : fastart.md.path.value === f), file);
		await wait(500);
	};
	let box0;
	const measure = async () => (box0 = await page.locator(".canvas-wrap canvas").last().boundingBox());
	/** where a point of a part's rest space sits on the page */
	const onPage = (p, part = 0) =>
		ev(
			({ p, part, box }) => {
				const fp = fastart.model.framePartOf(part);
				const F = fp.F;
				const x = F[0] * p[0] + F[1] * p[1] + F[2] * p[2] + F[9];
				const y = F[3] * p[0] + F[4] * p[1] + F[5] * p[2] + F[10];
				const z = fastart.view.zoom.value;
				const pan = fastart.view.pan.value;
				const [W, H] = fastart.view.size.value;
				return [box.x + (x - pan[0]) * z + W / 2, box.y + (y - pan[1]) * z + H / 2];
			},
			{ p, part, box: box0 },
		);
	const centre = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
	const faceMid = async (shape, face) => {
		const sh = await shapeAt(shape);
		return onPage(centre(sh.faces[face].map((v) => sh.points[v])));
	};
	/** the face of a shape whose outward normal points most along a direction */
	const faceToward = (shape, d) =>
		ev(
			({ shape, d }) => {
				const sh = fastart.md.doc.value.parts[0].shapes[shape];
				let best = -1;
				let bestK = -Infinity;
				sh.faces.forEach((f, i) => {
					const n = [0, 0, 0];
					for (let k = 0; k < f.length; k++) {
						const a = sh.points[f[k]];
						const b = sh.points[f[(k + 1) % f.length]];
						n[0] += (a[1] - b[1]) * (a[2] + b[2]);
						n[1] += (a[2] - b[2]) * (a[0] + b[0]);
						n[2] += (a[0] - b[0]) * (a[1] + b[1]);
					}
					const l = Math.hypot(...n) || 1;
					const kk = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l;
					if (kk > bestK + 1e-9) {
						bestK = kk;
						best = i;
					}
				});
				return best;
			},
			{ shape, d },
		);
	const pixel = async (at) => {
		const png = decodePng(await page.screenshot());
		return png.at(Math.round(at[0]), Math.round(at[1]));
	};
	const insp = page.locator(".inspector");
	const status = () => page.locator(".ur-statusbar").textContent();
	const pickMode = async (label) => {
		await insp.locator(".ur-seg[aria-label=Choose] button", { hasText: label }).click();
		await wait();
	};
	/** pick a colour in one of the inspector's colour menus, by the menu's name */
	const pickColour = async (label, token) => {
		await insp.locator(`button[aria-label="${label}"]`).first().click();
		await wait(80);
		await insp.locator(".model-fill-pop .ur-color", { hasText: token }).first().click();
		await wait();
	};
	const field = (label, scope = insp) => scope.locator(".ur-prop", { has: page.locator(`label:text-is("${label}")`) }).locator("input").first();
	const setField = async (label, value, scope = insp) => {
		const f = field(label, scope);
		await f.fill(String(value));
		await f.press("Enter");
		await wait();
	};
	const button = (text, scope = insp) => scope.locator("button", { hasText: new RegExp(`^${text}$`) });
	const selectShape = async (i) => {
		await ev((i) => fastart.model.selectShapes([{ part: 0, shape: i }]), i);
		await wait();
	};
	const view3q = async () => {
		await ev(() => fastart.model.setTurn([0.45, -0.7, 0]));
		await page.keyboard.press("Shift+1");
		await wait(300);
		await measure();
	};

	// ------------------------------------------------------------- 0. sidecars behind the browser's pictures, and the one offer
	const models = ["cap.fart", "crate.fart", "body.fart", "paint.fart", "mods.fart", "pipe.fart", "helm.fart"];
	check("the browser's tiles made a sidecar for every 3D model", await until(() => models.every((f) => fs.existsSync(sidecarOf(f)))), models.filter((f) => !fs.existsSync(sidecarOf(f))).join(", "));
	check("each is fresh: made from its source's bytes, by this library", models.every(fresh), models.filter((f) => !fresh(f)).join(", "));
	check("a 2D-less palette file and a scene have none", !fs.existsSync(sidecarOf("skin.fart")) && !fs.existsSync(path.join(P, "yard.shart.glb")));
	check("the tiles' pictures were painted from them", await until(() => ev((models) => models.every((f) => ["built", "read"].includes(fastart.thumbHow.get(f)) && fastart.project.thumbs.value.get(f)?.image), models)), await ev((models) => models.map((f) => `${f}:${fastart.thumbHow.get(f)}`).join(" "), models));
	check("no sidecar is listed among the project's files", await ev(() => fastart.project.files.value.every((f) => !f.endsWith(".glb")) && fastart.project.files.value.length === 9), await ev(() => fastart.project.files.value.join(",")));
	check("nor shown anywhere in the window", !(await page.locator("body").textContent()).includes(".glb") || (await page.locator(".ur-sheet").count()) === 1);
	// the offer: once, in the studio's voice, only because this is a repository that would commit them
	check("the studio offers, once, to keep them out of git", await until(async () => (await page.locator(".ur-sheet .ur-sheet-title").count()) === 1 && (await page.locator(".ur-sheet .ur-sheet-title").textContent()).includes("out of git")), await page.locator(".ur-sheet").count() ? await page.locator(".ur-sheet").textContent() : "no sheet");
	check("nothing was added before the answer", !fs.existsSync(path.join(P, ".gitignore")));
	await shot("00-the-offer");
	await page.locator(".ur-sheet button", { hasText: "Add to .gitignore" }).click();
	check("yes adds the line", await until(() => fs.existsSync(path.join(P, ".gitignore")) && fs.readFileSync(path.join(P, ".gitignore"), "utf8").split("\n").includes("*.fart.glb")));
	check("git no longer sees a sidecar", !execFileSync("git", ["-C", P, "status", "--porcelain", "-uall"]).toString().includes(".glb"));
	await shot("01-browser-tiles-from-sidecars");

	// ------------------------------------------------------------- 1. the canvas draws 1.8 right
	for (const f of ["paint.fart", "mods.fart", "pipe.fart", "helm.fart"]) {
		await open(f);
		await view3q();
		const want = trianglesOf(f);
		const got = await ev(() => fastart.glStats.triangles);
		check(`${f}: the canvas draws the ${want} triangles core generates`, got === want, `drew ${got}`);
		await shot(`1-${f.replace(".fart", "")}`);
	}
	// the helm: its band is brass, its dome steel, on the canvas
	{
		const d = JSON.parse(fs.readFileSync(path.join(P, "helm.fart"), "utf8"));
		const sh = d.parts[0].shapes[0];
		const brass = sh.colors.indexOf("brass") + 1;
		// faces whose middle is itself on the surface the viewer sees: asked of the canvas
		const seen = async (want) => {
			for (let f = 0; f < sh.faces.length; f++) {
				if ((sh.paint[f] === brass) !== want || (!want && sh.paint[f] !== 0)) continue;
				const at = await onPage(centre(sh.faces[f].map((v) => sh.points[v])));
				const hit = await ev(({ at, box }) => { const [W, H] = fastart.view.size.value; const wm = fastart.toWorld([at[0] - box.x, at[1] - box.y], W, H); const h = fastart.surface.surfaceUnder(wm); return h ? h.n[2] : 0; }, { at, box: box0 });
				if (hit < -0.6) return at;
			}
			return null;
		};
		const b = await seen(true);
		const s = await seen(false);
		const pb = b ? await pixel(b) : [0, 0, 0];
		const ps = s ? await pixel(s) : [0, 0, 0];
		check("a brass face is brass on the canvas", !!b && pb[0] > pb[2] * 1.6 && pb[0] > pb[1], pb.join(","));
		check("a steel face is steel", !!s && Math.abs(ps[0] - ps[2]) < 40 && ps[2] >= ps[0], ps.join(","));
	}
	// shades darken: the same mesh with and without its shades, at the same place
	{
		const dark = await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[0]; let i = 0; sh.shades.forEach((v, k) => { if (v < sh.shades[i]) i = k; }); return { i, shade: sh.shades[i], p: sh.points[i] }; });
		await ev(() => fastart.model.setTurn([-0.9, 0.3, 0]));
		await page.keyboard.press("Shift+1");
		await wait(300);
		await measure();
		// looked at from below, into the hood: how bright the canvas is over the model, with its shades and without
		const light = async () => {
			const png = decodePng(await page.screenshot({ clip: box0 }));
			let sum = 0;
			for (let y = 0; y < png.h; y += 3) for (let x = 0; x < png.w; x += 3) sum += png.at(x, y).reduce((a, b) => a + b, 0);
			return sum;
		};
		const withShades = await light();
		const kept = await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[0]; const s = sh.shades; fastart.model.mutate(() => delete sh.shades); return s; });
		await wait(250);
		const without = await light();
		await undo();
		await wait(250);
		check("the helm's shades darken what they shade", dark.shade < 1 && withShades < without * 0.995 && (await light()) === withShades && (await ev((n) => fastart.md.doc.value.parts[0].shapes[0].shades?.length === n, kept.length)), `${withShades} with, ${without} without`);
		await shot("1-helm-inside-shaded");
	}

	// ------------------------------------------------------------- 2. painting faces
	await open("crate.fart");
	await view3q();
	await selectShape(0);
	await pickMode("Faces");
	const top = await faceToward(0, [0, -1, 0]);
	await page.mouse.click(...(await faceMid(0, top)));
	await wait();
	check("a click chooses the top face", await ev((f) => JSON.stringify(fastart.md.faces.value) === JSON.stringify([f]), top));
	await pickColour("Paint colour", "brass");
	check("the colour to paint with is picked from the palette", await ev(() => fastart.md.paintTok.value === "brass"));
	await oneStep("Paint", () => button("Paint").click(), async () => {
		const sh = await shapeAt(0);
		return JSON.stringify(sh.colors) === '["brass"]' && sh.paint.length === 6 && sh.paint[top] === 1 && sh.paint.filter((p) => p).length === 1;
	});
	{
		const at = await faceMid(0, top);
		await ev(() => fastart.model.chooseFaces([]));
		await wait(200);
		const px = await pixel(at);
		check("the painted face is brass on the canvas", px[0] > px[2] * 1.6, px.join(","));
		await ev((f) => fastart.model.chooseFaces([f]), top);
	}
	await shot("2a-face-painted");
	// by brush: B, then a drag across two faces is one stroke
	// two side faces the view shows: ones whose middle, asked of the canvas, is themselves
	const showing = [];
	for (const d of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0]]) {
		const f = await faceToward(0, d);
		const at = await faceMid(0, f);
		if ((await ev(({ at, box }) => { const [W, H] = fastart.view.size.value; return fastart.hitFace(fastart.toWorld([at[0] - box.x, at[1] - box.y], W, H)); }, { at, box: box0 })) === f) showing.push(f);
	}
	const [sideA, sideB] = showing;
	await pickColour("Paint colour", "lining");
	await page.keyboard.press("b");
	await wait();
	check("B turns the brush on, and the status bar says so", (await ev(() => fastart.md.painting.value)) && (await status()).includes("painting faces lining"), await status());
	const a0 = await faceMid(0, sideA);
	const b0 = await faceMid(0, sideB);
	await oneStep(
		"a brush stroke across two faces",
		async () => {
			await page.mouse.move(a0[0], a0[1]);
			await page.mouse.down();
			await page.mouse.move(b0[0], b0[1], { steps: 12 });
			await page.mouse.up();
		},
		async () => {
			const sh = await shapeAt(0);
			const lin = sh.colors.indexOf("lining") + 1;
			return lin > 0 && sh.paint[sideA] === lin && sh.paint[sideB] === lin && sh.paint[top] === sh.colors.indexOf("brass") + 1;
		},
	);
	await shot("2b-brushed");
	await page.keyboard.press("Escape");
	await wait();
	check("Esc puts the brush down", !(await ev(() => fastart.md.painting.value)));
	// minimal: painting faces the shape's own colour takes their paint away; the last one takes colors and paint with it
	await ev(({ a, b }) => fastart.model.chooseFaces([a, b]), { a: sideA, b: sideB });
	await pickColour("Paint colour", "steel");
	await button("Paint").click();
	await wait();
	let sh0 = await shapeAt(0);
	check("painted back to the fill: the unused colour is dropped", JSON.stringify(sh0.colors) === '["brass"]' && sh0.paint.filter((p) => p).length === 1, JSON.stringify([sh0.colors, sh0.paint]));
	await ev((f) => fastart.model.chooseFaces([f]), top);
	await button("Paint").click();
	await wait();
	sh0 = await shapeAt(0);
	check("every face the fill again: paint and colors are gone from the file", sh0.paint === undefined && sh0.colors === undefined, JSON.stringify([sh0.colors, sh0.paint]));
	// inset with a border colour: the ring is the trim
	await ev((f) => fastart.model.chooseFaces([f]), top);
	const before2 = await docNow();
	await button("Inset").click();
	await wait();
	await setField("Amount", 0.8);
	await setField("Raise", 0.3);
	await pickColour("Border colour", "brass");
	sh0 = await shapeAt(0);
	const ring = sh0.paint.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
	check("Inset with a border colour: the ring of four quads is brass, the inner face and the rest are not", sh0.faces.length === 10 && ring.length === 4 && ring.every((i) => i >= 6) && JSON.stringify(sh0.colors) === '["brass"]', JSON.stringify(sh0.paint));
	await shot("2c-inset-border-colour");
	await undo();
	check("the inset, its numbers and its border colour were one undo step", (await docNow()) === before2);
	await redo();
	// extrude a painted face: its walls wear its paint
	await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[0]; fastart.model.chooseFaces([sh.paint.findIndex((p) => p)]); });
	await button("Extrude").click();
	await wait();
	sh0 = await shapeAt(0);
	check("extruding a painted face gives its walls the same paint", sh0.faces.length === 14 && sh0.paint.filter((p) => p).length === 4 + 4, JSON.stringify(sh0.paint));
	await ev(() => fastart.model.flushNow());
	check("the painted crate on disk is a valid file", (await until(() => fs.readFileSync(path.join(P, "crate.fart"), "utf8").includes('"paint"'))) && valid("crate.fart") === "", valid("crate.fart"));

	// ------------------------------------------------------------- 3. the modifier stack
	await open("cap.fart");
	await view3q();
	await selectShape(0);
	const baseTris = await ev(() => fastart.glStats.triangles);
	const addMod = async (name) => {
		await insp.locator(".ur-insp", { hasText: "Modifiers" }).locator("select").selectOption({ label: name });
		await wait(250);
	};
	const mods = () => ev(() => JSON.stringify(fastart.md.doc.value.parts[0].shapes[0].mods ?? []));
	const modRow = (op) => insp.locator(`.model-mod[data-mod=${op}]`);
	await oneStep("Add a Mirror modifier", () => addMod("Mirror"), async () => (await mods()) === '[{"op":"mirror","axis":"x"}]');
	check("the canvas shows both halves at once: the hood's triangles twice, the crest's once", (await ev(() => fastart.glStats.triangles)) === baseTris + (baseTris - 12), `${baseTris} then ${await ev(() => fastart.glStats.triangles)}`);
	check("the working symmetry stands down under a Mirror modifier, and says why", (await insp.locator(".ur-prop", { hasText: "Symmetry" }).locator("input").isDisabled()) && (await insp.textContent()).includes("Its Mirror modifier across x does this in the file already"));
	await ev(() => fastart.workspace.setMirror("cap", 0, true));
	check("even with its note on, edits are not doubled", await ev(() => fastart.model.symmetryOf({ part: 0, shape: 0 }) === null && !fastart.model.symOn({ part: 0, shape: 0 })));
	await ev(() => fastart.workspace.setMirror("cap", 0, false));
	await oneStep("Add a Solidify modifier", () => addMod("Solidify"), async () => JSON.parse(await mods()).length === 2);
	await oneStep("its thickness, typed", () => setField("Thick", 0.4, modRow("solidify")), async () => JSON.parse(await mods())[1].thick === 0.4);
	await oneStep("its inner colour, picked from the palette", () => pickColour("Inner colour", "lining"), async () => {
		const sh = await shapeAt(0);
		return JSON.stringify(sh.colors) === '["lining"]' && sh.mods[1].inner === 1 && sh.paint === undefined;
	});
	await oneStep("its rim colour", () => pickColour("Rim colour", "brass"), async () => {
		const sh = await shapeAt(0);
		return JSON.stringify(sh.colors) === '["lining","brass"]' && sh.mods[1].rim === 2;
	});
	await oneStep("Add a Crease modifier", () => addMod("Crease"), async () => JSON.parse(await mods()).length === 3);
	await oneStep("its angle", () => setField("Angle", 50, modRow("crease")), async () => JSON.parse(await mods())[2].angle === 50);
	await oneStep("reorder: Crease moved earlier", () => modRow("crease").locator("button[aria-label^='Move Crease earlier']").click(), async () => JSON.parse(await mods()).map((m) => m.op).join() === "mirror,crease,solidify");
	await oneStep("remove Crease", () => modRow("crease").locator("button[aria-label='Remove Crease']").click(), async () => JSON.parse(await mods()).map((m) => m.op).join() === "mirror,solidify");
	await ev(() => fastart.model.flushNow());
	check("a cage under modifiers is a valid file", valid("cap.fart") === "", valid("cap.fart"));
	check("the canvas draws what core generates from it", (await ev(() => fastart.glStats.triangles)) === trianglesOf("cap.fart"), `${await ev(() => fastart.glStats.triangles)} against ${trianglesOf("cap.fart")}`);
	// editing acts on the cage: a corner dragged moves the cage's point, and the surface follows
	await pickMode("Corners");
	const cageN = (await shapeAt(0)).points.length;
	const corner = await onPage((await shapeAt(0)).points[8]);
	const trisBefore = await ev(() => fastart.glStats.triangles);
	await oneStep(
		"a cage corner dragged under the modifiers",
		async () => {
			await page.mouse.move(corner[0], corner[1]);
			await page.mouse.down();
			await page.mouse.move(corner[0] + 24, corner[1] - 10, { steps: 6 });
			await page.mouse.up();
		},
		async () => (await shapeAt(0)).points.length === cageN && (await ev(() => fastart.glStats.triangles)) === trisBefore,
	);
	check("the status bar says the cage is what is edited", (await status()).includes("the cage under 2 modifiers"), await status());
	await shot("3a-modifier-stack-cage-and-surface");
	// the same in the dark appearance
	await page.emulateMedia({ colorScheme: "dark" });
	await wait(400);
	await shot("3a-dark");
	await page.emulateMedia({ colorScheme: "light" });
	await wait(300);
	// smooth over it, as a helm would be
	await setField("Smooth", 1);
	await shot("3b-smooth-over-modifiers");
	await setField("Smooth", 0);
	// Apply: the modifiers become the mesh's own geometry, with the morph carried
	await oneStep(
		"Apply, down to Solidify",
		() => modRow("solidify").locator("button", { hasText: /^Apply$/ }).click(),
		async () => {
			const sh = await shapeAt(0);
			const morph = await ev(() => fastart.md.doc.value.states[1].parts[0].morph[0].points.length);
			const lin = sh.colors.indexOf("lining") + 1;
			return sh.mods === undefined && sh.points.length > cageN * 3 && morph === sh.points.length && sh.paint.filter((p) => p === lin).length > 0 && sh.paint.length === sh.faces.length;
		},
	);
	await ev(() => fastart.model.flushNow());
	check("the applied mesh draws the same triangles and is a valid file", (await ev(() => fastart.glStats.triangles)) === trisBefore && valid("cap.fart") === "", `${await ev(() => fastart.glStats.triangles)} against ${trisBefore}; ${valid("cap.fart")}`);
	const info = JSON.parse((await call("mesh_info", { part: "cap", shape: 0 })).text);
	check("and is one closed, outward, manifold solid", info.manifold && info.closed && info.windsOutward, JSON.stringify(info).slice(0, 160));
	await shot("3c-applied");
	await undo();
	check("undo brings the modifiers back", JSON.parse(await mods()).length === 2);

	// ------------------------------------------------------------- 4. shades
	await selectShape(0);
	await setField("Shades", 0.8);
	await oneStep("Shade corners", () => button("Shade corners").click(), async () => {
		const sh = await shapeAt(0);
		return Array.isArray(sh.shades) && sh.shades.length === sh.points.length && Math.min(...sh.shades) < 0.9 && Math.max(...sh.shades) === 1 && sh.shades.every((v) => v >= 0.2 && v <= 1);
	});
	const strong = Math.min(...(await shapeAt(0)).shades);
	{
		// the corner under the crest is the darkest; the rim, out in the open, is not shaded at all
		const sh = await shapeAt(0);
		const apex = sh.shades[0];
		const rim = sh.shades[sh.points.length - 1];
		check("the crown, under the crest, is darker than the open rim", apex < rim && rim > 0.9, `crown ${apex}, rim ${rim}, darkest ${strong}`);
	}
	await shot("4-shaded-corners");
	await setField("Shades", 0.3);
	await button("Shade corners").click();
	await wait();
	check("a weaker strength shades less", Math.min(...(await shapeAt(0)).shades) > strong, `${Math.min(...(await shapeAt(0)).shades)} against ${strong}`);
	await ev(() => fastart.model.flushNow());
	check("shades are valid in the file", valid("cap.fart") === "" && JSON.parse(fs.readFileSync(path.join(P, "cap.fart"), "utf8")).parts[0].shapes[0].shades.length === cageN, valid("cap.fart"));
	await oneStep("Clear", () => button("Clear").click(), async () => (await shapeAt(0)).shades === undefined);
	await undo();

	// ------------------------------------------------------------- 5. pipes
	const nShapes = () => ev(() => fastart.md.doc.value.parts[0].shapes.length);
	const shapesBefore = await nShapes();
	// on the view plane, in the front view
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await selectShape(0);
	await page.keyboard.press("1");
	await page.keyboard.press("Shift+1");
	await wait(300);
	await measure();
	await page.keyboard.press("u");
	await wait();
	check("U picks the pipe tool, and the status bar says where clicks land", (await ev(() => fastart.md.tool.value === "pipe")) && (await status()).includes("on the view plane"), await status());
	check("under a Mirror modifier the pipe tool offers a twin", await ev(() => fastart.md.pipeTwin.value === true));
	await page.locator(".ur-palette button[aria-label^='Symmetry']").click();
	await wait();
	const free = [[box0.x + 120, box0.y + 140], [box0.x + 200, box0.y + 90], [box0.x + 290, box0.y + 150]];
	const beforePipe = await docNow();
	for (const p of free) {
		await page.mouse.click(p[0], p[1]);
		await wait(60);
	}
	check("three clicks are three points of a path, not yet a shape", (await ev(() => fastart.md.pipePts.value.length)) === 3 && (await docNow()) === beforePipe);
	await shot("5a-pipe-being-clicked");
	await page.keyboard.press("Enter");
	await wait();
	let pipe = await shapeAt(shapesBefore);
	check("Return makes the pipe: a sweep along the three points, on the view plane through the origin", (await nShapes()) === shapesBefore + 1 && pipe?.kind === "sweep" && pipe.op === "pipe" && pipe.path.points.length === 3 && pipe.path.points.every((p) => Math.abs(p[2]) < 1e-6) && pipe.radius === 0.5 && pipe.path.out?.length === 3, JSON.stringify(pipe));
	check("it is selected, and the tool is Select again", await ev((i) => fastart.md.sel.value?.shape === i && fastart.md.tool.value === "select", shapesBefore));
	await undo();
	check("the pipe was one undo step", (await docNow()) === beforePipe);
	await redo();
	// its handles: a point dragged
	await selectShape(shapesBefore);
	const h1 = await onPage((await shapeAt(shapesBefore)).path.points[1]);
	await oneStep(
		"a point of the path dragged",
		async () => {
			await page.mouse.move(h1[0], h1[1]);
			await page.mouse.down();
			await page.mouse.move(h1[0] + 10, h1[1] - 40, { steps: 6 });
			await page.mouse.up();
		},
		async () => {
			const s = await shapeAt(shapesBefore);
			return s.path.points[1][1] < pipe.path.points[1][1] - 0.3 && s.path.points[1][0] > pipe.path.points[1][0] && Math.abs(s.path.points[1][2]) < 1e-6 && (await ev(() => fastart.md.pipePt.value)) === 1;
		},
	);
	// the inspector: radius, the radius at the chosen point, segments, closed, caps
	await oneStep("Radius", () => setField("Radius", 0.35), async () => (await shapeAt(shapesBefore)).radius === 0.35);
	await oneStep("Radius here", () => setField("Radius here", 1.6), async () => JSON.stringify((await shapeAt(shapesBefore)).radii) === "[1,1.6,1]");
	await oneStep("Segments", () => setField("Segments", 6), async () => (await shapeAt(shapesBefore)).segments === 6);
	const tick = (label) => insp.locator("label.ur-checkbox", { hasText: new RegExp(`^${label}$`) });
	await oneStep("Closed", () => tick("Closed").click(), async () => (await shapeAt(shapesBefore)).closed === true);
	await tick("Closed").click();
	await wait();
	await oneStep("Caps off", () => tick("Caps").click(), async () => (await shapeAt(shapesBefore)).caps === false);
	await ev(() => fastart.model.flushNow());
	check("the pipe is valid in the file", valid("cap.fart") === "", valid("cap.fart"));
	await shot("5b-pipe-and-its-handles");
	// on the surface: a curl drawn on the hood, with its twin
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await selectShape(0);
	await view3q();
	await page.keyboard.press("u");
	await wait();
	await page.locator(".ur-palette button[aria-label^='On surface']").click();
	await wait();
	check("On surface is a mode of the pipe tool, named in the status bar", (await ev(() => fastart.md.onSurface.value && fastart.md.pipeTwin.value)) && (await status()).includes("on the surface under the pointer") && (await status()).includes("mirrored twin"), await status());
	// three places on the right half of the hood, on the canvas
	const hoodNow = await shapeAt(0);
	const onHood = [];
	for (const f of [5, 10, 6]) onHood.push(await onPage(centre(hoodNow.faces[f].map((v) => hoodNow.points[v]))));
	const beforeCurl = await docNow();
	for (const p of onHood) {
		await page.mouse.click(p[0], p[1]);
		await wait(60);
	}
	await shot("5c-pipe-on-the-surface");
	await page.keyboard.press("Enter");
	await wait();
	const curlAt = shapesBefore + 1;
	const curl = await shapeAt(curlAt);
	const twin = await shapeAt(curlAt + 1);
	/** how far a point of the cap's space is from the hood's drawn surface */
	const off = (p) => ev((p) => { const q = fastart.model.landOnSurface(0, [p], { part: 0, shape: 0 }, 0)[0]; return Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); }, p);
	const gaps = [];
	for (const p of curl?.path?.points ?? []) gaps.push(await off(p));
	check("each click landed on the hood, lifted 0.1 off it, and the pipe was given points to follow the surface between them", curl?.op === "pipe" && curl.path.points.length > 3 && gaps.every((g) => Math.abs(g - 0.1) < 0.02), `${curl?.path?.points.length} points: ${gaps.map((g) => g.toFixed(3)).join(",")}`);
	check("and its twin is the same path mirrored across x", twin?.op === "pipe" && twin.path.points.every((p, i) => Math.abs(p[0] + curl.path.points[i][0]) < 1e-6 && p[1] === curl.path.points[i][1] && p[2] === curl.path.points[i][2]), JSON.stringify(twin?.path?.points));
	await undo();
	check("the pipe and its twin were one undo step", (await docNow()) === beforeCurl);
	await redo();
	// a handle dragged stays on the surface, and the twin follows
	await selectShape(curlAt);
	const last = curl.path.points.length - 1;
	const c1 = await onPage(curl.path.points[last]);
	const target = await onPage(centre(hoodNow.faces[9].map((v) => hoodNow.points[v])));
	let dragged = "";
	await oneStep(
		"a point dragged along the surface",
		async () => {
			await page.mouse.move(c1[0], c1[1]);
			await page.mouse.down();
			await page.mouse.move(target[0], target[1], { steps: 10 });
			await page.mouse.up();
		},
		async () => {
			const a = await shapeAt(curlAt);
			const b = await shapeAt(curlAt + 1);
			const gap = await off(a.path.points[last]);
			const moved = Math.hypot(...a.path.points[last].map((v, k) => v - curl.path.points[last][k]));
			const chosen = await ev(() => fastart.md.pipePt.value);
			dragged = ` point ${chosen} of ${last + 1}, moved ${moved.toFixed(2)}, ${gap.toFixed(3)} off the surface`;
			return chosen === last && moved > 0.5 && Math.abs(gap - 0.1) < 0.02 && b.path.points.every((p, i) => Math.abs(p[0] + a.path.points[i][0]) < 1e-6 && p[1] === a.path.points[i][1]);
		},
	);
	console.log(`     (${dragged.trim()})`);
	await shot("5d-curl-and-twin-on-the-hood");
	await page.emulateMedia({ colorScheme: "dark" });
	await wait(400);
	await shot("5d-dark");
	await page.emulateMedia({ colorScheme: "light" });
	await wait(300);
	await page.keyboard.press("Escape");
	await page.keyboard.press("Escape");
	await ev(() => fastart.model.flushNow());
	check("the cap with its pipes is a valid file", valid("cap.fart") === "", valid("cap.fart"));

	// ------------------------------------------------------------- 6. sidecars: the edited model, a scene, the mannequin, render
	// the model being edited draws from its live cage, and its sidecar is rebuilt after a checkpoint
	check("the cap's sidecar is stale now: the file has changed under it", !fresh("cap.fart"));
	await page.keyboard.press("Meta+s");
	check("⌘S: the sidecar is rebuilt behind the checkpoint, fresh again", await until(() => fresh("cap.fart")));
	check("and it is no part of what is saved: the model is not edited, the checkpoint is the .fart alone", (await ev(() => fastart.md.dirty.value === false)) && fs.existsSync(path.join(P, "cap.fart~")) && !fs.existsSync(path.join(P, "cap.fart~.glb")) && !fs.existsSync(path.join(P, "cap.fart.glb~")));
	check("the canvas of the model being edited still draws what core generates", (await ev(() => fastart.glStats.triangles)) === trianglesOf("cap.fart"), `${await ev(() => fastart.glStats.triangles)} against ${trianglesOf("cap.fart")}`);
	// an edit without a checkpoint: stale on disk
	await ev(() => fastart.model.setShapeNumber({ part: 0, shape: 1 }, "shade", 0.9));
	await ev(() => fastart.model.endGesture());
	await ev(() => fastart.model.flushNow());
	check("an edit makes it stale again", await until(() => !fresh("cap.fart")));
	// a wrong sidecar planted for the body: another model's triangles under the body's name
	fs.copyFileSync(sidecarOf("crate.fart"), sidecarOf("body.fart"));
	check("(a planted sidecar is not the body's: its hash is another file's)", !fresh("body.fart") && sidecarInfo(new Uint8Array(fs.readFileSync(sidecarOf("body.fart")))) !== null);
	await ev(() => (fastart.sidecar.sidecars.log.length = 0));
	await open("yard.shart");
	const log = await ev(() => fastart.sidecar.sidecars.log.map((l) => `${l.rel}:${l.how}`));
	check("the scene did not draw from the stale ones: both were built first", log.includes("cap.fart:built") && log.includes("body.fart:built"), log.join(" "));
	check("and both are fresh on disk now", fresh("cap.fart") && fresh("body.fart"));
	const want6 = trianglesOf("cap.fart") + trianglesOf("body.fart");
	check("the scene draws both models' true triangles, from their sidecars", (await ev(() => fastart.sc.compiled.value.size === 2 && fastart.glStats.triangles)) === want6, `${await ev(() => fastart.glStats.triangles)} against ${want6}`);
	await page.keyboard.press("Shift+1");
	await wait(300);
	await measure();
	// picking works on compiled triangles: a click on the man chooses his node
	{
		const at = await ev((box) => { const z = fastart.view.zoom.value; const p = fastart.view.pan.value; const [W, H] = fastart.view.size.value; return [box.x + (-6 - p[0]) * z + W / 2, box.y + (-1 - p[1]) * z + H / 2]; }, box0);
		await page.mouse.click(at[0], at[1]);
		await wait();
		check("a click on a placed model chooses its node", await ev(() => fastart.sc.sel.value === "man"), String(await ev(() => fastart.sc.sel.value)));
		const skin = await pixel([at[0], at[1] - 6]);
		check("the body wears its palette's skin", skin[0] > skin[2] + 30, skin.join(","));
		await shot("6a-scene-from-sidecars");
		// a recolour in the palette file: no byte of body.fart changes, so its sidecar stands, and the colour shows
		fs.writeFileSync(path.join(P, "skin.fart"), JSON.stringify({ version: 1, name: "skin", palette: [{ name: "skin", rgb: [60, 190, 90, 255] }] }, null, 2) + "\n");
		await ev(() => fastart.goBrowse());
		await wait(300);
		await ev(() => (fastart.sidecar.sidecars.log.length = 0));
		await open("yard.shart");
		await page.keyboard.press("Shift+1");
		await wait(400);
		const log2 = await ev(() => fastart.sidecar.sidecars.log.filter((l) => l.rel === "body.fart").map((l) => l.how));
		const green = await pixel([at[0], at[1] - 6]);
		check("a recolour shows without a rebuild: tokens are resolved through the palette", log2.length > 0 && log2.every((h) => h === "kept" || h === "read") && green[1] > green[0] + 30, `${log2.join(",")} · ${green.join(",")}`);
		await shot("6b-scene-recoloured-no-rebuild");
	}
	// the mannequin under the model being edited
	await open("cap.fart");
	await ev(() => (fastart.sidecar.sidecars.log.length = 0));
	await ev(() => fastart.model.chooseMannequin({ path: "body.fart" }));
	check("the mannequin is drawn from its sidecar", await until(() => ev(() => !!fastart.md.mannequin.value?.compiled)), await ev(() => fastart.sidecar.sidecars.log.map((l) => `${l.rel}:${l.how}`).join(" ")));
	await view3q();
	check("under the model's own live triangles", (await ev(() => fastart.glStats.triangles)) === trianglesOf("cap.fart") + trianglesOf("body.fart"), `${await ev(() => fastart.glStats.triangles)}`);
	await shot("6c-mannequin-from-sidecar");
	await ev(() => fastart.model.chooseMannequin(null));
	// the Ask panel's render of another file
	const rr = await call("render", { path: "helm.fart", views: ["front", "left", "top", "three-quarter"] });
	check("render of another file answers from its sidecar, a picture a view", !rr.isError && rr.images.length === 4 && rr.text.includes("from its compiled sidecar") && new Set(rr.images).size === 4, rr.text);
	if (shots) rr.images.forEach((d, i) => fs.writeFileSync(path.join(shots, `6d-render-other-${["front", "left", "top", "three-quarter"][i]}.png`), Buffer.from(d, "base64")));
	check("render of the open model is still the live one", !(await call("render", { view: "front" })).text.includes("sidecar"));
	check("render of a file that is not there is refused", (await call("render", { path: "nothing.fart" })).isError);
	check("still no sidecar among the files, and no second offer", (await ev(() => fastart.project.files.value.every((f) => !f.endsWith(".glb")))) && (await page.locator(".ur-sheet").count()) === 0);

	// ------------------------------------------------------------- 7. the Ask panel's tools
	await open("crate.fart");
	await ev(() => fastart.model.applyExternalDoc(JSON.parse(JSON.stringify({ ...fastart.md.doc.value, parts: [{ ...fastart.md.doc.value.parts[0], shapes: [{ kind: "mesh", color: "steel", points: [[0, -6, -3], [3, -6, -3], [3, -6, 3], [0, -6, 3], [0, 0, -3], [3, 0, -3], [3, 0, 3], [0, 0, 3]], faces: [[0, 1, 2, 3], [1, 0, 4, 5], [2, 1, 5, 6], [3, 2, 6, 7]] }, { kind: "mesh", color: "steel", points: [[0.5, -8, -5], [5, -8, -5], [5, -8, 5], [0.5, -8, 5], [0.5, -6.4, -5], [5, -6.4, -5], [5, -6.4, 5], [0.5, -6.4, 5]], faces: [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]] }] }] }))));
	await wait();
	const T = { part: "crate", shape: 0 };
	const tool = async (name, args, test, what) => {
		const before = await docNow();
		const r = await call(name, { ...T, ...args });
		let out = null;
		try {
			out = JSON.parse(r.text);
		} catch {
			// a refusal is words
		}
		const after = await docNow();
		const ok = !r.isError && after !== before && test(out, await shapeAt(0));
		await undo();
		const back = (await docNow()) === before;
		await redo();
		check(`${name}: ${what}, as one undo step`, ok && back && (await docNow()) === after && out?.undo === "one step", r.isError ? r.text : `${back ? "" : "one undo did not put it back · "}${JSON.stringify(out).slice(0, 200)}`);
		return out;
	};
	await tool("mesh_paint", { faces: [0], color: "brass" }, (o, sh) => JSON.stringify(sh.colors) === '["brass"]' && sh.paint[0] === 1 && o.now.facesByColour.brass === 1 && o.now.facesByColour.steel === 3, "paints a face");
	await tool("mesh_inset", { faces: [1], amount: 0.6, raise: 0.1, border: "lining" }, (o, sh) => sh.faces.length === 8 && JSON.stringify(sh.colors) === '["brass","lining"]' && sh.paint.slice(4).every((p) => p === 2) && sh.paint[1] === 0, "mesh_inset with a border colour paints the ring");
	await undo();
	await tool("mesh_modifiers", { mods: [{ op: "mirror", axis: "x" }, { op: "solidify", thick: 0.4, inner: "lining", rim: "brass" }] }, (o, sh) => sh.mods.length === 2 && JSON.stringify(sh.colors) === '["brass","lining"]' && sh.mods[1].inner === 2 && sh.mods[1].rim === 1, "sets the list, colours by name");
	await tool("mesh_shade", { strength: 0.7 }, (o, sh) => sh.shades?.length === sh.points.length && o.now.shaded === true, "shades the corners");
	const piped = await tool("pipe", { points: [[1, -5, -4], [2.5, -3, -4], [1, -1, -4]], radius: 0.25, radii: [0.6, 1, 0], on: { shape: 0, offset: 0.2 }, color: "brass", mirror: true }, (o) => o.shape === 2 && o.twin === 3, "draws a pipe on a shape's surface, with its twin");
	{
		const p = await shapeAt(2);
		const q = await shapeAt(3);
		const gaps7 = [];
		for (const pt of p.path.points) gaps7.push(await ev((pt) => { const z = fastart.model.landOnSurface(0, [pt], { part: 0, shape: 0 }, 0)[0]; return Math.hypot(z[0] - pt[0], z[1] - pt[1], z[2] - pt[2]); }, pt));
		check("its points sit 0.2 off the surface named, and the twin mirrors them", gaps7.every((g) => Math.abs(g - 0.2) < 0.02) && q.path.points.every((pt, i) => Math.abs(pt[0] + p.path.points[i][0]) < 1e-6) && JSON.stringify(p.radii) === "[0.6,1,0]" && p.color === "brass", `${gaps7.map((g) => g.toFixed(3)).join(",")} ${JSON.stringify(piped?.points)}`);
	}
	await tool("mesh_apply_modifier", { index: 0 }, (o, sh) => sh.mods.length === 1 && sh.mods[0].op === "solidify" && sh.points.length === 12 && sh.shades.length === 12 && sh.paint.filter((p) => p).length === 2, "applies the mirror: both halves are the mesh's own now");
	await tool("mesh_modifiers", { mods: [] }, (o, sh) => sh.mods === undefined && JSON.stringify(sh.colors) === '["brass"]', "clears the list (and the colours only the list named)");
	await tool("mesh_shade", { clear: true }, (o, sh) => sh.shades === undefined, "clears the shades");
	const snap = await docNow();
	const bad = [
		await call("mesh_paint", { ...T, faces: [99], color: "brass" }),
		await call("mesh_paint", { ...T, faces: [0], color: "mauve" }),
		await call("mesh_modifiers", { ...T, mods: [{ op: "bevel" }] }),
		await call("mesh_modifiers", { ...T, mods: [{ op: "solidify", thick: 0.2, inner: "mauve" }] }),
		await call("mesh_apply_modifier", { ...T, index: 3 }),
		await call("mesh_shade", { part: "crate", shape: 2 }),
		await call("pipe", { part: "crate", points: [[0, 0, 0]] }),
		await call("pipe", { part: "crate", points: [[0, 0, 0], [1, 1, 1]], closed: true }),
		await call("pipe", { part: "crate", points: [[0, 0, 0], [1, 1, 1]], on: { shape: 9 } }),
	];
	check("a wrong ask is refused with the reason, for each of them", bad.every((b) => b.isError && b.text.length > 12), bad.map((b) => `${b.isError ? "" : "NOT REFUSED "}${b.text.slice(0, 50)}`).join(" | "));
	check("and none of them changed the document", (await docNow()) === snap);
	const v = JSON.parse((await call("validate", {})).text);
	check("what the tools made validates", v.ok, JSON.stringify(v.errors));
	// build_sidecars: the open model is stale (edited), the rest fresh
	await ev(() => fastart.model.flushNow());
	check("(the crate's sidecar is stale after all that)", await until(() => !fresh("crate.fart")));
	const b1 = JSON.parse((await call("build_sidecars", { path: "crate.fart" })).text);
	check("build_sidecars for a path builds the stale one", b1.built === 1 && b1.files[0].did === "built" && fresh("crate.fart"), JSON.stringify(b1));
	const b2 = JSON.parse((await call("build_sidecars", {})).text);
	check("for the whole project: the fresh ones are left alone, a palette file is skipped", b2.built === 0 && b2.fresh === 7 && b2.skipped === 1 && b2.failed === 0 && models.every(fresh), JSON.stringify(b2).slice(0, 300));
	const b3 = JSON.parse((await call("build_sidecars", { path: "crate.fart", force: true })).text);
	check("force rebuilds a fresh one", b3.built === 1 && fresh("crate.fart"));
	check("a path with nothing under it is refused", (await call("build_sidecars", { path: "nowhere" })).isError);
	check("the offer was made once and not again", (await page.locator(".ur-sheet").count()) === 0 && (await ev(() => Object.keys(localStorage).filter((k) => k.startsWith("fastart.sidecarIgnore:")).length)) === 1);
	check("every file on disk is still valid", [...models, "skin.fart"].every((f) => valid(f) === ""), models.map((f) => valid(f)).filter(Boolean).join(" | "));
	await view3q();
	await shot("7-after-the-tools");
} finally {
	await browser.close();
	server.kill();
	await new Promise((r) => setTimeout(r, 300));
	fs.rmSync(P, { recursive: true, force: true });
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
