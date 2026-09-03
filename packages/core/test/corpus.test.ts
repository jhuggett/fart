// The conformance corpus: every case in spec/examples/manifest.json gets
// the verdict the manifest promises, with the named error code and the
// named warnings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDoc, resolvePalettes, tokenNames } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const examples = resolve(here, "../../../spec/examples");

interface Case {
	file: string;
	valid: boolean;
	code?: string;
	warnings?: string[];
	note?: string;
}
const manifest = JSON.parse(await readFile(join(examples, "manifest.json"), "utf8")) as { cases: Case[] };

for (const c of manifest.cases) {
	test(`${c.file}${c.note ? ` (${c.note})` : ""}`, async () => {
		const file = join(examples, c.file);
		const text = await readFile(file, "utf8");
		const first = parseDoc(text);
		let refTokens: Iterable<string> | null | undefined;
		if (first.doc?.palette_refs?.length) {
			const resolved = await resolvePalettes(first.doc, async (rel) => {
				try {
					return await readFile(resolve(dirname(file), rel), "utf8");
				} catch {
					return null;
				}
			});
			refTokens = resolved.unresolved.length ? null : tokenNames(resolved);
		}
		const { doc, report } = parseDoc(text, { refTokens });
		assert.equal(report.ok, c.valid, JSON.stringify(report.errors));
		assert.equal(doc !== null, c.valid);
		if (!c.valid) {
			assert.ok(
				report.errors.some((e) => e.code === c.code),
				`expected code ${c.code}, got ${report.errors.map((e) => e.code).join(", ") || "none"}`,
			);
		}
		const warned = new Set(report.warnings.map((w) => w.code));
		assert.deepEqual([...warned].sort(), [...(c.warnings ?? [])].sort());
	});
}
