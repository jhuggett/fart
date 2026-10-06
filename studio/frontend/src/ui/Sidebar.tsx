// The navigator: the left column. Its header carries its tabs (and the
// traffic lights, on a Mac); under it, the project's assets as a tree
// with a filter and a New asset menu pinned to the bottom, the open
// asset's outline, search, or source control.

import type { ComponentChildren, JSX } from "preact";
import { sidebar, toggleFolder, toggleSidebar, pushAsset, openAsset, tree, showTab, type TreeNode, type SidebarView } from "../state/sidebar.ts";
import { project, openDoc, refreshFiles, goFolder, inlineLights, switchBranch, wantAllThumbs, thumbsRead } from "../state/project.ts";
import { openDocNow } from "../state/doc.ts";
import { nav } from "../state/nav.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { menuAt, type MenuItem } from "../state/menu.ts";
import { run } from "../state/commands.ts";
import { fileMenu, folderMenu } from "./fileMenu.ts";
import { commitSheet, newBranchSheet } from "./Sheets.tsx";
import { kindIcon, kindOf } from "./kinds.ts";
import { Gutter } from "./Gutter.tsx";
import { HelpButton } from "./Help.tsx";
import { BUTTONS } from "../state/help.ts";
import { Button, MenuButton, EmptyState, GroupHeader, NavigatorTabs, PaneHeader, PaneToggle, SidebarRow, TextField, cx, type TabSpec } from "./ur.tsx";

/** New asset: every kind the project can hold. */
export function assetAddMenu(): MenuItem[] {
	return [
		{ label: "2D asset…", icon: "image", keys: "⌘N", run: () => run("file.new") },
		{ label: "3D asset…", icon: "box", run: () => run("file.newModel") },
		{ label: "Palette…", icon: "palette", run: () => run("file.newPalette") },
		{ label: "Scene…", icon: "layout-template", sep: true, run: () => run("file.newScene") },
		{ label: "3D scene…", icon: "layout-template", run: () => run("file.newScene3d") },
	];
}

const badgeOf = (path: string): string | undefined => project.changes.value.find((c) => c.path === path)?.status;

function Row({ node, depth }: { node: TreeNode; depth: number }) {
	const cur = openAsset();
	const focused = sidebar.focus.value === "nav";
	if (node.kind === "folder") {
		const open = sidebar.expanded.value.has(node.path);
		const here = project.screen.value === "browse" && nav.folder.value === node.path;
		return (
			<>
				<SidebarRow
					class="folder"
					label={node.name}
					icon={open ? "folder-open" : "folder"}
					depth={depth}
					expandable
					open={open}
					selected={here}
					inactive={!focused}
					count={node.children.filter((c) => c.kind === "file").length || undefined}
					title={node.path}
					onToggle={() => toggleFolder(node.path)}
					onClick={() => {
						if (!open) toggleFolder(node.path);
						if (project.screen.value === "browse") void goFolder(node.path);
					}}
					onDoubleClick={() => void goFolder(node.path)}
					onContextMenu={(e) => menuAt(e, folderMenu(node.path))}
				/>
				{open && node.children.map((c) => <Row key={c.path} node={c} depth={depth + 1} />)}
			</>
		);
	}
	const active = node.path === cur;
	const picked = !active && nav.selected.value === node.path && project.screen.value === "browse";
	return (
		<SidebarRow
			class="leaf"
			label={stripExt(node.name)}
			icon={kindIcon(node.path, project.thumbs.value.get(node.path))}
			depth={depth}
			selected={active || picked}
			inactive={!focused || picked}
			edited={active && !!openDocNow()?.dirty}
			badge={badgeOf(node.path)}
			title={node.path}
			onClick={() => {
				if (active) pushAsset();
				else void openDoc(node.path);
			}}
			onContextMenu={(e) => menuAt(e, fileMenu(node.path))}
		/>
	);
}

/** The tree, narrowed to the names the filter matches (their folders stay). */
function filtered(node: TreeNode, q: string): TreeNode | null {
	if (node.kind === "file") return node.name.toLowerCase().includes(q) ? node : null;
	const children = node.children.map((c) => filtered(c, q)).filter((c): c is TreeNode => !!c);
	return children.length || (node.path && node.name.toLowerCase().includes(q)) ? { ...node, children } : null;
}

function Assets() {
	const q = nav.filter.value.trim().toLowerCase();
	const root = q ? (filtered(tree(), q) ?? { ...tree(), children: [] }) : tree();
	return (
		<>
			<div class="nav-body ur-tree" role="tree" onContextMenu={(e) => e.target === e.currentTarget && menuAt(e, folderMenu(""))}>
				{root.children.length === 0 && <div class="nav-empty">{q ? "No asset by that name" : "No assets yet"}</div>}
				{q ? root.children.map((c) => <FlatRows key={c.path} node={c} depth={0} />) : root.children.map((c) => <Row key={c.path} node={c} depth={0} />)}
			</div>
			<div class="nav-foot">
				<TextField value={nav.filter.value} icon="search" placeholder="Filter" clearable onChange={(v) => (nav.filter.value = v)} />
				<MenuButton variant="toolbar" icon="plus" title="New asset" items={assetAddMenu} align="right" class="ur-btn-sm" />
				<Button variant="toolbar" icon="refresh-cw" title="Re-read the folder" class="ur-btn-sm" onClick={() => void refreshFiles()} />
			</div>
		</>
	);
}

