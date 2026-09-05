// What the format promises editors: fields it does not know ride along,
// byte for byte, load to save. meta is the engine's bag; nothing in here
// looks inside it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoc, stringifyDoc, bakeTris } from "../src/index.ts";

test("meta and unknown fields survive parse, bake, and stringify, order kept", () => {
	const text = JSON.stringify(
		{
			version: 1,
			name: "shuffler",
			meta: { forward: "up", about: "a rig", game: { situations: { drowse: "curl", hunt: ["shuffle", "reach"] }, tags: [1, 2, 3] }, later: null },
			palette: [{ name: "c", rgb: [1, 2, 3, 255], mood: "grim" }],
			parts: [{ name: "a", pivot: [0, 0], shapes: [{ kind: "poly", color: "c", points: [[0, 0], [4, 0], [0, 4]], hint: "tri" }], meta: { role: "torso" } }],
			states: [{ name: "s", parts: [{ part: "a", flair: true }], note: "kept" }],
			extra_top: { anything: [true, "x"] },
		},
		null,
		2,
	);
	const { doc, report } = parseDoc(text);
	assert.ok(doc, JSON.stringify(report.errors));
	bakeTris(doc);
	const back = JSON.parse(stringifyDoc(doc));
	const orig = JSON.parse(text);
	assert.deepEqual(back.meta, orig.meta);
	assert.deepEqual(Object.keys(back.meta), Object.keys(orig.meta));
	assert.deepEqual(back.extra_top, orig.extra_top);
	assert.deepEqual(back.parts[0].meta, orig.parts[0].meta);
	assert.equal(back.parts[0].shapes[0].hint, "tri");
	assert.equal(back.states[0].note, "kept");
	assert.equal(back.states[0].parts[0].flair, true);
	assert.equal(back.palette[0].mood, "grim");
	// the only additions are the baked tris
	delete back.parts[0].shapes[0].tris;
	assert.deepEqual(back, orig);
});
