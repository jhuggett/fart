// The tools Uranus offers Claude, answered by the page: it holds the
// document. Each returns an MCP result: content blocks, and isError when
// something was wrong with the ask.

import { validate, sampleClip, solveTargets, sampleTargets, type Doc } from "@fastart/core";
import { shell, type ToolCall } from "../shell/shell.ts";
import { ed, doc, curState, curClip, parts, primary, applyExternalDoc, frame, shapesIn } from "./editor.ts";
import { project, openDoc } from "./project.ts";
import { renderPNG } from "../canvas/draw.ts";
import { chatNote } from "./chat.ts";

type Block = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
interface Result {
	content: Block[];
	isError?: boolean;
}
const text = (t: string): Result => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Result => ({ content: [{ type: "text", text: t }], isError: true });

const HARD = new Set(["json", "version", "schema", "path"]);

function getDocument(): Result {
	const rel = ed.path.value;
	if (!rel || ed.isPalette.value) {
		return text(
			JSON.stringify({
				open: rel ?? null,
				note: rel ? "a palette file is open (colours only)" : "no file is open: the shelf is showing",
				files: project.files.value,
				...(rel ? { doc: doc() } : {}),
			}),
		);
	}
	const d = doc();
	const p = primary();
	const sel = ed.sel.value;
	const st = curState();
	const clip = curClip();
	return text(
		JSON.stringify({
			open: rel,
			doc: d,
			selection: { part: parts()[ed.curPart.value]?.name ?? null, primaryShape: p ? { part: parts()[p.p]?.name, index: p.s, shape: shapesIn(parts()[p.p])[p.s] } : null, shapes: sel.map((r) => ({ part: parts()[r.p]?.name, index: r.s })) },
			onCanvas: clip ? { clip: clip.name, t: ed.clipTime.value } : { state: st?.name ?? null },
			sharedTokens: ed.shared.value.map((t) => t.name),
			files: project.files.value,
		}),
	);
}

function applyDocument(args: Record<string, unknown>): Result {
	if (!ed.path.value) return fail("no file is open in the editor; open_file first");
	const d = args.doc;
	if (typeof d !== "object" || d === null || Array.isArray(d)) return fail("doc must be the whole document object");
	const r = validate(d, { refTokens: ed.unresolved.value.length ? null : ed.shared.value.map((t) => t.name) });
	if (r.errors.some((e) => HARD.has(e.code)) || r.errors.length) {
		return fail("refused, the document has errors:\n" + r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("\n"));
	}
	const summary = applyExternalDoc(d as Doc);
	const note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : summary;
	chatNote(`Claude changed the document · ${note}`);
	return text(`applied. ${summary}${r.warnings.length ? `\nwarnings: ${r.warnings.map((w) => `${w.code} ${w.path}`).join(", ")}` : ""}`);
}

function render(args: Record<string, unknown>): Result {
	if (!ed.path.value) return fail("no file is open");
	const d = doc();
	const size = typeof args.size === "number" ? Math.max(64, Math.min(1024, args.size)) : 512;
	let pose: string | ReturnType<typeof frame> | undefined;
	let label = "the canvas";
	if (typeof args.clip === "string") {
		const c = d.clips?.find((k) => k.name === args.clip);
		if (!c) return fail(`no clip named ${args.clip}`);
		const t = typeof args.t === "number" ? args.t : 0;
		const poses = sampleClip(d, c, t);
		const targets = sampleTargets(d, c, t);
		if (targets.length) solveTargets(d, poses, targets);
		pose = poses;
		label = `clip ${c.name} at ${t}s`;
	} else if (typeof args.state === "string") {
		if (!d.states?.some((s) => s.name === args.state)) return fail(`no state named ${args.state}`);
		pose = args.state;
		label = `state ${args.state}`;
	} else {
		pose = frame();
		const c = curClip();
		label = c ? `clip ${c.name} at ${ed.clipTime.value}s` : `state ${curState()?.name ?? "?"}`;
	}
	const png = renderPNG(d, ed.tokens.value, pose, size);
	return { content: [{ type: "image", data: png, mimeType: "image/png" }, { type: "text", text: `rendered ${label}` }] };
}

function validateTool(args: Record<string, unknown>): Result {
	const d = typeof args.doc === "object" && args.doc !== null ? args.doc : doc();
	const r = validate(d, { refTokens: ed.unresolved.value.length ? null : ed.shared.value.map((t) => t.name) });
	return text(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings }));
}

async function openFile(args: Record<string, unknown>): Promise<Result> {
	const path = typeof args.path === "string" ? args.path : "";
	if (!path) return fail("path is required");
	if (!project.files.value.includes(path)) return fail(`no file ${path} in the project; files: ${project.files.value.join(", ")}`);
	const ok = await openDoc(path);
	return ok ? text(`opened ${path}`) : fail(`could not open ${path}`);
}

/** Answer a relayed call; every path replies, so Claude never waits on a mistake. */
export async function handleTool(call: ToolCall) {
	let result: Result;
	try {
		const args = call.args ?? {};
		switch (call.name) {
			case "get_document":
				result = getDocument();
				break;
			case "apply_document":
				result = applyDocument(args);
				break;
			case "render":
				result = render(args);
				break;
			case "validate":
				result = validateTool(args);
				break;
			case "open_file":
				result = await openFile(args);
				break;
			default:
				result = fail(`no tool named ${call.name}`);
		}
	} catch (e) {
		result = fail(`the editor failed: ${String(e)}`);
	}
	await shell.toolReply(call.id, JSON.stringify(result));
}
