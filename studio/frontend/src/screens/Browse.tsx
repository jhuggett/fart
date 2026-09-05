import { useEffect, useRef } from "preact/hooks";
import { project, openDoc, pickFolder, goWelcome, goDocs, goSetup, toggleServe, type Thumb } from "../state/project.ts";
import { setup } from "../state/setup.ts";
import { chat, toggleChat } from "../state/chat.ts";
import { shell } from "../shell/shell.ts";
import { basename, dirname, pretty, stripExt } from "../state/paths.ts";
import { drawThumb } from "../canvas/draw.ts";
import { theme } from "../state/theme.ts";
import { ThemeButton } from "../ui/ThemeMenu.tsx";
import { Explorer, ExplorerButton } from "../ui/Explorer.tsx";
import { fileMenu, folderMenu, askNewFile, askNewPalette } from "../ui/fileMenu.ts";
import { isPaletteFile } from "@fastart/core";
import { openContextMenu } from "../state/menu.ts";

function FileCard({ rel, thumb }: { rel: string; thumb: Thumb | undefined }) {
	const ref = useRef<HTMLCanvasElement>(null);
	const rev = theme.rev.value;
	useEffect(() => {
		if (ref.current && thumb) drawThumb(ref.current, thumb.doc, thumb.tokens);
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
			<canvas ref={ref} />
			<div class="label">
				<div class="n">{stripExt(basename(rel))}</div>
				<div class="d">{[dir ? `${dir}/` : "", pal ? "palette" : ""].filter(Boolean).join(" · ")}</div>
			</div>
		</div>
	);
}

export function Browse() {
	const files = project.files.value;
	const thumbs = project.thumbs.value;
	const serve = project.serve.value;
	const native = shell.kind === "wails";
	const root = project.root.value ?? "";
	return (
		<div class="app">
			<div class="topbar">
				<ExplorerButton />
				<span class="brand">Uranus</span>
				<span class="title">{project.name.value}</span>
				<span class="sub">
					{native ? pretty(root, project.home.value) : "served"} · {files.length} file{files.length === 1 ? "" : "s"}
				</span>
				<div class="spacer" />
				{native && (
					<>
						<button class="btn ghost" onClick={() => void goWelcome()}>
							Projects
						</button>
						<button class="btn ghost" onClick={() => void pickFolder()}>
							Open…
						</button>
						{serve?.on ? (
							<span class="url" title="the editor, on your network — click to stop" onClick={() => void toggleServe()}>
								{serve.url}
							</span>
						) : (
							<button class="btn ghost" title="hand the editor to a tablet on your network" onClick={() => void toggleServe()}>
								Serve
							</button>
						)}
					</>
				)}
				<button class="btn ghost" onClick={() => askNewFile("")}>
					new file
				</button>
				<button class="btn ghost" title="colours other files draw from" onClick={() => void askNewPalette("")}>
					new palette
				</button>
				{shell.chat && (
					<button class={`btn ghost ${chat.open.value ? "active" : ""}`} title="ask Claude  (⌘ J)" onClick={toggleChat}>
						Ask
					</button>
				)}
				<ThemeButton />
				{shell.setup && (
					<button class={`btn ghost ${setup.attention.value ? "attention" : ""}`} title="agents and loaders: what is in place, what to install" onClick={goSetup}>
						Setup
					</button>
				)}
				<button class="btn ghost" onClick={() => goDocs("guide")}>
					Docs
				</button>
			</div>
			<div class="browse-body">
				<Explorer />
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
							No .fart files here yet. "new file" makes one; a name like <code>enemies/bat</code> makes the folder too.
						</div>
					)}
				</div>
			</div>
			{serve?.on && serve.qr && (
				<div class="qr">
					<img src={serve.qr} alt="" />
					scan to open the editor on a tablet
				</div>
			)}
		</div>
	);
}
