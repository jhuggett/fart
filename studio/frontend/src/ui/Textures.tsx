// The textures of a file (1.5): each a name, a cell, and its maps, every
// map a drawing of the project. The same panel serves the 2D inspector
// and the model screen; the store's edits come in as props.

import { useState } from "preact/hooks";
import type { Texture, TextureMap } from "@fastart/core";
import { I } from "./Icons.tsx";
import { Num } from "./Field.tsx";
import { InlineName } from "./Rename.tsx";
import { project, openDoc, paletteFiles } from "../state/project.ts";
import { dirname, joinRel, stripExt, basename } from "../state/paths.ts";
import { openContextMenu } from "../state/menu.ts";

export interface TexturesApi {
	textures: Texture[];
	/** the open file's project path, for refs */
	rel: string;
	add: (name: string, ref: string) => number;
	remove: (i: number) => void;
	rename: (i: number, name: string) => void;
	cell: (i: number, axis: 0 | 1, v: number) => void;
	map: (i: number, map: string, patch: Partial<TextureMap>) => void;
	addMap: (i: number, map: string) => void;
	removeMap: (i: number, map: string) => void;
	freshName: (base: string, taken: Iterable<string>) => string;
}

/** 2D art files of the project, as refs relative to the open file. */
function drawingRefs(rel: string): { ref: string; label: string }[] {
	const dir = dirname(rel);
	const out: { ref: string; label: string }[] = [];
	for (const [file, t] of project.thumbs.value) {
		if (file === rel || t.space3d || !t.doc.parts) continue;
		out.push({ ref: relTo(dir, file), label: stripExt(file) });
	}
	return out.sort((a, b) => a.label.localeCompare(b.label));
}
function relTo(fromDir: string, file: string): string {
	const a = fromDir ? fromDir.split("/") : [];
	const b = file.split("/");
	let i = 0;
	while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
	return [...a.slice(i).map(() => ".."), ...b.slice(i)].join("/");
}

export function TexturesPanel({ api }: { api: TexturesApi }) {
	const [renaming, setRenaming] = useState<number | null>(null);
	const [newMap, setNewMap] = useState<number | null>(null);
	const refs = drawingRefs(api.rel);
	const pals = paletteFiles().map((f) => ({ ref: relTo(dirname(api.rel), f), label: stripExt(basename(f)) }));
	return (
		<>
			<div class="hdr" title="textures: each a set of maps, every map a drawing of the project tiled over a cell. The colour map is what is painted; the rest are the game's.">
				Textures
			</div>
			{api.textures.map((t, i) => (
				<div class="tex" key={t.name}>
					<div
						class="row"
						onDblClick={() => setRenaming(i)}
						onContextMenu={(e) => {
							e.preventDefault();
							openContextMenu(e.clientX, e.clientY, [
								{ label: "Rename", run: () => setRenaming(i) },
								{ label: "Add map…", run: () => setNewMap(i) },
								{ label: "Delete texture", danger: true, sep: true, run: () => api.remove(i) },
							]);
						}}
					>
						{renaming === i ? (
							<InlineName value={t.name} onCommit={(n) => (api.rename(i, n), setRenaming(null))} onCancel={() => setRenaming(null)} />
						) : (
							<span class="name">{t.name}</span>
						)}
						<span class="tail">
							<button class="btn x" title="delete texture" onClick={() => api.remove(i)}>
								×
							</button>
						</span>
					</div>
					<div class="fields">
						<Num label="cell w" value={t.cell[0]} min={0.01} onChange={(v) => api.cell(i, 0, v)} />
						<Num label="h" value={t.cell[1]} min={0.01} onChange={(v) => api.cell(i, 1, v)} />
					</div>
					{Object.entries(t.maps).map(([name, m]) => (
						<div class="map" key={name} title={`the ${name} map: a drawing of the project, tiled`}>
							<div class="line">
								<span class="k">{name}</span>
								<select class="num" value={m.ref} onChange={(e) => api.map(i, name, { ref: (e.target as HTMLSelectElement).value })} title="the drawing">
									{!refs.some((r) => r.ref === m.ref) && <option value={m.ref}>{m.ref}</option>}
									{refs.map((r) => (
										<option value={r.ref}>{r.label}</option>
									))}
								</select>
								<button class="btn small ghost" title="open the drawing" onClick={() => void openDoc(joinRel(dirname(api.rel), m.ref))}>
									open
								</button>
								{Object.keys(t.maps).length > 1 && (
									<button class="btn x" title="delete map" onClick={() => api.removeMap(i, name)}>
										×
									</button>
								)}
							</div>
							<div class="line">
								<span class="k">palette</span>
								<select class="num" value={m.palette ?? ""} onChange={(e) => api.map(i, name, { palette: (e.target as HTMLSelectElement).value })} title="a palette laid over the drawing's colours: the same drawing as another map">
									<option value="">the drawing's own</option>
									{m.palette && !pals.some((p) => p.ref === m.palette) && <option value={m.palette}>{m.palette}</option>}
									{pals.map((p) => (
										<option value={p.ref}>{p.label}</option>
									))}
								</select>
								<span class="k">state</span>
								<input class="num text" value={m.state ?? ""} placeholder="first" onInput={(e) => api.map(i, name, { state: (e.target as HTMLInputElement).value })} onKeyDown={(e) => e.stopPropagation()} title="which of the drawing's states; empty for its first" />
								<select class="num" value={m.mode ?? "paint"} onChange={(e) => api.map(i, name, { mode: (e.target as HTMLSelectElement).value as TextureMap["mode"] })} title="paint: its colours over the token; mask: the token times its value">
									<option value="paint">paint</option>
									<option value="mask">mask</option>
								</select>
							</div>
						</div>
					))}
					{newMap === i ? (
						<InlineName value="" onCommit={(n) => (api.addMap(i, n), setNewMap(null))} onCancel={() => setNewMap(null)} />
					) : (
						<button class="add-row" onClick={() => setNewMap(i)} title="another map of this texture: height, glow, rough, whatever the game reads">
							<I.plus size={11} /> map
						</button>
					)}
				</div>
			))}
			<button
				class="add-row"
				disabled={!refs.length}
				title={refs.length ? "a texture: a drawing of the project, tiled" : "draw a 2D file in the project first; a texture's maps are drawings"}
				onClick={() => {
					const i = api.add(api.freshName("texture", api.textures.map((t) => t.name)), refs[0].ref);
					setRenaming(i);
				}}
			>
				<I.plus size={11} /> texture
			</button>
		</>
	);
}
