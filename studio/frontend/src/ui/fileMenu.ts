// Right-click on a file or a folder, the same wherever it shows: the
// browser's tiles, the navigator's rows. Every item is a project operation.

import { project, openDoc, refreshFiles, deleteFile, renameFile, duplicateFile, revealFile, goFolder } from "../state/project.ts";
import { openDocNow } from "../state/doc.ts";
import type { MenuItem } from "../state/menu.ts";
import { newAssetSheet } from "./Sheets.tsx";

export function askNewFile(folder: string) {
	void newAssetSheet("2D", folder);
}

/** A palette file, asked by name; at the root it lands in palettes/. */
export function askNewPalette(folder: string, open = true): Promise<string | null> {
	return newAssetSheet("Palette", folder, open);
}

export function fileMenu(rel: string): MenuItem[] {
	const caps = project.caps.value;
	const isOpen = openDocNow()?.path === rel;
	const items: MenuItem[] = [
		{ label: "Open", disabled: isOpen, run: () => void openDoc(rel) },
		{ label: "Rename…", run: () => void renameFile(rel) },
		{ label: "Duplicate", run: () => void duplicateFile(rel) },
	];
	if (caps.reveal) items.push({ label: `Reveal in ${caps.reveal}`, run: () => void revealFile(rel) });
	items.push({ label: caps.trash ? "Move to Trash…" : "Delete…", danger: true, sep: true, run: () => void deleteFile(rel) });
	return items;
}

/** A folder's menu; "" is the project itself. */
export function folderMenu(path: string): MenuItem[] {
	const caps = project.caps.value;
	const items: MenuItem[] = [
		{ label: "New asset…", run: () => askNewFile(path) },
		{ label: "New palette…", run: () => void askNewPalette(path) },
		{ label: "Show in the browser", sep: true, run: () => void goFolder(path) },
	];
	if (caps.reveal) items.push({ label: `Reveal in ${caps.reveal}`, run: () => void revealFile(path) });
	if (!path) items.push({ label: "Refresh", sep: true, run: () => void refreshFiles() });
	return items;
}
