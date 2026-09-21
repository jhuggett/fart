// The sidebar: the assets at its root, the open asset's insides one push
// deeper. One header row each, with an Add menu; back is a chevron.

import type { ComponentChildren } from "preact";
import type { JSX } from "preact";
import { sidebar, toggleFolder, popToAssets, pushAsset, openAsset, tree, type TreeNode } from "../state/sidebar.ts";
import { project, openDoc, refreshFiles, assetHome } from "../state/project.ts";
import { ed } from "../state/editor.ts";
import { md } from "../state/model.ts";
import { basename, stripExt } from "../state/paths.ts";
import { openContextMenu, openMenuBelow, type MenuItem } from "../state/menu.ts";
import { run } from "../state/commands.ts";
import { fileMenu, folderMenu, askNewFile } from "./fileMenu.ts";
import { Gutter } from "./Gutter.tsx";
import { I } from "./Icons.tsx";

function menuAt(e: MouseEvent, items: MenuItem[]) {
	e.preventDefault();
	e.stopPropagation();
	openContextMenu(e.clientX, e.clientY, items);
}

/** The Add menu at the assets root: every kind of asset the project can hold. */
export function assetAddMenu(): MenuItem[] {
	return [
		{ label: "Asset", keys: "⌘N", run: () => run("file.new") },
		{ label: "3D Asset", run: () => run("file.newModel") },
		{ label: "Palette", run: () => run("file.newPalette") },
		{ label: "Scene", sep: true, run: () => run("file.newScene") },
		{ label: "3D Scene", run: () => run("file.newScene3d") },
	];
}

function Row({ node, depth }: { node: TreeNode; depth: number }) {
	const cur = openAsset();
	if (node.kind === "folder") {
		const open = sidebar.expanded.value.has(node.path);
		return (
			<>
				<div class="tree-row folder" style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => toggleFolder(node.path)} onContextMenu={(e) => menuAt(e, folderMenu(node.path))}>
					<span class={`caret ${open ? "open" : ""}`}>▸</span>
					<span class="name">{node.name}</span>
					<button
						class="btn x plus"
						title={`new asset in ${node.path}/`}
						onClick={(e) => {
							e.stopPropagation();
							askNewFile(node.path);
						}}
					>
						+
					</button>
				</div>
				{open && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} />)}
			</>
		);
	}
	const active = node.path === cur;
	const dirty = active && (ed.dirty.value || md.dirty.value);
	return (
		<div
			class={`tree-row leaf ${active ? "active" : ""}`}
			style={{ paddingLeft: `${8 + depth * 14}px` }}
			title={node.path}
			onClick={() => {
				if (active) pushAsset();
				else void openDoc(node.path);
			}}
			onContextMenu={(e) => menuAt(e, fileMenu(node.path))}
		>
			<span class="glyph">{node.path.endsWith(".shart") ? "▣" : "◆"}</span>
			<span class="name">{stripExt(node.name)}</span>
			{dirty && <span class="dot" title="changed since its checkpoint: the file on disk is current; ⌘S keeps this version" />}
			{active && <I.chevron size={11} />}
		</div>
	);
}

/** The assets root: the header, then the tree. */
function Assets() {
	const root = tree();
	const home = assetHome();
	return (
		<>
			<div class="side-hdr">
				<span class="t" title={project.root.value ?? ""}>
					Assets
				</span>
				<span class="spacer" />
				<button class="btn x plain" title={`add an asset${home ? ` (in ${home}/)` : ""}`} onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, assetAddMenu())}>
					<I.plus size={13} />
				</button>
				<button class="btn x plain" title="re-read the folder" onClick={() => void refreshFiles()}>
					<I.refresh size={13} />
				</button>
			</div>
			<div class="side-body" onContextMenu={(e) => e.target === e.currentTarget && menuAt(e, folderMenu(""))}>
				{root.children.length === 0 && <div class="empty">no assets yet · + makes one</div>}
				{root.children.map((c) => (
					<Row key={c.path} node={c} depth={0} />
				))}
			</div>
		</>
	);
}

/**
 * The frame. Each asset screen hands in its insides (lists) and its Add
 * menu; the sidebar decides which level shows.
 */
export function Sidebar({ children, add }: { children: ComponentChildren; add: MenuItem[] }): JSX.Element | null {
	if (!sidebar.open.value) return null;
	const asset = openAsset();
	const inAsset = sidebar.view.value === "asset" && asset;
	return (
		<div class="dock sidebar-dock">
			<div class="sidebar">
				{inAsset ? (
					<>
						<div class="side-hdr">
							<button class="btn x plain" title="back to the assets" onClick={popToAssets}>
								<I.back size={14} />
							</button>
							<span class="t" title={asset}>
								{stripExt(basename(asset))}
							</span>
							<span class="spacer" />
							{add.length > 0 && (
								<button class="btn x plain" title="add to this asset" onClick={(e) => openMenuBelow(e.currentTarget as HTMLElement, add)}>
									<I.plus size={13} />
								</button>
							)}
						</div>
						<div class="side-body panel-lists">{children}</div>
					</>
				) : (
					<Assets />
				)}
			</div>
			<Gutter k="left" edge="right" />
		</div>
	);
}
