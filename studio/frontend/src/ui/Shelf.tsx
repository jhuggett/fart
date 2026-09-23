// The shelf: every asset of the project as a thumbnail, on the canvas
// when nothing is open. Click one to open it; right-click for its menu.

import { useEffect, useRef } from "preact/hooks";
import { isPaletteFile } from "@fastart/core";
import { project, openDoc, type Thumb } from "../state/project.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { drawThumb } from "../canvas/draw.ts";
import { drawSceneThumb } from "../canvas/scene3.ts";
import { theme } from "../state/theme.ts";
import { fileMenu, folderMenu } from "./fileMenu.ts";
import { openContextMenu } from "../state/menu.ts";

function FileCard({ rel, thumb }: { rel: string; thumb: Thumb | undefined }) {
	const ref = useRef<HTMLCanvasElement>(null);
	const rev = theme.rev.value;
	useEffect(() => {
		if (ref.current && thumb) {
			if (thumb.scene) drawSceneThumb(ref.current, { placed: thumb.scene.placed, space3d: !!thumb.space3d });
			else drawThumb(ref.current, thumb.doc, thumb.tokens);
		}
	}, [thumb, rev]);
	const dir = dirname(rel);
	const pal = thumb ? isPaletteFile(thumb.doc) : false;
	return (
		<div
			class="shelf-card"
			onClick={() => void openDoc(rel)}
			onContextMenu={(e) => {
				e.preventDefault();
				openContextMenu(e.clientX, e.clientY, fileMenu(rel));
			}}
		>
			<div class="thumb">
				<canvas ref={ref} />
			</div>
			<div class="label">
				<div class="n">{stripExt(basename(rel))}</div>
				<div class="d">{[dir ? `${dir}/` : "", pal ? "palette" : "", thumb?.scene ? (thumb.space3d ? "3D scene" : "scene") : thumb?.space3d ? "3D" : ""].filter(Boolean).join(" · ")}</div>
			</div>
		</div>
	);
}

export function Shelf() {
	const files = project.files.value;
	const thumbs = project.thumbs.value;
	return (
		<div
			class="shelf"
			onContextMenu={(e) => {
				if (e.target !== e.currentTarget) return;
				e.preventDefault();
				openContextMenu(e.clientX, e.clientY, folderMenu(""));
			}}
		>
			{files.map((rel) => (
				<FileCard key={rel} rel={rel} thumb={thumbs.get(rel)} />
			))}
			{files.length === 0 && !project.busy.value && (
				<div class="empty" style="grid-column: 1 / -1">
					No assets yet. The + in the sidebar makes one; a name like <code>enemies/bat</code> makes the folder too.
				</div>
			)}
		</div>
	);
}
