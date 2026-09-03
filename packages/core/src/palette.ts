// Palette resolution: flatten palette_refs (in order) then the local
// palette into one list, looked up back to front, so local wins and later
// refs beat earlier ones. Refs do not recurse: a palette file's own refs
// are its own business.

import { MAGENTA, type Doc, type Rgba, type Token } from "./types.ts";

/** Reads a palette_ref, relative to the document that names it. Null = could not. */
export type RefReader = (relpath: string) => Promise<string | null> | string | null;

export interface Resolved {
	/** Every token in lookup order (local last). */
	tokens: Token[];
	/** Refs that could not be read or were not palettes. */
	unresolved: string[];
}

function tokensOf(text: string): Token[] | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
	const doc = raw as Record<string, unknown>;
	if (typeof doc.version === "number" && doc.version > 1) return null;
	if (!Array.isArray(doc.palette)) return [];
	return doc.palette.filter(
		(t): t is Token => typeof t === "object" && t !== null && typeof (t as Token).name === "string" && Array.isArray((t as Token).rgb),
	);
}

export async function resolvePalettes(doc: Doc, read: RefReader): Promise<Resolved> {
	const tokens: Token[] = [];
	const unresolved: string[] = [];
	for (const ref of doc.palette_refs ?? []) {
		const text = await read(ref);
		const got = text === null ? null : tokensOf(text);
		if (got === null) unresolved.push(ref);
		else tokens.push(...got);
	}
	tokens.push(...(doc.palette ?? []));
	return { tokens, unresolved };
}

/** The colour a token resolves to, or loud magenta. */
export function colorOf(tokens: readonly Token[], name: string): Rgba {
	for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].name === name) return tokens[i].rgb;
	return MAGENTA;
}

/** Just the names, for validate({ refTokens }). */
export function tokenNames(resolved: Resolved): Set<string> {
	return new Set(resolved.tokens.map((t) => t.name));
}

/** CSS form of an rgba, for canvases and stylesheets. */
export function cssColor([r, g, b, a]: Rgba): string {
	return `rgba(${r},${g},${b},${a / 255})`;
}
