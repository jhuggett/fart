import { explorer, toggleExplorer, toggleFolder, tree, type TreeNode } from "../state/explorer.ts";
import { project, openDoc, refreshFiles, goBrowse } from "../state/project.ts";
import { I } from "./Icons.tsx";
import { ed } from "../state/editor.ts";
import { stripExt } from "../state/paths.ts";
import { openContextMenu } from "../state/menu.ts";
import { fileMenu, folderMenu, askNewFile } from "./fileMenu.ts";

function menuAt(e: MouseEvent, items: ReturnType<typeof fileMenu>) {
	e.preventDefault();
	e.stopPropagation();
	openContextMenu(e.clientX, e.clientY, items);
}

function Row({ node, depth }: { node: TreeNode; depth: number }) {
	const cur = ed.path.value;
	if (node.kind === "folder") {
		const open = explorer.expanded.value.has(node.path);
		return (
			<>
				<div class="tree-row folder" style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => toggleFolder(node.path)} onContextMenu={(e) => menuAt(e, folderMenu(node.path))}>
					<span class={`caret ${open ? "open" : ""}`}>▸</span>
					<span class="name">{node.name}</span>
					<button
						class="btn x plus"
						title={`new file in ${node.path}/`}
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
	return (
		<div
			class={`tree-row leaf ${active ? "active" : ""}`}
			style={{ paddingLeft: `${8 + depth * 14}px` }}
			title={node.path}
			onClick={() => {
				if (!active) void openDoc(node.path);
			}}
			onContextMenu={(e) => menuAt(e, fileMenu(node.path))}
		>
			<span class="glyph">◆</span>
			<span class="name">{stripExt(node.name)}</span>
			{active && ed.dirty.value && <span class="dot" title="changed since its checkpoint: the file on disk is current; ⌘S keeps this version, File › Revert goes back" />}
		</div>
	);
}

/** The file tree. Renders nothing while closed; Cmd+B or the ☰ button brings it back. */
export function Explorer() {
	if (!explorer.open.value) return null;
	void ed.rev.value;
	const root = tree();
	return (
		<div class="explorer">
			<div class="hdr">
				Explorer
				<span class="hint">
					<button class="btn x plain" title="new file" onClick={() => askNewFile("")}>
						+
					</button>
					<button class="btn x plain" title="refresh" onClick={() => void refreshFiles()}>
						↻
					</button>
					<button class="btn x plain" title="hide  (Cmd+B)" onClick={toggleExplorer}>
						‹
					</button>
				</span>
			</div>
			<div
				class={`tree-row project ${project.screen.value === "edit" ? "link" : ""}`}
				title={project.screen.value === "edit" ? "back to the shelf  (⌘ O)" : (project.root.value ?? "")}
				onClick={() => project.screen.value === "edit" && void goBrowse()}
				onContextMenu={(e) => menuAt(e, folderMenu(""))}
			>
				<I.grid size={12} />
				<span class="name">{project.name.value || "project"}</span>
				{project.screen.value === "edit" && <span class="chip">shelf</span>}
			</div>
			{root.children.length === 0 && <div class="empty">no .fart files yet</div>}
			{root.children.map((c) => (
				<Row key={c.path} node={c} depth={0} />
			))}
		</div>
	);
}

/** The toggle for a top bar. */
export function ExplorerButton() {
	return (
		<button class={`btn ghost ${explorer.open.value ? "active" : ""}`} title="explorer  (Cmd+B)" onClick={toggleExplorer}>
			☰
		</button>
	);
}
