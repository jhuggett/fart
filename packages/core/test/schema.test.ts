// The hand validator and spec/fart.schema.json must agree: for every corpus
// file that is JSON, the schema accepts it exactly when the validator finds
// no structural error (version, schema, path). Reference errors are the
// validator's alone; the schema cannot see across the document.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import AjvModule from "ajv/dist/2020.js";
import { validate } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const spec = resolve(here, "../../../spec");
const schema = JSON.parse(await readFile(join(spec, "fart.schema.json"), "utf8"));
const manifest = JSON.parse(await readFile(join(spec, "examples/manifest.json"), "utf8")) as { cases: { file: string }[] };

// Node hands ESM the CommonJS module object; the class is its default
const Ajv2020 = (AjvModule as unknown as { default: typeof AjvModule.default }).default ?? AjvModule;
const ajv = new Ajv2020({ strict: true, allErrors: true });
const bySchema = ajv.compile(schema);
const STRUCTURAL = new Set(["version", "schema", "path"]);

test("the schema compiles in strict mode", () => {
	assert.ok(bySchema);
});

for (const c of manifest.cases) {
	test(`schema agrees on ${c.file}`, async () => {
		let raw: unknown;
		try {
			raw = JSON.parse(await readFile(join(spec, "examples", c.file), "utf8"));
		} catch {
			return; // not JSON: nothing for a schema to say
		}
		const schemaOk = bySchema(raw);
		const report = validate(raw, { refTokens: [] });
		const structuralOk = !report.errors.some((e) => STRUCTURAL.has(e.code));
		assert.equal(schemaOk, structuralOk, JSON.stringify({ ajv: bySchema.errors, ours: report.errors }, null, 1));
	});
}
