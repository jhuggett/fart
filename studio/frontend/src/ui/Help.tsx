// Help, drawn. The inspector's Help tab answers where you are (the
// screen, and what is chosen on it) with the guide's own sections; a "?"
// anywhere else opens its topics in a sheet over the window.

import { useMemo } from "preact/hooks";
import { marked } from "marked";
import { TOPICS, CONTEXTS, CATEGORIES, contextNow, topic, helpSheet, openHelp, helpSearch, keysSheet, searchHelp } from "../state/help.ts";
import { shortcutsNow, commandRev } from "../state/commands.ts";
import { project } from "../state/project.ts";
import { sc } from "../state/scene.ts";
import { goDocs } from "../state/project.ts";
import { Button, InspectorSection, SidebarRow, Sheet, TextField } from "./ur.tsx";

function Prose({ md }: { md: string }) {
	const html = useMemo(() => marked.parse(md, { async: false }) as string, [md]);
	return <div class="help-prose" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The Help tab of the inspector. */
export function HelpTab() {
	const ctx = contextNow();
	const ids = CONTEXTS[ctx.key] ?? [];
	const rest = TOPICS.filter((t) => !ids.includes(t.id));
	return (
		<div class="inspector help">
			<div class="help-where">
				Help for <b>{ctx.name.charAt(0).toLowerCase() + ctx.name.slice(1)}</b>
			</div>
			{ids.map((id, i) => {
				const t = topic(id);
				return (
					t && (
						<InspectorSection key={`${ctx.key}:${id}`} title={t.title} defaultOpen={i === 0}>
							<Prose md={t.md} />
						</InspectorSection>
					)
				);
			})}
			<InspectorSection key="more" title="More help" defaultOpen={false}>
				<div class="insp-actions">
					<Button icon="search" onClick={() => (helpSearch.value = "")}>
						Search help…
					</Button>
					<Button shortcut="⌘/" onClick={() => (keysSheet.value = true)}>
						Keyboard shortcuts
					</Button>
				</div>
				<div class="ur-tree help-more">
					{rest.map((t) => (
						<SidebarRow key={t.id} label={t.title} icon="circle-help" onClick={() => openHelp([t.id])} />
					))}
				</div>
				<div class="insp-actions">
					<Button icon="book-open" onClick={() => goDocs("guide")}>
						The whole guide
					</Button>
					<Button onClick={() => goDocs("format")}>The format</Button>
				</div>
			</InspectorSection>
		</div>
	);
}

/** A "?" for a place the inspector's Help tab does not reach: opens these topics in a sheet. */
export function HelpButton({ topics, title }: { topics: string[]; title?: string }) {
	return <Button variant="toolbar" class="ur-btn-sm help-button" icon="circle-help" title={title ?? "Help"} onClick={() => openHelp(topics)} />;
}

/** The sheet a "?" opens. */
export function HelpSheet() {
	const ids = helpSheet.value;
	if (!ids?.length) return null;
	const close = () => (helpSheet.value = null);
	const topics = ids.map(topic).filter((t): t is NonNullable<typeof t> => !!t);
	return (
		<Sheet
			title={topics.length === 1 ? topics[0].title : "Help"}
			width={620}
			onClose={close}
			actions={[
				{ label: "The whole guide", onClick: () => (close(), goDocs("guide")) },
				{ label: "Done", primary: true, onClick: close },
			]}
		>
			<div class="help-sheet">
				{topics.map((t) => (
					<section key={t.id}>
						{topics.length > 1 && <h3>{t.title}</h3>}
						<Prose md={t.md} />
					</section>
				))}
			</div>
		</Sheet>
	);
}

/** Search Help…: the guide, by word. A result opens its topic. */
export function HelpSearchSheet() {
	const q = helpSearch.value;
	if (q === null) return null;
	const close = () => (helpSearch.value = null);
	const hits = searchHelp(q);
	return (
		<Sheet title="Search help" width={560} onClose={close} actions={[{ label: "Done", primary: true, onClick: () => (hits.length === 1 ? openHelp([hits[0].id]) : close()) }]}>
			<TextField value={q} icon="search" autoFocus clearable placeholder="A word or two: pivot, clip, palette…" onChange={(v) => (helpSearch.value = v)} />
			<div class="help-results ur-tree">
				{q.trim() === "" &&
					CATEGORIES.map((c) => <SidebarRow key={c.id} label={c.title} icon="book-open" count={c.topics.length} onClick={() => openHelp(c.topics)} />)}
				{q.trim() !== "" && hits.length === 0 && <div class="nav-empty">Nothing in the guide says that</div>}
				{hits.map((h) => (
					<div key={h.id} class="help-hit" role="button" tabIndex={0} onClick={() => openHelp([h.id])} onKeyDown={(e) => e.key === "Enter" && (e.stopPropagation(), e.preventDefault(), openHelp([h.id]))}>
						<div class="help-hit-title">{h.title}</div>
						<div class="help-hit-text">{h.snippet}</div>
					</div>
				))}
			</div>
		</Sheet>
	);
}

/** What the pointer does on each kind of screen: the gestures no keymap lists. */
function gestures(screen: string, in3d: boolean): { keys: string[]; title: string }[] {
	if (screen === "browse") return [
		{ keys: ["Click"], title: "Pick an asset" },
		{ keys: ["Double-click", "Return"], title: "Open it" },
		{ keys: ["Right-click"], title: "Rename, duplicate, reveal, delete" },
	];
	const out = [
		{ keys: ["Space drag"], title: "Pan" },
		{ keys: ["Pinch", "⌘ Scroll"], title: "Zoom at the cursor" },
		{ keys: ["Drag on nothing"], title: "Marquee: choose what it touches" },
		{ keys: ["⇧ Click"], title: "Add to what is chosen, or take out" },
		{ keys: ["Right-click"], title: "The short list for what is under the pointer" },
	];
	if (in3d)
		out.unshift(
			{ keys: ["Middle drag", "Two fingers", "⌥ Drag"], title: "Orbit about what is chosen (⌘ tumbles freely)" },
			{ keys: ["⇧ Middle drag", "⇧ Two fingers"], title: "Pan" },
			{ keys: ["Mouse wheel"], title: "Zoom at the cursor" },
			{ keys: ["G", "T", "S"], title: "Move, turn, size; then X Y Z holds an axis, digits are the amount" },
			{ keys: ["Return", "Esc"], title: "Keep a transform, put it back" },
		);
	else out.unshift({ keys: ["Scroll", "Middle drag"], title: "Pan" }, { keys: ["⌥ Drag"], title: "Drag away a copy" }, { keys: ["⇧ Drag"], title: "Constrain: 45° lines, square rects" });
	if (screen === "scene" && !in3d) out.unshift({ keys: ["G", "T", "S"], title: "Move, turn, size the chosen nodes; X Y hold an axis, digits are the amount" });
	return out;
}

const SCREENS: Record<string, string> = { browse: "the asset browser", edit: "the 2D editor", model: "the 3D model view", scene: "a scene", welcome: "the welcome window", docs: "the docs", setup: "settings" };

/** Keyboard shortcuts: the ones that do something on this screen, by group, and what the pointer does here. */
export function KeysSheet() {
	void commandRev.value;
	if (!keysSheet.value) return null;
	const close = () => (keysSheet.value = false);
	const screen = project.screen.value;
	const in3d = screen === "model" || (screen === "scene" && sc.scene.value.space === "3d");
	const groups = [...shortcutsNow(in3d)];
	const g = gestures(screen, in3d);
	if (screen !== "welcome" && screen !== "docs" && screen !== "setup") groups.unshift({ group: "Pointer", rows: g });
	return (
		<Sheet title="Keyboard shortcuts" message={`What the keys and the pointer do in ${SCREENS[screen] ?? "Uranus"}${in3d && screen === "scene" ? " (3D)" : ""}. Every command is also in ⌘K.`} width={720} onClose={close} actions={[{ label: "Done", primary: true, onClick: close }]}>
			<div class="keys-sheet">
				{groups.map((grp) => (
					<section key={grp.group}>
						<h3>{grp.group}</h3>
						{grp.rows.map((r) => (
							<div class="keys-row" key={r.title}>
								<span class="keys-title">{r.title}</span>
								<span class="keys-keys">
									{r.keys.map((k) => (
										<kbd key={k}>{k}</kbd>
									))}
								</span>
							</div>
						))}
					</section>
				))}
			</div>
		</Sheet>
	);
}
