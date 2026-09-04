// Right-click on a file or a folder, the same wherever it shows: the
// shelf's tiles, the explorer's rows. Every item is a project operation.

import { ask } from "../state/prompt.ts";
import { project, openDoc, newFile, newPalette, refreshFiles, deleteFile, renameFile, duplicateFile, revealFile } from "../state/project.ts";
import { ed } from "../state/editor.ts";
import type { MenuItem } from "../state/menu.ts";

export function askNewFile(folder: string) {
	void ask(folder ? `Name the new file in ${folder}/` : "Name the new file").then((n) => {
		if (n) void newFile(folder ? `${folder}/${n}` : n);
	});
}

/** A palette file, asked by name; at the root it lands in palettes/. */
export function askNewPalette(folder: string, open = true): Promise<string | null> {
	return ask(folder ? `Name the new palette in ${folder}/` : "Name the new palette (it lands in palettes/)").then((n) =>
		n ? newPalette(folder ? `${folder}/${n}` : n, open) : null,
	);
}

export function fileMenu(rel: string): MenuItem[] {
	const caps = project.caps.value;
	const isOpen = ed.path.value === rel;
	const items: MenuItem[] = [
		{ label: "Open", disabled: isOpen, run: () => void openDoc(rel) },
		{ label: "Rename…", run: () => void renameFile(rel) },
		{ label: "Duplicate", run: () => void duplicateFile(rel) },
	];
	if (caps.reveal) items.push({ label: `Reveal in ${caps.reveal}`, run: () => void revealFile(rel) });
	items.push({ label: caps.trash ? "Move to Trash" : "Delete", danger: true, sep: true, run: () => void deleteFile(rel) });
	return items;
}

/** A folder's menu; "" is the project itself. */
export function folderMenu(path: string): MenuItem[] {
	const caps = project.caps.value;
	const items: MenuItem[] = [
		{ label: "New file…", run: () => askNewFile(path) },
		{ label: "New palette…", run: () => void askNewPalette(path) },
	];
	if (caps.reveal) items.push({ label: `Reveal in ${caps.reveal}`, run: () => void revealFile(path) });
	if (!path) items.push({ label: "Refresh", sep: true, run: () => void refreshFiles() });
	return items;
}
