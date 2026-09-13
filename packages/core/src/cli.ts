#!/usr/bin/env node
// fart: the command line.
//
//   fart validate <file|dir>...   check documents (exit 1 if any fail)
//   fart bake <file>...           write tris into every poly (or mesh), in place
//   fart project <3d.fart> [--view v]... [-o out]   a 2D view of a 3D document (1.3)
//   fart gltf <3d.fart> [-o out.glb] [--fps n]      the model as a binary glTF (1.3)
//
// Directories are walked for .fart files; palette_refs are read relative
// to each file so shared tokens get checked too.

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseDoc } from "./parse.ts";
import { resolvePalettes, tokenNames } from "./palette.ts";
import { bakeTris } from "./geometry.ts";
import { stringifyDoc } from "./parse.ts";
import { as3d, type Doc, type Vec3 } from "./types.ts";
import { bakeTris3 } from "./space3.ts";
import { DEFAULT_AMBIENT, DEFAULT_FPS, DEFAULT_LIGHT, VIEWS, projectDoc } from "./project.ts";
import { toGlb } from "./gltf.ts";

async function collect(paths: string[]): Promise<string[]> {
	const out: string[] = [];
	const walk = async (p: string) => {
		const s = await stat(p);
		if (s.isDirectory()) {
			for (const name of (await readdir(p)).sort()) {
				if (name.startsWith(".") || name === "node_modules") continue;
				await walk(join(p, name));
			}
		} else if (p.endsWith(".fart")) out.push(p);
	};
	for (const p of paths) await walk(p);
	return out;
}

async function readRef(base: string, rel: string): Promise<string | null> {
	try {
		return await readFile(resolve(dirname(base), rel), "utf8");
	} catch {
		return null;
	}
}

async function check(file: string): Promise<{ ok: boolean; doc: Doc | null; lines: string[] }> {
	const text = await readFile(file, "utf8");
	// a first pass finds the refs; a second checks tokens against them
	const first = parseDoc(text);
	let refTokens: Iterable<string> | null | undefined;
	if (first.doc && first.doc.palette_refs?.length) {
		const resolved = await resolvePalettes(first.doc, (rel) => readRef(file, rel));
		refTokens = resolved.unresolved.length ? null : tokenNames(resolved);
	}
	const { doc, report } = parseDoc(text, { refTokens });
	const lines: string[] = [];
	for (const e of report.errors) lines.push(`  error ${e.code} ${e.path || "/"}: ${e.message}`);
	for (const w of report.warnings) lines.push(`  warn  ${w.code} ${w.path || "/"}: ${w.message}`);
	return { ok: report.ok, doc, lines };
}

async function validateCmd(paths: string[]): Promise<number> {
	const files = await collect(paths.length ? paths : ["."]);
	let bad = 0;
	for (const file of files) {
		const { ok, lines } = await check(file);
		const warns = lines.filter((l) => l.startsWith("  warn")).length;
		const tag = ok ? (warns ? `ok (${warns} warning${warns === 1 ? "" : "s"})` : "ok") : "FAIL";
		console.log(`${tag.padEnd(16)} ${file}`);
		for (const l of lines) console.log(l);
		if (!ok) bad++;
	}
	console.log(`${files.length} file${files.length === 1 ? "" : "s"}, ${bad} failing`);
	return bad ? 1 : 0;
}

async function bakeCmd(paths: string[]): Promise<number> {
	const files = await collect(paths);
	let bad = 0;
	for (const file of files) {
		const { ok, doc, lines } = await check(file);
		if (!ok || !doc) {
			console.log(`skip ${file}: not valid`);
			for (const l of lines) console.log(l);
			bad++;
			continue;
		}
		const d3 = as3d(doc);
		if (d3) bakeTris3(d3);
		else bakeTris(doc);
		await writeFile(file, stringifyDoc(doc));
		console.log(`baked ${file}`);
	}
	return bad ? 1 : 0;
}

const USAGE = `usage: fart validate <file|dir>...
       fart bake <file>...
       fart gltf <3d.fart> [-o out.glb] [--fps n]
       fart project <3d.fart> [--view name|x,y,z(deg)]... [--light x,y,z] [--ambient a] [--fps n] [--outline token[:w]] [-o out.fart]
         views: ${Object.keys(VIEWS).join(", ")}; several --view flags write several files (out gets -<view>)`;

