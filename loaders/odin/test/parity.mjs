// What @fastart/core generates for the 3D corpus, written beside this
// script as parity.json for the loader's parity test (parity_test.odin):
// for every mesh and sweep of each file, the mesh a renderer draws (the
// cage generated, mods applied, subdivided), and the same under every
// state that morphs it. Points are whole numbers, ten-thousandths of a
// unit. Each file's entry carries the hash of the bytes it was made
// from; the test passes a file over when its bytes have changed since.
//
//   npm run build -w @fastart/core && node loaders/odin/test/parity.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const core = await import(join(root, "packages/core/dist/index.js"));

// every valid 3D file of the corpus (1.8's paint, mods and pipe among them), and the helm
const manifest = JSON.parse(readFileSync(join(root, "spec/examples/manifest.json"), "utf8"));
const FILES = [...manifest.cases.filter((c) => c.valid && c.space === "3d" && !c.shart).map((c) => `spec/examples/${c.file}`), "examples/helm/helm.fart"];
const q = (x) => Math.round(x * 10000);

function dump(sh, part, shape, state) {
	const m = core.asMesh(sh);
	return {
		part,
		shape,
		state: state ?? "",
		points: m.points.map((p) => p.map(q)),
		faces: m.faces,
		paint: m.paint && m.paint.length === m.faces.length ? m.paint : [],
		shades: m.shades && m.shades.length === m.points.length ? m.shades : [],
	};
}

const files = FILES.map((file) => {
	const bytes = readFileSync(join(root, file));
	const doc = JSON.parse(bytes.toString("utf8"));
	const shapes = [];
	for (const part of doc.parts ?? []) {
		(part.shapes ?? []).forEach((sh, i) => {
			if (sh.kind === "mesh" || sh.kind === "sweep") shapes.push(dump(sh, part.name, i));
		});
	}
	for (const st of doc.states ?? []) {
		for (const sp of st.parts ?? []) {
			const part = (doc.parts ?? []).find((p) => p.name === sp.part);
			if (!part || !sp.morph?.length) continue;
			core.shapesOf3Posed(doc, part, sp).forEach((sh, i) => {
				if (sp.morph.some((m) => m.shape === i) && sh.kind === "mesh") shapes.push(dump(sh, part.name, i, st.name));
			});
		}
	}
	return { file, of: core.sourceHash(new Uint8Array(bytes)), shapes };
});

writeFileSync(join(here, "parity.json"), JSON.stringify({ files }) + "\n");
for (const f of files) console.log(f.file, f.shapes.length, "meshes,", f.shapes.reduce((n, s) => n + s.points.length, 0), "points");
