#!/usr/bin/env node
// fart: the command line.
//
//   fart validate <file|dir>...   check documents (exit 1 if any fail)
//   fart bake <file>...           write tris into every poly, in place
//
// Directories are walked for .fart files; palette_refs are read relative
// to each file so shared tokens get checked too.

import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseDoc } from "./parse.ts";
import { resolvePalettes, tokenNames } from "./palette.ts";
import { bakeTris } from "./geometry.ts";
import { stringifyDoc } from "./parse.ts";
import type { Doc } from "./types.ts";

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
		bakeTris(doc);
		await writeFile(file, stringifyDoc(doc));
		console.log(`baked ${file}`);
	}
	return bad ? 1 : 0;
}

const [cmd, ...rest] = process.argv.slice(2);
let code = 2;
switch (cmd) {
	case "validate":
		code = await validateCmd(rest);
		break;
	case "bake":
		code = await bakeCmd(rest);
		break;
	default:
		console.log("usage: fart validate <file|dir>...\n       fart bake <file>...");
}
process.exit(code);
