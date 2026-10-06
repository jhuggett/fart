// The open asset, whichever store holds it (the 2D editor, the model
// screen, the scene screen): its path, whether it has changed since its
// checkpoint, and the three things the frame does to it.

import { ed, save, revertToCheckpoint, undo, redo } from "./editor.ts";
import * as M from "./model.ts";
import * as S from "./scene.ts";
import type { Issue } from "@fastart/core";

export interface OpenDoc {
	path: string;
	kind: "edit" | "model" | "scene";
	dirty: boolean;
	/** when the checkpoint was last kept, and when the file last reached disk (ms; 0 for never) */
	checkpointAt: number;
	written: number;
	issues: Issue[];
	save: () => Promise<unknown>;
	revert: () => Promise<unknown>;
	undo: () => void;
	redo: () => void;
}

/** Reads the stores' signals, so a component that calls it follows them. */
export function openDocNow(): OpenDoc | null {
	if (ed.path.value) return { path: ed.path.value, kind: "edit", dirty: ed.dirty.value, checkpointAt: ed.checkpointAt.value, written: ed.written.value, issues: ed.issues.value, save, revert: revertToCheckpoint, undo, redo };
	if (M.md.path.value) return { path: M.md.path.value, kind: "model", dirty: M.md.dirty.value, checkpointAt: M.md.checkpointAt.value, written: M.md.written.value, issues: M.md.issues.value, save: M.save, revert: M.revertToCheckpoint, undo: M.undo, redo: M.redo };
	if (S.sc.path.value) return { path: S.sc.path.value, kind: "scene", dirty: S.sc.dirty.value, checkpointAt: S.sc.checkpointAt.value, written: S.sc.written.value, issues: S.sc.issues.value, save: S.save, revert: S.revertToCheckpoint, undo: S.undo, redo: S.redo };
	return null;
}

const soft = (code: string) => ["unknown", "reserved", "unresolved"].includes(code);
/** The problems the format refuses, as opposed to notes. */
export const hardIssues = (issues: Issue[]) => issues.filter((i) => !soft(i.code));
export const isSoft = soft;
