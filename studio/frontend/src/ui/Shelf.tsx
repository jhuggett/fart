// The asset browser: the project's assets as tiles, in the content
// column when nothing is open. Click picks one (the inspector shows it),
// a double click or Return opens it; the path bar filters by kind and
// the navigator's field by name.

import { useEffect, useRef, useState } from "preact/hooks";
import { project, openDoc, wantThumb, type Thumb } from "../state/project.ts";
import { nav } from "../state/nav.ts";
import { sidebar } from "../state/sidebar.ts";
import { basename, dirname, stripExt } from "../state/paths.ts";
import { fileMenu, folderMenu } from "./fileMenu.ts";
import { menuAt } from "../state/menu.ts";
import { run } from "../state/commands.ts";
import { kindOf, kindBucket } from "./kinds.ts";
import { assetAddMenu } from "./Sidebar.tsx";
import { AssetTile, EmptyState, Icon, KIND_ICON, MenuButton, SegmentedControl, cx } from "./ur.tsx";

// One observer for every tile: a tile's file is read, and its picture
// shown, only once it is on screen or about to be.
const seen = new Map<Element, () => void>();
const watcher =
	typeof IntersectionObserver === "undefined"
		? null
		: new IntersectionObserver(
				(entries) => {
					for (const e of entries) {
						if (!e.isIntersecting) continue;
						seen.get(e.target)?.();
						seen.delete(e.target);
						watcher!.unobserve(e.target);
					}
				},
				{ rootMargin: "300px" },
			);

/** A tile's picture: the kind's glyph until the tile nears the screen and its file has been read. */
function LazyThumb({ rel, thumb }: { rel: string; thumb: Thumb | undefined }) {
	const box = useRef<HTMLSpanElement>(null);
	const [near, setNear] = useState(!watcher);
	useEffect(() => {
		const el = box.current;
		if (!el || near || !watcher) return;
		seen.set(el, () => setNear(true));
		watcher.observe(el);
		return () => {
			seen.delete(el);
			watcher.unobserve(el);
		};
	}, [near]);
	useEffect(() => {
		if (near) wantThumb(rel);
	}, [near, rel]);
	return (
		<span class="thumb-slot" ref={box}>
			{near && thumb?.image ? <img src={thumb.image} alt="" draggable={false} /> : <Icon name={KIND_ICON[kindOf(rel, thumb)]} size={40} strokeWidth={1.25} />}
		</span>
	);
}

/** The assets the browser shows now: the folder, the kind, the filter, the sort. */
export function browsed(): string[] {
	const folder = nav.folder.value;
	const q = nav.filter.value.trim().toLowerCase();
	const kind = nav.kind.value;
	const thumbs = project.thumbs.value;
	const out = project.files.value.filter((rel) => {
		const dir = dirname(rel);
		if (folder && dir !== folder && !(nav.subfolders.value && dir.startsWith(`${folder}/`))) return false;
		if (!folder && !nav.subfolders.value && dir) return false;
		if (q && !stripExt(basename(rel)).toLowerCase().includes(q)) return false;
		return kind === "all" || kindBucket(kindOf(rel, thumbs.get(rel))) === kind;
	});
	const name = (rel: string) => stripExt(basename(rel));
	if (nav.sort.value === "Kind") out.sort((a, b) => kindOf(a, thumbs.get(a)).localeCompare(kindOf(b, thumbs.get(b))) || name(a).localeCompare(name(b)));
	else out.sort((a, b) => name(a).localeCompare(name(b)));
	return out;
}

/** The path bar's right side in the browser: the kind filter, New asset…. */
export function BrowserTools() {
	return (
		<>
			<SegmentedControl
				label="Kind"
				value={nav.kind.value}
				onChange={(v) => (nav.kind.value = v)}
				options={[
					{ value: "all", label: "All" },
					{ value: "2D", label: "2D" },
					{ value: "3D", label: "3D" },
					{ value: "scene", label: "Scenes" },
					{ value: "palette", label: "Palettes" },
				]}
			/>
			<span class="ur-pathbar-sep" />
			<MenuButton icon="plus" items={assetAddMenu} align="right" title="New asset">
				New asset…
			</MenuButton>
		</>
	);
}

export function Shelf() {
	const files = browsed();
	const thumbs = project.thumbs.value;
	const folder = nav.folder.value;
	const sel = nav.selected.value;
	const size = nav.size.value;
	const all = project.files.value.length;
	return (
		<div
			class={cx("browser", `size-${size}`)}
			onFocusCapture={() => (sidebar.focus.value = "content")}
			onClick={(e) => e.target === e.currentTarget && (nav.selected.value = null)}
			onContextMenu={(e) => e.target === e.currentTarget && menuAt(e, folderMenu(folder))}
		>
			{files.length > 0 && (
				<div class="ur-grid" role="listbox" aria-label="Assets" onClick={(e) => e.target === e.currentTarget && (nav.selected.value = null)}>
					{files.map((rel) => {
						const t = thumbs.get(rel);
						const dir = dirname(rel);
						return (
							<AssetTile
								key={rel}
								name={stripExt(basename(rel))}
								kind={kindOf(rel, t)}
								folder={dir && dir !== folder ? (folder ? dir.slice(folder.length + 1) : dir) : undefined}
								thumbnail={<LazyThumb rel={rel} thumb={t} />}
								selected={rel === sel}
								compact={size === "S"}
								title={rel}
								onClick={() => (nav.selected.value = rel)}
								onOpen={() => void openDoc(rel)}
								onContextMenu={(e) => {
									nav.selected.value = rel;
									menuAt(e, fileMenu(rel));
								}}
							/>
						);
					})}
				</div>
			)}
			{files.length === 0 && !project.busy.value && (
				<EmptyState icon="package" title={all ? "No assets match" : "No assets yet"} message={all ? "Nothing here fits the kind and the filter." : "An asset is one .fart file: a sprite, a model, a palette, a scene."}>
					{all === 0 || (!nav.filter.value && nav.kind.value === "all") ? (
						<button type="button" class="ur-btn" onClick={() => run("file.new")}>
							New asset…
						</button>
					) : (
						<button type="button" class="ur-btn" onClick={() => ((nav.filter.value = ""), (nav.kind.value = "all"))}>
							Show everything
						</button>
					)}
				</EmptyState>
			)}
		</div>
	);
}
