// fart import: a glTF (.glb, or .gltf with its buffers beside it) as a
// 3D .fart, with what was left out printed. The work is gltfImport.ts;
// this reads the files and writes the result.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { GltfError, gltfBufferUris, importGltf, snakeName, type GltfImportOptions } from "./gltfImport.ts";
import { stringifyDoc } from "./parse.ts";
import { validate } from "./validate.ts";

export const IMPORT_USAGE = "fart import <model.glb|model.gltf> [-o out.fart] [--scale n] [--height n] [--merge] [--split-materials] [--no-quads] [--no-shades]";

export async function importCmd(args: string[]): Promise<number> {
	const opts: GltfImportOptions = {};
	let out: string | undefined;
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const num = (): number => {
			const v = Number(args[++i]);
			if (!Number.isFinite(v) || v <= 0) throw new Error(`${a} needs a number above 0`);
			return v;
		};
		if (a === "-o" || a === "--out") {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			out = args[++i];
		} else if (a === "--scale") opts.scale = num();
		else if (a === "--height") opts.height = num();
		else if (a === "--merge") opts.merge = true;
		else if (a === "--split-materials") opts.splitMaterials = true;
		else if (a === "--no-quads") opts.quads = false;
		else if (a === "--no-shades") opts.shades = false;
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("import takes one .glb or .gltf");
	const file = files[0];
	const target = out ?? file.replace(/\.(glb|gltf)$/i, "") + ".fart";
	const stem = (target.split(/[\\/]/).pop() ?? "model").replace(/\.fart$/, "");
	opts.name = snakeName(stem, "model");
	const bytes = new Uint8Array(await readFile(file));
	try {
		// a .gltf names the files its geometry is in, relative to itself
		const buffers: Record<string, Uint8Array> = {};
		for (const uri of gltfBufferUris(bytes)) {
			let rel = uri;
			try {
				rel = decodeURIComponent(uri);
			} catch {
				// as written
			}
			try {
				buffers[uri] = new Uint8Array(await readFile(resolve(dirname(file), rel)));
			} catch {
				// importGltf says which one is missing
			}
		}
		const { doc, warnings, summary } = importGltf(bytes, { ...opts, buffers });
		const report = validate(doc);
		for (const e of report.errors) console.log(`  error ${e.code} ${e.path || "/"}: ${e.message}`);
		if (!report.ok) {
			console.log(`import ${file}: the result does not validate; nothing written`);
			return 1;
		}
		await writeFile(target, stringifyDoc(doc));
		const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
		console.log(`wrote ${target}  (${n(summary.parts, "part")}, ${n(summary.shapes, "shape")}, ${n(summary.points, "point")}, ${n(summary.faces, "face")} of which ${n(summary.quads, "quad")}, ${n(summary.tokens, "colour")}, ${n(summary.states, "state")}, ${n(summary.clips, "clip")}; ${summary.size.join(" × ")} units at scale ${Math.round(summary.scale * 10000) / 10000})`);
		for (const w of warnings) console.log(`  warn  ${w}`);
		for (const w of report.warnings) console.log(`  warn  ${w.code} ${w.path || "/"}: ${w.message}`);
		return 0;
	} catch (e) {
		if (e instanceof GltfError) {
			console.log(`import ${file}: ${e.message}`);
			return 1;
		}
		throw e;
	}
}
