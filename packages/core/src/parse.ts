import type { Doc } from "./types.ts";
import { validate, type Report, type ValidateOptions } from "./validate.ts";

export interface ParseResult {
	/** The document, when the report is ok. */
	doc: Doc | null;
	report: Report;
}

/** Parse and validate. Never throws; the report says what went wrong. */
export function parseDoc(text: string, opts?: ValidateOptions): ParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return { doc: null, report: { ok: false, errors: [{ code: "json", path: "", message: `not JSON: ${message}` }], warnings: [] } };
	}
	const report = validate(raw, opts);
	return { doc: report.ok ? (raw as Doc) : null, report };
}

export class FartError extends Error {
	readonly report: Report;
	constructor(report: Report) {
		super(report.errors.map((e) => `${e.code} at ${e.path || "/"}: ${e.message}`).join("\n"));
		this.name = "FartError";
		this.report = report;
	}
}

/** Parse and validate, throwing a FartError on a bad document. */
export function loadDoc(text: string, opts?: ValidateOptions): Doc {
	const { doc, report } = parseDoc(text, opts);
	if (!doc) throw new FartError(report);
	return doc;
}

/** The canonical on-disk form: two-space indent, trailing newline. */
export function stringifyDoc(doc: Doc): string {
	return JSON.stringify(doc, null, 2) + "\n";
}
