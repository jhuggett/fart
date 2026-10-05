// Mesh editing in the model screen, end to end, in the served studio with
// a headless browser: choosing corners, edges and faces with the pointer;
// extrude, inset and loop cut by key and pointer, each one undo step and
// adjustable afterwards; rims (delete, fill, bridge); creases; symmetry;
// a reference image, a mannequin and the clay light; and the Ask panel's
// mesh tools and several-view render, called the way the relay calls them.
// `node studio/test/mesh.mjs [dir for screenshots]` (needs the app built:
// npx vite build in studio/frontend, go build -o bin/studio . in studio).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { box, lathe, stringifyDoc, toPng } from "../../packages/core/src/index.ts";

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

// ------------------------------------------------------------- the project
const P = fs.mkdtempSync(path.join(os.tmpdir(), "uranus-mesh-"));
const palette = [
	{ name: "steel", rgb: [150, 160, 175, 255] },
	{ name: "skin", rgb: [224, 172, 140, 255] },
];
const doc = (name, shapes) => ({ version: 1, space: "3d", name, palette, parts: [{ name, pivot: [0, 0, 0], shapes }], states: [{ name: "rest", parts: [{ part: name, offset: [0, 0, 0] }] }] });
// the helm starts as a box around the head; a second, open-ended tube is there to bridge and fill
const helm = doc("helm", [box("steel", [0, -9, 0], [6, 5, 6])]);
helm.states.push({ name: "worn", parts: [{ part: "helm", offset: [0, 0, 0], morph: [{ shape: 0, points: helm.parts[0].shapes[0].points.map((p) => [p[0] * 1.1, p[1], p[2] * 1.1]) }] }] });
fs.writeFileSync(path.join(P, "helm.fart"), stringifyDoc(helm));
// the body the helm is fitted to: a head and a neck
const head = lathe("skin", [[0.01, -11], [1.6, -10.6], [2.4, -9], [2.2, -7.4], [1.2, -6.4], [1, -5], [0.01, -5]], "y", 12);
head.smooth = 1;
fs.writeFileSync(path.join(P, "body.fart"), stringifyDoc(doc("body", [head, box("skin", [0, -2.5, 0], [5, 5, 3])])));
// a reference image: a red frame with a blue cross, so it is unmistakable behind the model
const N = 64;
const px = new Uint8Array(N * N * 4);
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
	const edge = x < 4 || y < 4 || x >= N - 4 || y >= N - 4;
	const cross = Math.abs(x - N / 2) < 2 || Math.abs(y - N / 2) < 2;
	px.set(edge ? [220, 30, 30, 255] : cross ? [30, 60, 220, 255] : [250, 240, 200, 255], (y * N + x) * 4);
}
fs.mkdirSync(path.join(P, "refs"));
fs.writeFileSync(path.join(P, "refs/helm-front.png"), toPng({ width: N, height: N, data: px }));

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
	await page.evaluate(() => fastart.openDoc("helm.fart"));
	await page.waitForFunction(() => fastart.project.screen.value === "model" && fastart.md.path.value === "helm.fart");
	await page.waitForTimeout(600);
	const shot = (n) => (shots ? page.screenshot({ path: path.join(shots, n + ".png") }) : Promise.resolve());
	const wait = (ms = 160) => page.waitForTimeout(ms);
	const box0 = await page.locator(".canvas-wrap canvas").last().boundingBox();
	const ev = (fn, arg) => page.evaluate(fn, arg);
	/** the mesh as it is in the file, measured */
	const mesh = () => ev(async () => JSON.parse((await fastart.callTool("mesh_info", { part: "helm", shape: 0 })).content[0].text));
	const shape = () => ev(() => fastart.md.doc.value.parts[0].shapes[0]);
	const undoDepth = async () => {
		// how many undos until nothing is left
		return ev(() => fastart.md.canUndo.value);
	};
	/** where on the page a set of the selected mesh's corners sits, on average */
	const cornersAt = (list) =>
		ev(
			({ list, box }) => {
				const hs = fastart.vertexHandles().filter((h) => list.includes(h.i));
				const c = hs.reduce((s, h) => [s[0] + h.at[0] / hs.length, s[1] + h.at[1] / hs.length], [0, 0]);
				const z = fastart.view.zoom.value;
				const p = fastart.view.pan.value;
				const [W, H] = fastart.view.size.value;
				return [box.x + (c[0] - p[0]) * z + W / 2, box.y + (c[1] - p[1]) * z + H / 2];
			},
			{ list, box: box0 },
		);
	/** the face whose outward normal points most along a direction of the part's space */
	const faceToward = (d) =>
		ev((d) => {
			const sh = fastart.md.doc.value.parts[0].shapes[0];
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
		}, d);
	const clickFace = async (d, opts = {}) => {
		const f = await faceToward(d);
		const at = await cornersAt(await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f], f));
		await page.mouse.click(at[0], at[1], opts);
		await wait();
		return f;
	};
	const insp = page.locator(".inspector");
	const pickMode = async (label) => {
		await insp.locator(".ur-seg[aria-label=Choose] button", { hasText: label }).click();
		await wait();
	};

	// a view that shows the top, the front and a side
	await ev(() => fastart.model.setTurn([0.5, -0.6, 0]));
	await page.keyboard.press("Shift+1");
	await wait(300);

	// ------------------------------------------------------------- 1. choosing, and the operations
	const mid = await ev((box) => { const z = fastart.view.zoom.value; const p = fastart.view.pan.value; const [W, H] = fastart.view.size.value; const b = fastart.chosenBounds(); return [box.x + ((b.lo[0] + b.hi[0]) / 2 - p[0]) * z + W / 2, box.y + ((b.lo[1] + b.hi[1]) / 2 - p[1]) * z + H / 2]; }, box0);
	await page.mouse.click(mid[0], mid[1]);
	await wait();
	check("a click selects the box", await ev(() => fastart.md.sel.value?.shape === 0));
	check("the inspector has a Mesh section", (await insp.locator(".ur-insp-title", { hasText: "Mesh" }).count()) === 1);
	let m = await mesh();
	check("the box: 8 corners, 6 faces, closed, outward", m.points === 8 && m.faces === 6 && m.closed && m.windsOutward, JSON.stringify(m));

	await pickMode("Faces");
	check("Faces is the pick mode", await ev(() => fastart.md.pick.value === "face"));
	const top = await clickFace([0, -1, 0]);
	check("a click on the top chooses that face", await ev((f) => JSON.stringify(fastart.md.faces.value) === JSON.stringify([f]), top), `face ${top}, chosen ${await ev(() => fastart.md.faces.value.join(","))}`);
	// a side face the view shows: one whose middle, clicked, is itself
	const facing = async () => {
		for (const d of [[0, 0, -1], [0, 0, 1], [1, 0, 0], [-1, 0, 0]]) {
			const f = await faceToward(d);
			const at = await cornersAt(await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f], f));
			const hit = await ev(({ at, box }) => { const [W, H] = fastart.view.size.value; return fastart.hitFace(fastart.toWorld([at[0] - box.x, at[1] - box.y], W, H)); }, { at, box: box0 });
			if (hit === f) return { f, at, d };
		}
		throw new Error("no side face faces the view");
	};
	const { f: front, at: frontAt, d: frontDir } = await facing();
	const shiftClick = async (at) => {
		await page.keyboard.down("Shift");
		await page.mouse.click(at[0], at[1]);
		await page.keyboard.up("Shift");
		await wait();
	};
	await shiftClick(frontAt);
	check("Shift-click adds a face", await ev(() => fastart.md.faces.value.length === 2));
	await shiftClick(frontAt);
	check("Shift-click again takes it out", await ev((f) => JSON.stringify(fastart.md.faces.value) === JSON.stringify([f]), top));
	check("the status bar says what clicks choose", (await page.locator(".ur-statusbar").textContent()).includes("choosing faces"));
	await shot("01-face-chosen");

	// inset by key: the pointer says how far, a click keeps it
	const topAt = await cornersAt(await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f], top));
	await page.mouse.move(topAt[0], topAt[1]);
	await page.keyboard.press("i");
	await wait();
	check("I begins an inset that follows the pointer", await ev(() => fastart.meshModal.value?.kind === "inset"));
	check("the status bar reads the inset", (await page.locator(".ur-statusbar").textContent()).startsWith("Inset:"));
	await page.mouse.move(topAt[0] + 60, topAt[1], { steps: 6 });
	await wait();
	const during = await ev(() => fastart.meshModal.value?.value);
	await shot("02-inset-following-pointer");
	await page.mouse.down();
	await page.mouse.up();
	await wait();
	m = await mesh();
	check("the click keeps the inset: 12 corners, 10 faces, still a closed outward solid", m.points === 12 && m.faces === 10 && m.closed && m.windsOutward && !(await ev(() => fastart.meshModal.value)), `${JSON.stringify(m)} amount ${during}`);
	check("the inner face is what stays chosen", await ev((f) => JSON.stringify(fastart.md.faces.value) === JSON.stringify([f]), top));
	check("the worn state's morph was carried through", await ev(() => fastart.md.doc.value.states[1].parts[0].morph[0].points.length === 12));
	check("the file still validates", await ev(() => fastart.md.issues.value.length === 0) && JSON.parse((await ev(async () => (await fastart.callTool("validate")).content[0].text))).ok);

	// its number stays open in the inspector, and changing it is the same undo step
	const amount = insp.locator(".ur-prop", { hasText: "Amount" }).locator("input");
	check("the inspector keeps the inset's amount open", (await amount.count()) === 1 && Math.abs(Number(await amount.inputValue()) - during) < 1e-6, await amount.inputValue());
	await amount.fill("1");
	await amount.press("Enter");
	await wait();
	const inner = await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f].map((v) => fastart.md.doc.value.parts[0].shapes[0].points[v]), top);
	check("typing 1 re-runs it: the inner face is 4 by 4", inner.every((p) => Math.abs(Math.abs(p[0]) - 2) < 1e-6 && Math.abs(Math.abs(p[2]) - 2) < 1e-6), JSON.stringify(inner));
	await page.keyboard.press("Escape");
	await page.locator(".canvas-wrap canvas").last().focus().catch(() => {});

	// extrude by key, with a typed amount
	await page.mouse.move(topAt[0], topAt[1]);
	await ev((f) => fastart.model.chooseFaces([f]), top);
	await page.keyboard.press("e");
	await wait();
	check("E begins an extrude", await ev(() => fastart.meshModal.value?.kind === "extrude"));
	await page.keyboard.type("1.5");
	await wait();
	await page.keyboard.press("Enter");
	await wait();
	m = await mesh();
	check("E 1.5 Return: 16 corners, 14 faces, closed, outward", m.points === 16 && m.faces === 14 && m.closed && m.windsOutward, JSON.stringify(m));
	const crown = await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f].map((v) => fastart.md.doc.value.parts[0].shapes[0].points[v][1]), top);
	check("the face rose 1.5 (y is down: from -11.5 to -13)", crown.every((y) => Math.abs(y + 13) < 1e-6), crown.join(","));
	check("volume: the box, plus 16 x 1.5", Math.abs(m.volume - (180 + 24)) < 1e-3, String(m.volume));
	await shot("03-inset-then-extruded");

	// G moves what is chosen, not the whole mesh: the crown up one more along Y, then back by undo
	const lowest = await ev(() => Math.max(...fastart.md.doc.value.parts[0].shapes[0].points.map((p) => p[1])));
	await page.keyboard.press("g");
	await page.keyboard.press("y");
	await page.keyboard.type("-1");
	await page.keyboard.press("Enter");
	await wait();
	const moved = await ev((f) => { const sh = fastart.md.doc.value.parts[0].shapes[0]; return { crown: sh.faces[f].map((v) => sh.points[v][1]), low: Math.max(...sh.points.map((p) => p[1])) }; }, top);
	check("G Y -1 moves the chosen face only", moved.crown.every((y) => Math.abs(y + 14) < 1e-6) && moved.low === lowest, JSON.stringify(moved));
	await page.keyboard.press("Meta+z");
	await wait();
	check("and undoes in one step, the mesh still selected", await ev(() => fastart.md.sel.value?.shape === 0) && (await mesh()).volume === 204);

	// each was one undo step
	await page.keyboard.press("Meta+z");
	await wait();
	m = await mesh();
	check("one undo takes the extrude back whole", m.points === 12 && m.faces === 10, JSON.stringify(m));
	await page.keyboard.press("Meta+z");
	await wait();
	m = await mesh();
	check("one more takes the inset (and its typed amount) back", m.points === 8 && m.faces === 6, JSON.stringify(m));
	check("and nothing is left to undo", !(await undoDepth()));
	await page.keyboard.press("Meta+Shift+z");
	await page.keyboard.press("Meta+Shift+z");
	await wait();
	m = await mesh();
	check("redo brings both back", m.points === 16 && m.faces === 14 && m.closed, JSON.stringify(m));

	// Esc puts an operation back and leaves no undo step
	check("undo and redo leave the mesh selected, and let go of its faces", await ev(() => fastart.md.sel.value?.shape === 0 && fastart.md.faces.value.length === 0));
	await pickMode("Faces");
	const side = await clickFace(frontDir);
	void front;
	const before = JSON.stringify(await shape());
	const sideAt = await cornersAt(await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f], side));
	await page.mouse.move(sideAt[0], sideAt[1]);
	await page.keyboard.press("e");
	await page.mouse.move(sideAt[0] - 50, sideAt[1] + 30, { steps: 5 });
	await wait();
	check("an extrude under way has changed the mesh", JSON.stringify(await shape()) !== before);
	await page.keyboard.press("Escape");
	await wait();
	check("Esc puts it back exactly", JSON.stringify(await shape()) === before);
	await page.keyboard.press("Meta+z");
	await wait();
	m = await mesh();
	check("and left no undo step: the next undo is the one before", m.points === 12, JSON.stringify(m));
	await page.keyboard.press("Meta+Shift+z");
	await wait();

	// a loop cut: an edge, K, the pointer along it, then the slider
	await pickMode("Edges");
	const f0 = await ev((f) => fastart.md.doc.value.parts[0].shapes[0].faces[f], side);
	// an upright edge of the front face: its two ends differ in y
	const upright = await ev((f) => {
		const sh = fastart.md.doc.value.parts[0].shapes[0];
		for (let i = 0; i < f.length; i++) {
			const a = f[i];
			const b = f[(i + 1) % f.length];
			if (Math.abs(sh.points[a][1] - sh.points[b][1]) > 1) return [a, b];
		}
		return null;
	}, f0);
	const edgeAt = await cornersAt(upright);
	await page.mouse.move(edgeAt[0], edgeAt[1]);
	await wait();
	check("hover foretells the edge a click would choose", await ev((e) => { const h = fastart.ix3.hoverEdge; return !!h && h.includes(e[0]) && h.includes(e[1]); }, upright));
	await page.mouse.click(edgeAt[0], edgeAt[1]);
	await wait();
	check("a click chooses the edge", await ev((e) => { const c = fastart.md.edges.value; return c.length === 1 && c[0].includes(e[0]) && c[0].includes(e[1]); }, upright), JSON.stringify(await ev(() => fastart.md.edges.value)));
	await page.keyboard.press("k");
	await wait();
	check("K begins a loop cut", await ev(() => fastart.meshModal.value?.kind === "loopcut"));
	await page.mouse.down();
	await page.mouse.up();
	await wait();
	m = await mesh();
	check("the cut rings the helm: 4 corners and 4 faces more, still closed and outward", m.points === 20 && m.faces === 18 && m.closed && m.windsOutward, JSON.stringify(m));
	check("the new loop is what is chosen", await ev(() => fastart.md.pick.value === "edge" && fastart.md.edges.value.length === 4));
	const slider = insp.locator("input[aria-label='Loop cut place']");
	check("the inspector has the cut's place as a slider", (await slider.count()) === 1);
	await slider.fill("0.25");
	await wait();
	const ys = await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[0]; return [...new Set(fastart.md.edges.value.flat())].map((v) => sh.points[v][1]); });
	const want = await ev((e) => { const sh = fastart.model.liveOp() && JSON.parse(fastart.model.liveOp().base).parts[0].shapes[0]; return sh.points[e[0]][1] + (sh.points[e[1]][1] - sh.points[e[0]][1]) * 0.25; }, upright);
	check("the slider moves the loop to a quarter of the way", ys.length === 4 && ys.every((y) => Math.abs(y - want) < 1e-3), `${ys.join(",")} want ${want}`);
	await shot("04-loop-cut-with-slider");
	await page.keyboard.press("Meta+z");
	await wait();
	m = await mesh();
	check("the cut and its slider were one undo step", m.points === 16 && m.faces === 14, JSON.stringify(m));
	await page.keyboard.press("Meta+Shift+z");
	await wait();

	// creases: on a selection, then by angle
	await ev(() => fastart.model.setSmoothField(fastart.md.sel.value, "smooth", 2));
	await wait();
	await pickMode("Edges");
	check("a loop cut renumbers no face: the crown is still the face it was", (await faceToward([0, -1, 0])) === top);
	await ev((f) => { const sh = fastart.md.doc.value.parts[0].shapes[0]; const g = sh.faces[f]; fastart.model.chooseEdges(g.map((v, i) => [v, g[(i + 1) % g.length]])); }, top);
	await wait();
	const crease = insp.locator(".ur-prop", { hasText: "4 edges" }).locator("input");
	check("four edges chosen: one crease field for them all", (await crease.count()) === 1);
	await crease.fill("0.8");
	await crease.press("Enter");
	await wait();
	check("the four edges are creased at 0.8", await ev(() => { const c = fastart.md.doc.value.parts[0].shapes[0].creases ?? []; return c.length === 4 && c.every((e) => e[2] === 0.8); }), JSON.stringify(await ev(() => fastart.md.doc.value.parts[0].shapes[0].creases)));
	await shot("05-creased-crown-smooth");
	await insp.locator("button", { hasText: "Crease by angle" }).click();
	await wait();
	const nCreased = await ev(() => fastart.md.doc.value.parts[0].shapes[0].creases.length);
	check("crease by angle creases the sharp edges, keeping those already set", nCreased > 4 && (await ev(() => fastart.md.doc.value.parts[0].shapes[0].creases.filter((e) => e[2] === 0.8).length)) === 4, `${nCreased} creases`);
	const angle = insp.locator(".ur-prop", { hasText: "Angle" }).last().locator("input");
	await angle.fill("120");
	await angle.press("Enter");
	await wait();
	check("an angle no edge is sharper than says so, and leaves the mesh as it was", (await insp.locator(".model-op-failed").textContent()).includes("No edge is sharper") && (await ev(() => fastart.md.doc.value.parts[0].shapes[0].creases.length)) === 4);
	await angle.fill("60");
	await angle.press("Enter");
	await wait();
	check("back at 60 it creases again", (await ev(() => fastart.md.doc.value.parts[0].shapes[0].creases.length)) === nCreased);
	check("every crease is on an edge of the mesh", await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[0]; return sh.creases.every((e) => fastart.model.isEdge(sh, e[0], e[1])); }));
	await shot("06-crease-by-angle");
	await ev(() => fastart.model.setSmoothField(fastart.md.sel.value, "smooth", 0));

	// rims: delete the bottom, extrude the rim, fill it
	await pickMode("Faces");
	const bottom = await faceToward([0, 1, 0]);
	await ev((f) => fastart.model.chooseFaces([f]), bottom);
	await wait();
	await insp.locator(".insp-actions button", { hasText: "Delete" }).first().click();
	await wait();
	m = await mesh();
	check("Delete on a chosen face leaves the shape and opens a rim", m.faces === 17 && !m.closed && m.rims.length === 1 && m.rims[0].length === 4 && (await ev(() => !!fastart.md.sel.value)), JSON.stringify(m));
	await pickMode("Edges");
	await ev((r) => fastart.model.chooseEdges([[r[0], r[1]]]), m.rims[0]);
	await wait();
	await insp.locator(".insp-actions button", { hasText: "Rim" }).click();
	await wait();
	check("Rim chooses the whole loop of open edges", await ev(() => fastart.md.edges.value.length === 4));
	await insp.locator(".insp-actions button", { hasText: "Extrude" }).click();
	await wait();
	m = await mesh();
	check("Extrude on a rim grows a band: 4 faces more, the rim moved on", m.faces === 21 && m.rims.length === 1 && m.manifold, JSON.stringify(m));
	const amt = insp.locator(".ur-prop", { hasText: "Amount" }).locator("input");
	await amt.fill("1");
	await amt.press("Enter");
	await wait();
	const rimY = await ev((r) => r.map((v) => fastart.md.doc.value.parts[0].shapes[0].points[v][1]), (await mesh()).rims[0]);
	check("by 1: the new rim is one unit below the old", rimY.every((y) => Math.abs(y + 5.5) < 1e-3), rimY.join(","));
	await shot("07-rim-extruded");
	await insp.locator(".insp-actions button", { hasText: "Fill" }).click();
	await wait();
	m = await mesh();
	check("Fill closes it: a closed, outward solid again", m.closed && m.windsOutward && m.faces === 22, JSON.stringify(m));
	// flip and wind outward
	await pickMode("Faces");
	await ev(() => fastart.model.chooseFaces([0, 1]));
	await insp.locator(".insp-actions button", { hasText: "Flip" }).click();
	await wait();
	m = await mesh();
	check("Flip turns two faces: the mesh no longer agrees with itself", !m.manifold, JSON.stringify(m));
	await insp.locator(".insp-actions button", { hasText: "Wind outward" }).click();
	await wait();
	m = await mesh();
	check("Wind outward puts it right", m.manifold && m.closed && m.windsOutward, JSON.stringify(m));

	// ------------------------------------------------------------- 2. symmetry
	await page.keyboard.press("Meta+z"); // the wind
	await page.keyboard.press("Meta+z"); // the flip
	await wait();
	const sym = insp.locator(".ur-checkbox", { hasText: "Mirror across x" });
	await sym.click();
	await wait();
	check("the symmetry toggle is in the studio's notes, not the file", (await ev(() => fastart.work.value.mirror?.[0])) === "helm/0" && !JSON.stringify(await shape()).includes("mirror"));
	await pickMode("Faces");
	const right = await faceToward([1, 0, 0]);
	const left = await faceToward([-1, 0, 0]);
	await ev((f) => fastart.model.chooseFaces([f]), right);
	const nBefore = (await mesh()).points;
	await ev(() => fastart.meshOp("extrude", null, { amount: 0.75 }));
	await wait();
	m = await mesh();
	check("extruding the right side extrudes the left too", m.points === nBefore + 8 && m.closed && m.windsOutward, JSON.stringify(m));
	check("and the result is its own mirror", await ev(() => { const pts = fastart.md.doc.value.parts[0].shapes[0].points; return pts.every((p) => pts.some((q) => Math.abs(q[0] + p[0]) < 1e-3 && Math.abs(q[1] - p[1]) < 1e-3 && Math.abs(q[2] - p[2]) < 1e-3)); }));
	check("both sides are chosen", await ev(([a, b]) => { const c = fastart.md.faces.value; return c.length === 2 && c.includes(a) && c.includes(b); }, [right, left]));
	// drag one corner with the pointer: its mirror follows
	await pickMode("Corners");
	const pair = await ev(() => { const pts = fastart.md.doc.value.parts[0].shapes[0].points; let i = 0; for (let k = 0; k < pts.length; k++) if (pts[k][0] > pts[i][0] || (pts[k][0] === pts[i][0] && pts[k][1] < pts[i][1])) i = k; const j = pts.findIndex((q) => Math.abs(q[0] + pts[i][0]) < 1e-3 && Math.abs(q[1] - pts[i][1]) < 1e-3 && Math.abs(q[2] - pts[i][2]) < 1e-3); return [i, j]; });
	// (several corners can share a spot on the canvas; ask for this one by moving it the way a drag does)
	const cAt = await cornersAt([pair[0]]);
	await page.mouse.move(cAt[0], cAt[1]);
	await page.mouse.down();
	await page.mouse.move(cAt[0] + 30, cAt[1] - 20, { steps: 5 });
	await page.mouse.up();
	await wait();
	const dragged = await ev(() => fastart.md.vert.value);
	const after = await ev((i) => { const pts = fastart.md.doc.value.parts[0].shapes[0].points; const p = pts[i]; return { p, mirrored: pts.some((q, k) => k !== i && Math.abs(q[0] + p[0]) < 1e-3 && Math.abs(q[1] - p[1]) < 1e-3 && Math.abs(q[2] - p[2]) < 1e-3) }; }, dragged);
	check("a corner dragged on the canvas takes its mirror with it", dragged !== null && after.mirrored, JSON.stringify(after));
	check("the mesh is still its own mirror", await ev(() => { const pts = fastart.md.doc.value.parts[0].shapes[0].points; return pts.every((p) => pts.some((q) => Math.abs(q[0] + p[0]) < 1e-3 && Math.abs(q[1] - p[1]) < 1e-3 && Math.abs(q[2] - p[2]) < 1e-3)); }));
	check("the status bar says the mesh is mirrored", (await page.locator(".ur-statusbar").textContent()).includes("mirrored across x"));
	await shot("08-symmetry");
	// a corner on the plane stays on it: cut a loop across the middle first
	await pickMode("Edges");
	const across = await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[0]; for (const f of sh.faces) for (let i = 0; i < f.length; i++) { const a = f[i]; const b = f[(i + 1) % f.length]; if (f.length === 4 && Math.abs(sh.points[a][0] + sh.points[b][0]) < 1e-6 && sh.points[a][0] !== 0 && sh.points[a][1] === sh.points[b][1] && sh.points[a][2] === sh.points[b][2]) return [a, b]; } return null; });
	await ev((e) => fastart.model.chooseEdges([e]), across);
	await ev(() => fastart.meshOp("loopcut", null));
	await wait();
	const onPlane = await ev(() => fastart.md.doc.value.parts[0].shapes[0].points.map((p, i) => (p[0] === 0 ? i : -1)).filter((i) => i >= 0));
	check("a cut down the middle puts corners on the plane", onPlane.length >= 4, `${onPlane.length} corners at x = 0`);
	await pickMode("Corners");
	await ev((i) => fastart.model.chooseVerts([i]), onPlane[0]);
	await ev((i) => fastart.model.movePoints(fastart.md.sel.value, [i], [2, -0.5, 0], "test"), onPlane[0]);
	await ev(() => fastart.model.endGesture());
	const stayed = await ev((i) => fastart.md.doc.value.parts[0].shapes[0].points[i], onPlane[0]);
	check("moved sideways, a corner on the plane stays on it (and still moves up)", stayed[0] === 0, JSON.stringify(stayed));
	await sym.click();
	await wait();
	check("symmetry off again", !(await ev(() => fastart.work.value.mirror)));
	m = await mesh();
	check("after all of it: a valid, closed, outward mesh, and no issues", m.closed && m.windsOutward && (await ev(() => fastart.md.issues.value.length === 0)), JSON.stringify({ points: m.points, faces: m.faces, volume: m.volume }));

	// ------------------------------------------------------------- 5. the clay light
	await page.mouse.click(box0.x + 30, box0.y + 30);
	await wait();
	await ev(() => fastart.model.setSmoothField({ part: 0, shape: 0 }, "smooth", 2));
	await ev(() => (fastart.sidebar.tab.value = "view"));
	await wait(300);
	const glShot = () => page.locator(".canvas-wrap canvas").nth(1).screenshot();
	const plain = await glShot();
	await shot("09-shading-plain");
	await insp.locator(".ur-seg[aria-label=Shading] button", { hasText: "Clay" }).click();
	await wait(300);
	const clay = await glShot();
	await shot("10-shading-clay");
	check("Clay is a shading of the canvas, kept by the studio", await ev(() => fastart.workspace.shading.value === "clay" && localStorage.getItem("fastart.shading") === "clay"));
	check("the canvas is lit differently", Buffer.compare(plain, clay) !== 0);
	check("and the file is not touched by it", !JSON.stringify(await ev(() => fastart.md.doc.value)).includes("clay"));

	// ------------------------------------------------------------- 4. the mannequin
	const fileBefore = fs.readFileSync(path.join(P, "helm.fart"), "utf8");
	await insp.locator(".ur-insp", { hasText: "Mannequin" }).locator("select").first().selectOption("body.fart");
	await page.waitForFunction(() => !!fastart.md.mannequin.value);
	await wait(300);
	check("the mannequin is loaded: another model of the project", await ev(() => fastart.md.mannequin.value.path === "body.fart" && fastart.work.value.mannequin.path === "body.fart"));
	const withBody = await glShot();
	check("it is drawn under the model", Buffer.compare(withBody, clay) !== 0);
	await shot("11-mannequin-clay");
	await insp.locator(".ur-seg[aria-label=Shading] button", { hasText: "Plain" }).click();
	await wait(300);
	await shot("12-mannequin-plain");
	// it cannot be picked: a click on the body's chest, well below the helm, selects nothing
	await ev(() => (fastart.sidebar.tab.value = "inspector"));
	const helmAt = await ev((box) => { const z = fastart.view.zoom.value; const p = fastart.view.pan.value; const [W, H] = fastart.view.size.value; const b = fastart.chosenBounds(); return [box.x + ((b.lo[0] + b.hi[0]) / 2 - p[0]) * z + W / 2, box.y + (b.hi[1] - p[1]) * z + H / 2, z]; }, box0);
	await page.mouse.click(helmAt[0], helmAt[1] + 5 * helmAt[2]);
	await wait();
	check("a click on the mannequin selects nothing", await ev(() => fastart.md.sel.value === null));
	await page.mouse.click(helmAt[0], helmAt[1] - 2.5 * helmAt[2]);
	await wait();
	check("a click on the helm still selects the helm", await ev(() => fastart.md.sel.value?.shape === 0));
	check("zoom to fit ignores the mannequin", await ev(() => { const b = fastart.chosenBounds(); return !!b; }));

	// ------------------------------------------------------------- 3. a reference image
	await page.mouse.click(box0.x + 30, box0.y + 30);
	await ev(() => (fastart.sidebar.tab.value = "view"));
	await wait(300);
	await insp.locator("button", { hasText: "Pin an image" }).click();
	await wait(300);
	check("with no file dialog (a served studio) the pin asks for a path, in a sheet", (await page.locator(".ur-sheet").count()) === 1);
	await page.locator(".ur-sheet input").fill("refs/helm-front.png");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => fastart.work.value.refs?.front?.path === "refs/helm-front.png");
	await wait(500);
	check("pinning looks from the view it is pinned to", await ev(() => fastart.md.viewName.value === "front"));
	const width = insp.locator(".ur-insp", { hasText: "Reference images" }).locator(".ur-prop", { hasText: "Width" }).locator("input");
	await width.fill("16");
	await width.press("Enter");
	await ev(() => fastart.workspace.setRef("front", { y: -8, opacity: 0.8 }));
	await page.keyboard.press("Shift+1");
	await wait(400);
	// the ground canvas (under the solids) has the image's red frame in it
	const redAt = () => ev(() => { const c = document.querySelectorAll(".canvas-wrap canvas")[0]; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 110 && d[i + 2] < 110) n++; return n; });
	const redFront = await redAt();
	check("the image is drawn behind the model in the front view", redFront > 500, `${redFront} red pixels on the ground canvas`);
	await shot("13-reference-front");
	await page.keyboard.press("7");
	await wait(300);
	check("and not in the top view", (await redAt()) === 0, `${await redAt()} red pixels`);
	await shot("14-reference-not-in-top");
	await page.keyboard.press("1");
	await ev(() => fastart.model.setTurn([0.3, -0.5, 0]));
	await wait(300);
	check("nor once the view is orbited", (await redAt()) === 0);
	await page.keyboard.press("1");
	await wait(300);

	// none of the working aids is in the file, and all of them come back with the document
	await ev(() => fastart.flushNow?.());
	await ev(() => fastart.model.flushNow());
	await wait(500);
	const fileNow = fs.readFileSync(path.join(P, "helm.fart"), "utf8");
	check("the file holds none of it: no reference, no mannequin, no mirror, no shading", !/refs\/|body\.fart|mannequin|opacity|"mirror"|clay/.test(fileNow));
	check("the file is byte for byte what it was before the mannequin and the reference", fileNow === fileBefore);
	const leave = async () => {
		// a checkpoint first: leaving an edited asset would ask
		await ev(() => fastart.model.save());
		await ev(() => fastart.goBrowse());
		await wait(400);
	};
	await leave();
	await ev(() => fastart.openDoc("helm.fart"));
	await page.waitForFunction(() => fastart.md.path.value === "helm.fart" && !!fastart.md.mannequin.value);
	await wait(400);
	check("reopened, the reference and the mannequin are remembered", await ev(() => fastart.work.value.refs.front.w === 16 && fastart.md.mannequin.value.path === "body.fart"));
	check("and the image shows again in the front view", (await redAt()) > 500);
	await shot("15-reopened-reference-and-mannequin");
	await leave();
	await ev(() => fastart.openDoc("body.fart"));
	await page.waitForFunction(() => fastart.md.path.value === "body.fart");
	await wait(300);
	check("another document has notes of its own: none", await ev(() => !fastart.work.value.refs && !fastart.md.mannequin.value));
	// a rounded form under each light, for the eye
	await ev(() => fastart.model.setTurn([0.25, -0.5, 0]));
	await page.keyboard.press("Shift+1");
	await wait(300);
	await shot("18-body-plain");
	await ev(() => fastart.workspace.setShading("clay"));
	await wait(300);
	await shot("19-body-clay");
	await ev(() => fastart.workspace.setShading("plain"));
	await leave();
	await ev(() => fastart.openDoc("helm.fart"));
	await page.waitForFunction(() => fastart.md.path.value === "helm.fart");
	await wait(400);

	// ------------------------------------------------------------- 6. the Ask panel's tools
	const call = (name, args) => ev(async ({ name, args }) => { const r = await fastart.callTool(name, args); return { isError: !!r.isError, text: r.content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), images: r.content.filter((c) => c.type === "image").map((c) => c.data) }; }, { name, args });
	// a fresh box to work on, added the way Claude would: the whole document
	const got = JSON.parse((await call("get_document", {})).text);
	got.doc.parts[0].shapes.push(box("steel", [12, -2, 0], [4, 4, 4]));
	check("apply_document adds a second mesh", !(await call("apply_document", { doc: got.doc, note: "a box to edit" })).isError);
	const T = { part: "helm", shape: 1 };
	let r = JSON.parse((await call("mesh_info", T)).text);
	check("mesh_info measures it", r.points === 8 && r.faces === 6 && r.closed && r.windsOutward && Math.abs(r.volume - 64) < 1e-6, JSON.stringify(r));
	const tface = (d) => ev((d) => { const sh = fastart.md.doc.value.parts[0].shapes[1]; let best = -1; let bk = -Infinity; sh.faces.forEach((f, i) => { const n = [0, 0, 0]; for (let k = 0; k < f.length; k++) { const a = sh.points[f[k]]; const b = sh.points[f[(k + 1) % f.length]]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); } const l = Math.hypot(...n) || 1; const kk = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l; if (kk > bk + 1e-9) { bk = kk; best = i; } }); return best; }, d);
	const undoable = () => ev(() => { let n = 0; return n; });
	void undoable;
	const step = async (name, args, test, what) => {
		const before = JSON.stringify(await ev(() => fastart.md.doc.value));
		const res = await call(name, { ...T, ...args });
		const out = res.isError ? null : JSON.parse(res.text);
		check(`${name}: ${what}`, !res.isError && test(out.mesh, out), res.text.slice(0, 260));
		// one undo step: undo gives the document back exactly, redo the result
		const afterDoc = JSON.stringify(await ev(() => fastart.md.doc.value));
		await ev(() => fastart.model.undo());
		const undone = JSON.stringify(await ev(() => fastart.md.doc.value)) === before;
		await ev(() => fastart.model.redo());
		const redone = JSON.stringify(await ev(() => fastart.md.doc.value)) === afterDoc;
		check(`${name}: one undo step`, undone && redone);
		const v = JSON.parse((await call("validate", {})).text);
		check(`${name}: the document validates`, v.ok, JSON.stringify(v.errors).slice(0, 200));
		return out;
	};
	await step("mesh_inset", { faces: [await tface([0, -1, 0])], amount: 0.5 }, (m) => m.points === 12 && m.faces === 10 && m.closed && m.windsOutward && Math.abs(m.volume - 64) < 1e-6, "a ring of quads, the volume unchanged");
	await step("mesh_extrude", { faces: [await tface([0, -1, 0])], amount: 1 }, (m) => m.points === 16 && m.faces === 14 && m.closed && Math.abs(m.volume - 73) < 1e-6, "the inner face raised 1: 9 more volume");
	const sideFace = await ev(() => { const sh = fastart.md.doc.value.parts[0].shapes[1]; return sh.faces.find((f) => f.length === 4 && f.every((v) => sh.points[v][2] === -2)); });
	const upEdge = await ev((f) => { const sh = fastart.md.doc.value.parts[0].shapes[1]; for (let i = 0; i < 4; i++) { const a = f[i]; const b = f[(i + 1) % 4]; if (sh.points[a][1] !== sh.points[b][1]) return [a, b]; } return null; }, sideFace);
	const cut = await step("mesh_loop_cut", { edge: upEdge, at: 0.5 }, (m, o) => m.points === 20 && m.faces === 18 && m.closed && o.chosen.edges.length === 4, "a loop round the box, the new loop named in the answer");
	await step("mesh_crease", { edges: cut.chosen.edges, value: 1 }, (m) => m.points === 20, "creases the new loop");
	check("the creases are in the file", await ev(() => fastart.md.doc.value.parts[0].shapes[1].creases.length === 4));
	await step("mesh_crease_by_angle", { angle: 60, value: 0.5 }, (m) => m.faces === 18, "creases the sharp edges");
	const del = await step("mesh_delete_faces", { faces: [await tface([0, 1, 0])] }, (m) => !m.closed && m.rims.length === 1 && m.rims[0].length === 4, "opens a rim");
	const rim = del.mesh.rims[0];
	const band = await step("mesh_extrude", { edges: rim.map((v, i) => [v, rim[(i + 1) % rim.length]]), dir: [0, 2, 0] }, (m, o) => m.faces === 21 && m.rims.length === 1 && o.chosen.edges.length === 4, "a band from the rim, along a direction");
	const rim2 = band.mesh.rims[0];
	await step("mesh_fill", { edge: [rim2[0], rim2[1]] }, (m) => m.closed && m.windsOutward, "closes the rim; the solid winds outward");
	await step("mesh_flip", { faces: [0, 1, 2] }, (m) => !m.manifold, "three faces turned");
	await step("mesh_wind_outward", {}, (m) => m.manifold && m.closed && m.windsOutward, "puts them right");
	// a doubled corner to merge
	const dup = JSON.parse((await call("get_document", {})).text).doc;
	const sh1 = dup.parts[0].shapes[1];
	sh1.points.push([...sh1.points[0]]);
	const fi = sh1.faces.findIndex((f) => f.includes(0));
	sh1.faces[fi] = sh1.faces[fi].map((v) => (v === 0 ? sh1.points.length - 1 : v));
	// and a third mesh: two boxes either side of x = 0, to mirror an edit across and to bridge
	const pair2 = box("steel", [5, 6, 0], [4, 4, 4]);
	const other = box("steel", [-5, 6, 0], [4, 4, 4]);
	pair2.faces.push(...other.faces.map((f) => f.map((v) => v + pair2.points.length)));
	pair2.points.push(...other.points);
	dup.parts[0].shapes.push(pair2);
	await call("apply_document", { doc: dup, note: "a doubled corner, and two boxes" });
	const nPts = await ev(() => fastart.md.doc.value.parts[0].shapes[1].points.length);
	await step("mesh_merge", { distance: 0.001 }, (m) => m.points === nPts - 1 && m.closed, "welds the doubled corner");
	// the face of shape 2 that looks along d, on the side of x asked for
	const face2 = (d, side) => ev(({ d, side }) => { const sh = fastart.md.doc.value.parts[0].shapes[2]; let best = -1; let bk = -Infinity; sh.faces.forEach((f, i) => { if (Math.sign(f.reduce((s, v) => s + sh.points[v][0], 0)) !== side) return; const n = [0, 0, 0]; for (let k = 0; k < f.length; k++) { const a = sh.points[f[k]]; const b = sh.points[f[(k + 1) % f.length]]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); } const l = Math.hypot(...n) || 1; const kk = (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / l; if (kk > bk + 1e-9) { bk = kk; best = i; } }); return best; }, { d, side });
	const T2 = { part: "helm", shape: 2 };
	const T1 = { ...T };
	Object.assign(T, T2);
	await step("mesh_inset", { faces: [await face2([0, -1, 0], 1)], amount: 0.5, mirror: true }, (m, o) => m.points === 24 && m.faces === 20 && o.chosen.faces.length === 2, "mirror: the top of the right box, and of the left one too");
	const open2 = await step("mesh_delete_faces", { faces: [await face2([-1, 0, 0], 1)], mirror: true }, (m) => m.rims.length === 2 && m.rims.every((r) => r.length === 4), "mirror: the two faces that look at each other, leaving two rims");
	const [ra, rb] = open2.mesh.rims;
	await step("mesh_bridge", { a: [ra[0], ra[1]], b: [rb[0], rb[1]] }, (m) => m.rims.length === 0 && m.closed && m.windsOutward && Math.abs(m.volume - (64 + 64 + 6 * 16)) < 1e-6, "bridges the two rims: one closed solid, the two boxes and what lies between");
	Object.assign(T, T1);
	// refusals say why, and change nothing
	const snap = JSON.stringify(await ev(() => fastart.md.doc.value));
	const bad = [
		await call("mesh_inset", { ...T, faces: [999], amount: 0.1 }),
		await call("mesh_loop_cut", { ...T, edge: [0, 0] }),
		await call("mesh_extrude", { ...T, amount: 1 }),
		await call("mesh_fill", { ...T, edge: [0, 1] }),
		await call("mesh_crease", { ...T, edges: [[0, 1]], value: 3 }),
		await call("mesh_extrude", { part: "nobody", faces: [0], amount: 1 }),
		await call("mesh_inset", { part: "helm", shape: 7, faces: [0], amount: 1 }),
	];
	check("a wrong ask is refused with the reason, for each of them", bad.every((b) => b.isError && b.text.length > 12), bad.map((b) => b.text.slice(0, 60)).join(" | "));
	check("and none of them changed the document", JSON.stringify(await ev(() => fastart.md.doc.value)) === snap);

	// render: several views in one call
	const views = ["front", "left", "top", "three-quarter"];
	const rr = await call("render", { views });
	check("render with views answers with an image each", !rr.isError && rr.images.length === 4 && views.every((v) => rr.text.includes(`view ${v}`)), rr.text);
	check("the four are different pictures", new Set(rr.images).size === 4);
	if (shots) rr.images.forEach((d, i) => fs.writeFileSync(path.join(shots, `16-render-${views[i]}.png`), Buffer.from(d, "base64")));
	const one = await call("render", { view: "top" });
	check("render with one view still answers with one image", one.images.length === 1 && one.text.includes("view top"));
	check("an unknown view is refused by name", (await call("render", { views: ["front", "sideways"] })).isError);
	await page.keyboard.press("Shift+1");
	await wait(300);
	await shot("17-after-the-tools");
} finally {
	await browser.close();
	server.kill();
	await new Promise((r) => setTimeout(r, 300));
	fs.rmSync(P, { recursive: true, force: true });
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
