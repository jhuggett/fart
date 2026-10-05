// A helm, built in the studio with the studio's own operations and
// nothing else: the box tool, the keys and the inspector driven as a
// person would, and the Ask panel's tools called the way the relay
// calls them. A mirrored, solidified, subdivided hood with a face
// opening, a brow band painted another colour above a creased loop, a
// curl on its side and a crest along its crown drawn on the surface as
// pipes, a plume, shaded corners. It is saved, validated by core, its
// sidecar built, and looked at from four sides.
// `node studio/test/helm.mjs <dir>` writes helm.fart, helm-live.fart
// (the modifiers not yet applied) and the pictures there.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validate, sidecarFresh, flattenPart, parseDoc } from "../../packages/core/src/index.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const bin = [path.join(repo, "studio/bin/studio"), path.join(repo, "studio/bin/Uranus")].filter((b) => fs.existsSync(b)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const out = process.argv[2];
if (!bin || !out) {
	console.error(bin ? "say where the helm and its pictures go: node studio/test/helm.mjs <dir>" : "no studio binary: go build -o bin/studio . in studio/");
	process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
let fails = 0;
const check = (name, ok, extra = "") => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " · " + extra : ""}`);
	if (!ok) fails++;
};

const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-helm-"));
// what New 3D asset… leaves, with the helm's four colours
fs.writeFileSync(
	path.join(P, "helm.fart"),
	JSON.stringify({ version: 1, space: "3d", name: "helm", palette: [{ name: "steel", rgb: [150, 158, 172, 255] }, { name: "brass", rgb: [212, 170, 78, 255] }, { name: "lining", rgb: [92, 54, 46, 255] }, { name: "plume", rgb: [196, 52, 60, 255] }], parts: [{ name: "hood", pivot: [0, 0, 0], shapes: [] }] }, null, 2) + "\n",
);
fs.writeFileSync(path.join(P, "other.fart"), JSON.stringify({ version: 1, space: "3d", name: "other", palette: [{ name: "ink", rgb: [0, 0, 0, 255] }], parts: [{ name: "a", pivot: [0, 0, 0], shapes: [] }] }, null, 2) + "\n");

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
const steps = [];
try {
	const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
	page.on("pageerror", (e) => {
		console.log("pageerror:", e.message);
		fails++;
	});
	await page.goto("http://localhost:4747/");
	await page.waitForFunction(() => globalThis.fastart?.project.files.value.length > 0);
	await page.evaluate(() => fastart.openDoc("helm.fart"));
	await page.waitForFunction(() => fastart.md.path.value === "helm.fart");
	await page.waitForTimeout(500);
	const wait = (ms = 160) => page.waitForTimeout(ms);
	const ev = (fn, arg) => page.evaluate(fn, arg);
	const insp = page.locator(".inspector");
	const shot = (n) => page.screenshot({ path: path.join(out, n + ".png") });
	let box0 = await page.locator(".canvas-wrap canvas").last().boundingBox();
	const measure = async () => (box0 = await page.locator(".canvas-wrap canvas").last().boundingBox());
	/** a tool, as the relay calls it; a refusal stops the build with its words */
	const T = { part: "hood", shape: 0 };
	const tool = async (name, args = {}) => {
		const r = await ev(({ name, args }) => fastart.callTool(name, args), { name, args: { ...T, ...args } });
		const text = r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
		steps.push(`${name} ${JSON.stringify(args).slice(0, 110)}`);
		if (r.isError) throw new Error(`${name} was refused: ${text}`);
		return { text, images: r.content.filter((c) => c.type === "image").map((c) => c.data), json: (() => { try { return JSON.parse(text); } catch { return null; } })() };
	};
	const hood = () => ev(() => fastart.md.doc.value.parts[0].shapes[0]);
	const toPage = (x, y) => ev(({ x, y, box }) => { const z = fastart.view.zoom.value; const p = fastart.view.pan.value; const [W, H] = fastart.view.size.value; return [box.x + (x - p[0]) * z + W / 2, box.y + (y - p[1]) * z + H / 2]; }, { x, y, box: box0 });
	const mid = (sh, f) => sh.faces[f].reduce((s, v) => [s[0] + sh.points[v][0] / sh.faces[f].length, s[1] + sh.points[v][1] / sh.faces[f].length, s[2] + sh.points[v][2] / sh.faces[f].length], [0, 0, 0]);
	const facesWhere = async (test) => {
		const sh = await hood();
		return sh.faces.map((_, f) => f).filter((f) => test(mid(sh, f), sh.faces[f].map((v) => sh.points[v])));
	};
	/** an edge of the hood that runs along one axis between two values of it, at (about) a place on the other two */
	const edgeAlong = async (axis, lo, hi) => {
		const sh = await hood();
		for (const f of sh.faces) for (let k = 0; k < f.length; k++) {
			const a = f[k];
			const b = f[(k + 1) % f.length];
			const p = sh.points[a];
			const q = sh.points[b];
			const others = [0, 1, 2].filter((i) => i !== axis);
			if (others.every((i) => Math.abs(p[i] - q[i]) < 1e-6) && Math.abs(p[axis] - lo) < 1e-6 && Math.abs(q[axis] - hi) < 1e-6) return { edge: [a, b], at: (v) => (v - lo) / (hi - lo) };
		}
		throw new Error(`no edge along ${"xyz"[axis]} from ${lo} to ${hi}`);
	};
	const cut = async (axis, lo, hi, at) => {
		const e = await edgeAlong(axis, lo, hi);
		await tool("mesh_loop_cut", { edge: e.edge, at: e.at(at) });
	};
	const keys = async (...ks) => {
		for (const k of ks) /^-?[\d.]+$/.test(k) && k.length > 1 ? await page.keyboard.type(k) : await page.keyboard.press(k);
		await wait();
	};
	const setField = async (label, value, scope = insp) => {
		const f = scope.locator(".ur-prop", { has: page.locator(`label:text-is("${label}")`) }).locator("input").first();
		await f.fill(String(value));
		await f.press("Enter");
		await wait();
	};

	// ---- a box, with the box tool, in the front view: 6 wide, 6 tall, 6 deep, around the head
	const depth = page.locator(".ur-pathbar .ur-field[title^='How deep'] input");
	await depth.fill("6");
	await depth.press("Enter");
	await keys("1");
	await ev(() => { fastart.view.pan.value = [0, -6]; fastart.view.zoom.value = 40; });
	await wait(200);
	await keys("r");
	const a = await toPage(-3, -9);
	const b = await toPage(3, -3);
	await page.mouse.move(a[0], a[1]);
	await page.mouse.down();
	await page.mouse.move(b[0], b[1], { steps: 8 });
	await page.mouse.up();
	await wait();
	steps.push("R: a box dragged in the front view, depth 6");
	let sh = await hood();
	check("the box tool made the box", sh?.kind === "mesh" && sh.points.length === 8, JSON.stringify(sh?.points));
	await keys("v");
	// (a new solid takes the last colour of the palette: the hood is steel)
	await insp.locator('button[aria-label="Fill"]').first().click();
	await insp.locator(".model-fill-pop .ur-color", { hasText: "steel" }).first().click();
	await wait();
	steps.push("inspector: the hood's Fill set to steel");

	// ---- half of it: a loop at x = 0, the left half and the floor deleted
	await cut(0, -3, 3, 0);
	await tool("mesh_delete_faces", { faces: await facesWhere((m, pts) => m[0] < -1e-6 || pts.every((p) => Math.abs(p[1] + 3) < 1e-6)) });
	// ---- loops for the dome, the face opening and the brow band
	await cut(1, -9, -3, -7.4);
	await cut(1, -7.4, -3, -4.1);
	await cut(2, -3, 3, 0);
	await cut(0, 0, 3, 1.9);
	sh = await hood();
	check("the half hood: open below and along the seam, one rim", JSON.parse((await tool("mesh_info")).text).rims.length === 1, `${sh.points.length} corners, ${sh.faces.length} faces`);

	// ---- the modifiers: the other half, a wall with a lining and a brass rim, soft folds; two levels of smoothing
	await tool("mesh_modifiers", { mods: [{ op: "mirror", axis: "x" }, { op: "solidify", thick: 0.3, inner: "lining", rim: "brass" }, { op: "crease", angle: 50, value: 0.25 }] });
	await ev(() => fastart.model.selectShapes([{ part: 0, shape: 0 }]));
	await wait();
	await setField("Smooth", 2);
	steps.push("inspector: Smooth 2");
	await ev(() => fastart.model.setTurn([0.35, -0.65, 0]));
	await keys("Shift+1");
	await measure();
	await shot("build-1-cage-under-modifiers");

	// ---- the crown drawn in: its corners moved by key (G, an axis, an amount), the seam left on its plane
	const choose = async (test) => {
		await ev(() => fastart.model.setPick("corner"));
		const list = (await hood()).points.map((p, i) => (test(p) ? i : -1)).filter((i) => i >= 0);
		await ev((list) => fastart.model.chooseVerts(list), list);
		await wait();
		return list.length;
	};
	await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
	const top = (p) => Math.abs(p[1] + 9) < 1e-6;
	await choose((p) => top(p) && p[0] > 2.5);
	await keys("g", "x", "-1.4", "Enter");
	await choose((p) => top(p) && p[2] > 2.5);
	await keys("g", "z", "-1.5", "Enter");
	await choose((p) => top(p) && p[2] < -2.5);
	await keys("g", "z", "1.5", "Enter");
	await choose((p) => top(p) && Math.abs(p[0] - 1.9) < 1e-6);
	await keys("g", "x", "-0.7", "Enter");
	// the brim flared a little
	await choose((p) => Math.abs(p[1] + 3) < 1e-6 && p[0] > 2.5);
	await keys("g", "x", "0.5", "Enter");
	await choose((p) => Math.abs(p[1] + 3) < 1e-6 && p[2] > 2.5);
	await keys("g", "z", "0.4", "Enter");
	steps.push("G X / G Z with typed amounts on chosen corners: the crown drawn in, the brim flared");
	sh = await hood();
	check("the seam stayed on its plane: the mirror still welds it", sh.points.filter((p) => Math.abs(p[0]) < 1e-6).length >= 8 && sh.points.every((p) => p[0] > -1e-6));
	await ev(() => fastart.model.chooseVerts([]));

	// ---- the face opening: the front faces of the middle band, beside the seam
	await tool("mesh_delete_faces", { faces: await facesWhere((m, pts) => pts.every((p) => p[2] < -2.4) && m[1] > -7.4 && m[1] < -4.1 && m[0] < 1.9) });
	// ---- the brow band: the lowest band painted brass, the loop above it creased
	await tool("mesh_paint", { faces: await facesWhere((m) => m[1] > -4.1), color: "brass" });
	sh = await hood();
	const loop = [];
	for (const f of sh.faces) for (let k = 0; k < f.length; k++) {
		const p = f[k];
		const q = f[(k + 1) % f.length];
		if (Math.abs(sh.points[p][1] + 4.1) < 1e-6 && Math.abs(sh.points[q][1] + 4.1) < 1e-6 && !loop.some((e) => (e[0] === p && e[1] === q) || (e[0] === q && e[1] === p))) loop.push([p, q]);
	}
	await tool("mesh_crease", { edges: loop, value: 0.8 });
	// a trim round the opening by the tool made for it: an inset with a border colour would do the same on a closed face
	await shot("build-2-opening-band-crease");

	// ---- a curl on the side, on the surface, with its twin (the tool)
	const curl = [];
	for (let k = 0; k < 7; k++) {
		const ang = k * 1.15;
		const r = 1.35 - k * 0.17;
		curl.push([3.6, +(-6 - r * Math.sin(ang)).toFixed(3), +(0.9 + r * Math.cos(ang)).toFixed(3)]);
	}
	await tool("pipe", { points: curl, radius: 0.13, radii: [0.5, 0.8, 1, 1, 0.9, 0.7, 0.3], on: { shape: 0, offset: 0.05 }, color: "brass", mirror: true });

	// ---- a crest along the crown, by hand: the pipe tool, On surface, clicked in the top view
	await ev(() => fastart.model.selectShapes([{ part: 0, shape: 0 }]));
	await depth.fill("0.7");
	await depth.press("Enter");
	await keys("7");
	await keys("Shift+1");
	await measure();
	await keys("u");
	await page.locator(".ur-palette button[aria-label^='On surface']").click();
	if (await ev(() => fastart.md.pipeTwin.value)) await page.locator(".ur-palette button[aria-label^='Symmetry']").click();
	await wait();
	const before = await ev(() => fastart.md.doc.value.parts[0].shapes.length);
	// (the top view looks down on the helm: canvas x is the model's x, canvas y its −z or z by the view's turn; asked of the view)
	const along = [];
	for (const z of [-1.9, 0, 2.2]) along.push(await ev(({ z, box }) => { const fp = fastart.model.framePartOf(0); const F = fp.F; const p = [0, -9, z]; const x = F[0] * p[0] + F[1] * p[1] + F[2] * p[2] + F[9]; const y = F[3] * p[0] + F[4] * p[1] + F[5] * p[2] + F[10]; const zz = fastart.view.zoom.value; const pan = fastart.view.pan.value; const [W, H] = fastart.view.size.value; return [box.x + (x - pan[0]) * zz + W / 2, box.y + (y - pan[1]) * zz + H / 2]; }, { z, box: box0 }));
	for (const p of along) {
		await page.mouse.click(p[0], p[1]);
		await wait(80);
	}
	await shot("build-3-crest-being-clicked-top-view");
	await keys("Enter");
	const crestAt = before;
	let crest = await ev((i) => fastart.md.doc.value.parts[0].shapes[i], crestAt);
	check("the crest was drawn on the crown with the pipe tool", crest?.op === "pipe" && crest.path.points.length >= 3 && crest.path.points.every((p) => Math.abs(p[0]) < 0.05 && p[1] < -8), JSON.stringify(crest?.path?.points));
	steps.push(`U, On surface, three clicks in the top view, Return: a crest of ${crest?.path?.points.length} points`);
	// its colour, in the inspector
	await insp.locator('button[aria-label="Fill"]').first().click();
	await insp.locator(".model-fill-pop .ur-color", { hasText: "brass" }).first().click();
	await wait();
	steps.push("inspector: the crest's Fill set to brass");
	await keys("Escape", "Escape");
	await depth.fill("2");
	await depth.press("Enter");

	// ---- the plume: a pipe standing off the crown, tapering to a point
	await tool("pipe", { points: [[0, -9.5, 0.4], [0, -11.6, 0.2], [0, -12.4, 2.2], [0, -10.6, 4.6], [0, -8.2, 5.4]], radius: 0.55, radii: [0.5, 1, 1.1, 0.8, 0], color: "plume", segments: 8 });

	// ---- shaded, saved, validated: the modifiers still live
	const live = await tool("mesh_shade", { strength: 0.75 });
	await ev(() => fastart.model.setTurn([0.35, -0.65, 0]));
	await keys("Shift+1");
	await measure();
	await page.keyboard.press("Meta+s");
	await page.waitForFunction(() => !fastart.md.dirty.value);
	await wait(600);
	fs.copyFileSync(path.join(P, "helm.fart"), path.join(out, "helm-live.fart"));
	const liveDoc = JSON.parse(fs.readFileSync(path.join(out, "helm-live.fart"), "utf8"));
	check("the helm with its modifiers live is a valid file", validate(liveDoc).ok, JSON.stringify(validate(liveDoc).errors));
	await shot("build-4-live-modifiers-shaded");
	const liveViews = await tool("render", { views: ["front", "right", "back", "three-quarter"], size: 512 });
	liveViews.images.forEach((d, i) => fs.writeFileSync(path.join(out, `live-${["front", "right", "back", "three-quarter"][i]}.png`), Buffer.from(d, "base64")));

	// ---- applied, and shaded again: now the inside has corners of its own to be dark
	await tool("mesh_apply_modifier", {});
	const done = await tool("mesh_shade", { strength: 0.75 });
	await page.keyboard.press("Meta+s");
	await page.waitForFunction(() => !fastart.md.dirty.value);
	const built = await tool("build_sidecars", { path: "helm.fart" });
	fs.copyFileSync(path.join(P, "helm.fart"), path.join(out, "helm.fart"));
	fs.copyFileSync(path.join(P, "helm.fart.glb"), path.join(out, "helm.fart.glb"));
	const doc = JSON.parse(fs.readFileSync(path.join(out, "helm.fart"), "utf8"));
	const v = validate(doc);
	check("the helm is a valid file", v.ok, JSON.stringify(v.errors));
	check("its sidecar is built and fresh", sidecarFresh(new Uint8Array(fs.readFileSync(path.join(out, "helm.fart.glb"))), new Uint8Array(fs.readFileSync(path.join(out, "helm.fart")))), built.text.slice(0, 200));
	const info = JSON.parse((await tool("mesh_info")).text);
	check("the applied hood is one closed, outward, manifold solid", info.manifold && info.closed && info.windsOutward, JSON.stringify(info).slice(0, 200));

	// ---- looked at: the canvas (plain and clay), the tool's four views, and from its sidecar with another file open
	for (const [name, turn] of [["front", [0, 0, 0]], ["right", null], ["back", null], ["three-quarter", [0.35, -0.65, 0]], ["below", [-0.95, 0.5, 0]]]) {
		if (turn) await ev((t) => fastart.model.setTurn(t), turn);
		else await ev((n) => fastart.model.setView(n), name);
		await keys("Escape", "Escape", "Shift+1");
		await shot(`helm-canvas-${name}`);
	}
	await ev(() => fastart.workspace.setShading("clay"));
	await ev(() => fastart.model.setTurn([0.35, -0.65, 0]));
	await keys("Shift+1");
	await shot("helm-canvas-clay");
	await ev(() => fastart.workspace.setShading("plain"));
	const views = ["front", "right", "back", "three-quarter"];
	const rr = await tool("render", { views, size: 512 });
	rr.images.forEach((d, i) => fs.writeFileSync(path.join(out, `helm-${views[i]}.png`), Buffer.from(d, "base64")));
	await ev(() => fastart.openDoc("other.fart"));
	await page.waitForFunction(() => fastart.md.path.value === "other.fart");
	const sc = await ev(() => fastart.callTool("render", { path: "helm.fart", views: ["front", "right", "back", "three-quarter"], size: 512 }));
	sc.content.filter((c) => c.type === "image").forEach((c, i) => fs.writeFileSync(path.join(out, `helm-sidecar-${views[i]}.png`), Buffer.from(c.data, "base64")));
	check("and renders from its sidecar with another file open", !sc.isError && sc.content.filter((c) => c.type === "image").length === 4, sc.content.find((c) => c.type === "text")?.text);

	// ---- what it is
	const d3 = parseDoc(fs.readFileSync(path.join(out, "helm.fart"), "utf8")).doc;
	let tris = 0;
	for (const part of d3.parts) for (const tm of flattenPart(d3, part)) tris += tm.count;
	const liveHood = liveDoc.parts[0].shapes[0];
	const hoodNow = doc.parts[0].shapes[0];
	console.log(`\nthe helm: ${doc.parts[0].shapes.length} shapes (${doc.parts[0].shapes.map((s) => (s.kind === "sweep" ? s.op : s.kind)).join(", ")}), ${tris} triangles drawn`);
	console.log(`  live: a cage of ${liveHood.points.length} corners and ${liveHood.faces.length} faces under ${liveHood.mods.map((m) => m.op).join(" + ")}, smooth ${liveHood.smooth}; shades ${live.json.done}`);
	console.log(`  applied: ${hoodNow.points.length} corners, ${hoodNow.faces.length} faces; ${done.json.done}`);
	console.log(`  files: helm.fart ${(fs.statSync(path.join(out, "helm.fart")).size / 1024).toFixed(1)} KB, helm-live.fart ${(fs.statSync(path.join(out, "helm-live.fart")).size / 1024).toFixed(1)} KB, helm.fart.glb ${(fs.statSync(path.join(out, "helm.fart.glb")).size / 1024).toFixed(1)} KB`);
	console.log(`  ${steps.length} steps:\n    ${steps.join("\n    ")}`);
} finally {
	await browser.close();
	server.kill();
	await new Promise((r) => setTimeout(r, 300));
	fs.rmSync(P, { recursive: true, force: true });
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
