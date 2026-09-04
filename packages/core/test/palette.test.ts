import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPalette, colorOf, isPaletteFile, resolvePalettes, type Token } from "../src/index.ts";

const base: Token[] = [
	{ name: "skin", rgb: [230, 190, 160, 255] },
	{ name: "cloth", rgb: [60, 80, 160, 255] },
];

test("applyPalette recolours by name and adds what is new", () => {
	const swapped = applyPalette(base, [
		{ name: "cloth", rgb: [160, 40, 40, 255] },
		{ name: "trim", rgb: [240, 200, 60, 255] },
	]);
	assert.deepEqual(colorOf(swapped, "cloth"), [160, 40, 40, 255]);
	assert.deepEqual(colorOf(swapped, "skin"), [230, 190, 160, 255]);
	assert.deepEqual(colorOf(swapped, "trim"), [240, 200, 60, 255]);
	// the input is untouched
	assert.deepEqual(colorOf(base, "cloth"), [60, 80, 160, 255]);
	assert.equal(base.length, 2);
});

test("applyPalette recolours the last of a repeated name, the one lookup finds", () => {
	const twice: Token[] = [...base, { name: "skin", rgb: [1, 1, 1, 255] }];
	const swapped = applyPalette(twice, [{ name: "skin", rgb: [9, 9, 9, 255] }]);
	assert.deepEqual(colorOf(swapped, "skin"), [9, 9, 9, 255]);
	assert.deepEqual(swapped[0].rgb, [230, 190, 160, 255]);
});

test("a swap over resolved refs still lets the swap win", async () => {
	const doc = { version: 1, palette_refs: ["base.fart"], palette: [{ name: "cloth", rgb: [0, 0, 0, 255] as [number, number, number, number] }], parts: [] };
	const { tokens } = await resolvePalettes(doc, () => JSON.stringify({ version: 1, palette: base }));
	assert.deepEqual(colorOf(tokens, "cloth"), [0, 0, 0, 255]); // local wins over the ref
	const swapped = applyPalette(tokens, [{ name: "cloth", rgb: [5, 5, 5, 255] }]);
	assert.deepEqual(colorOf(swapped, "cloth"), [5, 5, 5, 255]); // a swap wins over both
});

test("isPaletteFile: colours and no parts", () => {
	assert.equal(isPaletteFile({ version: 1, palette: base }), true);
	assert.equal(isPaletteFile({ version: 1, palette: [] }), true);
	assert.equal(isPaletteFile({ version: 1, palette: base, parts: [] }), false);
	assert.equal(isPaletteFile({ version: 1 }), false);
});