/** While filtering, every folder that still has a match shows open. */
function FlatRows({ node, depth }: { node: TreeNode; depth: number }) {
	if (node.kind === "file") return <Row node={node} depth={depth} />;
	return (
		<>
			<SidebarRow class="folder" label={node.name} icon="folder-open" depth={depth} expandable open title={node.path} onClick={() => void goFolder(node.path)} onContextMenu={(e) => menuAt(e, folderMenu(node.path))} />
			{node.children.map((c) => (
				<FlatRows key={c.path} node={c} depth={depth + 1} />
			))}
		</>
	);
}

/** Search: assets by name, and the parts, states and clips inside them. */
function Search() {
	const q = nav.query.value.trim().toLowerCase();
	const hits: { rel: string; what: string; name: string }[] = [];
	if (q) {
		// what is inside a file is only known once it has been read
		wantAllThumbs();
		for (const rel of project.files.value) {
			const t = project.thumbs.value.get(rel);
			if (stripExt(basename(rel)).toLowerCase().includes(q)) hits.push({ rel, what: kindOf(rel, t), name: "" });
			const d = t?.doc;
			if (!d || t?.scene) continue;
			for (const p of d.parts ?? []) if (p.name.toLowerCase().includes(q)) hits.push({ rel, what: "part", name: p.name });
			for (const s of d.states ?? []) if (s.name.toLowerCase().includes(q)) hits.push({ rel, what: "state", name: s.name });
			for (const c of d.clips ?? []) if (c.name.toLowerCase().includes(q)) hits.push({ rel, what: "clip", name: c.name });
			for (const c of d.palette ?? []) if (c.name.toLowerCase().includes(q)) hits.push({ rel, what: "colour", name: c.name });
		}
	}
	const cur = openAsset();
	return (
		<>
			<div class="nav-head">
				<TextField value={nav.query.value} icon="search" placeholder="Search the project" clearable autoFocus onChange={(v) => (nav.query.value = v)} />
			</div>
			<div class="nav-body ur-tree" role="tree">
				{!q && <div class="nav-empty">Assets, parts, states, clips and colours, by name</div>}
				{q && thumbsRead.value < 1 && <div class="nav-empty">Reading the project… {Math.round(thumbsRead.value * 100)}%</div>}
				{q && hits.length === 0 && thumbsRead.value >= 1 && <div class="nav-empty">Nothing by that name</div>}
				{hits.slice(0, 200).map((h) => (
					<SidebarRow
						key={`${h.rel}:${h.what}:${h.name}`}
						label={h.name || stripExt(basename(h.rel))}
						icon={h.name ? (h.what === "clip" ? "film" : h.what === "state" ? "circle-dot" : h.what === "colour" ? "palette" : "layers") : kindIcon(h.rel, project.thumbs.value.get(h.rel))}
						chip={h.name ? stripExt(basename(h.rel)) : dirname(h.rel) || undefined}
						current={h.rel === cur}
						title={`${h.what} · ${h.rel}`}
						onClick={() => void openDoc(h.rel)}
					/>
				))}
			</div>
		</>
	);
}

function SourceControl() {
	const changes = project.changes.value;
	const branch = project.branch.value;
	if (!branch) return <EmptyState icon="git-branch" title="Not a repository" message="This project's folder is not in a git repository." />;
	return (
		<>
			<div class="nav-body ur-tree" role="tree">
				<GroupHeader addLabel="New branch…" onAdd={newBranchSheet}>
					Branches
				</GroupHeader>
				{project.branches.value.map((b) => (
					<SidebarRow key={b} label={b} icon="git-branch" selected={b === branch} inactive onClick={() => void switchBranch(b)} />
				))}
				<GroupHeader>Changes</GroupHeader>
				{changes.length === 0 && <div class="nav-empty">Nothing to commit</div>}
				{changes.map((c) => (
					<SidebarRow key={c.path} label={stripExt(basename(c.path))} icon="file" badge={c.status} chip={dirname(c.path) || undefined} title={c.path} onClick={() => project.files.value.includes(c.path) && void openDoc(c.path)} />
				))}
			</div>
			<div class="nav-foot">
				<Button disabled={!changes.length} onClick={commitSheet}>
					Review &amp; commit…
				</Button>
				<span class="spacer" />
				<HelpButton topics={BUTTONS.sourceControl} title="About projects, branches and checkpoints" />
			</div>
		</>
	);
}

/**
 * The column. Each asset screen hands in its outline (parts, states,
 * clips, or a scene's nodes); the navigator decides which tab shows.
 */
export function Sidebar({ children }: { children: ComponentChildren }): JSX.Element | null {
	if (!sidebar.open.value) return null;
	const v = sidebar.view.value;
	const n = project.changes.value.length;
	const tabs: TabSpec<SidebarView>[] = [
		{ id: "assets", icon: "folder", label: "Assets (⌘1)" },
		{ id: "asset", icon: "layers", label: "Outline (⌘2)" },
		{ id: "search", icon: "search", label: "Search (⌘3)" },
		{ id: "git", icon: "git-compare", label: "Source control (⌘4)", badge: n || undefined },
	];
	return (
		<div class={cx("col", "col-nav")} onFocusCapture={() => (sidebar.focus.value = "nav")} onPointerDownCapture={() => (sidebar.focus.value = "nav")}>
			<PaneHeader pane="sidebar" lights={inlineLights()} trailing={<PaneToggle side="left" open onClick={toggleSidebar} />}>
				<NavigatorTabs inline tabs={tabs} value={v} onChange={showTab} label="Navigator" />
			</PaneHeader>
			{v === "assets" && <Assets />}
			{v === "asset" && (openAsset() ? <div class="nav-body ur-tree outline">{children}</div> : <EmptyState icon="layers" title="No asset open" message="Open an asset to see its parts, states and clips." />)}
			{v === "search" && <Search />}
			{v === "git" && <SourceControl />}
			<Gutter k="left" edge="right" />
		</div>
	);
}