/** fart project: a 2D document per view, beside the source unless -o says where. */
async function projectCmd(args: string[]): Promise<number> {
	const views: (string | Vec3)[] = [];
	let light: Vec3 | undefined;
	let ambient: number | undefined;
	let fps: number | undefined;
	let outline: { color: string; w: number } | undefined;
	let out: string | undefined;
	const files: string[] = [];
	const nums = (s: string, n: number, what: string): number[] => {
		const v = s.split(",").map(Number);
		if (v.length !== n || v.some((x) => !Number.isFinite(x))) throw new Error(`${what}: expected ${n} numbers, got "${s}"`);
		return v;
	};
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = () => {
			if (i + 1 >= args.length) throw new Error(`${a} needs a value`);
			return args[++i];
		};
		if (a === "--view") {
			const v = next();
			if (v in VIEWS) views.push(v);
			else views.push(nums(v, 3, "--view").map((d) => (d * Math.PI) / 180) as Vec3);
		} else if (a === "--light") light = nums(next(), 3, "--light") as Vec3;
		else if (a === "--ambient") ambient = Number(next());
		else if (a === "--fps") fps = Number(next());
		else if (a === "--outline") {
			const [color, w] = next().split(":");
			outline = { color, w: w === undefined ? 0.4 : Number(w) };
		} else if (a === "-o" || a === "--out") out = next();
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("project takes one 3D source file");
	if (!views.length) views.push("front");
	const file = files[0];
	const { ok, doc, lines } = await check(file);
	if (!ok || !doc) {
		console.log(`skip ${file}: not valid`);
		for (const l of lines) console.log(l);
		return 1;
	}
	const src = as3d(doc);
	if (!src) throw new Error(`${file} is not a 3D document (space: "3d")`);
	const stem = basename(file).replace(/\.fart$/, "");
	for (const view of views) {
		const label = typeof view === "string" ? view : view.map((r) => Math.round((r * 180) / Math.PI)).join("_");
		let target: string;
		if (out === undefined) target = join(dirname(file), `${stem}-${label}.fart`);
		else if (views.length === 1) target = out;
		else target = out.replace(/\.fart$/, "") + `-${label}.fart`;
		const from = relative(dirname(resolve(target)), resolve(file)).split("\\").join("/");
		const projected = projectDoc(src, { view, light, ambient, fps, outline, from });
		// palette_refs were relative to the source; make them relative to the output
		if (projected.palette_refs) {
			projected.palette_refs = projected.palette_refs.map((ref) => relative(dirname(resolve(target)), resolve(dirname(file), ref)).split("\\").join("/"));
		}
		if (outline && !(projected.palette ?? []).some((t) => t.name === outline.color)) {
			projected.palette = [...(projected.palette ?? []), { name: outline.color, rgb: [25, 22, 30, 255] }];
		}
		await writeFile(target, stringifyDoc(projected));
		const variants = (projected.parts ?? []).filter((p) => p.name.includes("@")).length;
		console.log(`wrote ${target}  (${(projected.parts ?? []).length - variants} parts, ${variants} variants, light ${(light ?? DEFAULT_LIGHT).join(",")}, ambient ${ambient ?? DEFAULT_AMBIENT}, ${fps ?? DEFAULT_FPS} fps)`);
	}
	return 0;
}

/** fart gltf: the model as a .glb beside it, palette refs resolved. */
async function gltfCmd(args: string[]): Promise<number> {
	let out: string | undefined;
	let fps: number | undefined;
	const files: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "-o" || a === "--out") out = args[++i];
		else if (a === "--fps") fps = Number(args[++i]);
		else if (a.startsWith("-")) throw new Error(`unknown flag ${a}`);
		else files.push(a);
	}
	if (files.length !== 1) throw new Error("gltf takes one 3D source file");
	const file = files[0];
	const { ok, doc, lines } = await check(file);
	if (!ok || !doc) {
		console.log(`skip ${file}: not valid`);
		for (const l of lines) console.log(l);
		return 1;
	}
	const src = as3d(doc);
	if (!src) throw new Error(`${file} is not a 3D document (space: "3d")`);
	const { tokens } = await resolvePalettes(doc, (rel) => readRef(file, rel));
	const glb = toGlb(src, { tokens, fps });
	const target = out ?? file.replace(/\.fart$/, "") + ".glb";
	await writeFile(target, glb);
	console.log(`wrote ${target}  (${(glb.length / 1024).toFixed(1)} KB, ${(src.parts ?? []).length} nodes, ${(src.clips ?? []).length} animations)`);
	return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 2;
try {
	switch (cmd) {
		case "validate":
			code = await validateCmd(rest);
			break;
		case "bake":
			code = await bakeCmd(rest);
			break;
		case "project":
			code = await projectCmd(rest);
			break;
		case "gltf":
			code = await gltfCmd(rest);
			break;
		default:
			console.log(USAGE);
	}
} catch (e) {
	console.error(`fart ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
	code = 2;
}
process.exit(code);
