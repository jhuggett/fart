// The inspector: the right column. Its header carries its tabs; under
// it, the selection (each screen's own), the view's settings, the
// history of the open asset, or Ask.

import type { ComponentChildren } from "preact";
import { sidebar, toggleInspector, showInspectorTab, type InspectorTab } from "../state/sidebar.ts";
import { openDocNow } from "../state/doc.ts";
import { activity, ago } from "../state/activity.ts";
import { view } from "../canvas/view.ts";
import { run } from "../state/commands.ts";
import { shell } from "../shell/shell.ts";
import { basename, stripExt } from "../state/paths.ts";
import { ChatPanel } from "./ChatPanel.tsx";
import { HelpTab } from "./Help.tsx";
import { Gutter } from "./Gutter.tsx";
import { Button, Checkbox, EmptyState, Icon, InspectorSection, NavigatorTabs, NumberField, PaneHeader, PaneToggle, Property, type TabSpec } from "./ur.tsx";

const clock = (t: number) => (t ? new Date(t).toLocaleTimeString([], { hour12: false }) : "never");

function History() {
	const d = openDocNow();
	const log = activity.log.value;
	return (
		<div class="inspector">
			{d && (
				<InspectorSection title="Checkpoint" hint="the file on disk is the document; a checkpoint is the version Revert goes back to">
					<Property label="Asset">
						<span class="ur-prop-val">{stripExt(basename(d.path))}</span>
					</Property>
					<Property label="State">
						<span class="ur-prop-val">{d.dirty ? "Edited since the checkpoint" : "At its checkpoint"}</span>
					</Property>
					<Property label="Checkpoint">
						<span class="ur-prop-val ur-mono">{clock(d.checkpointAt)}</span>
					</Property>
					<Property label="On disk">
						<span class="ur-prop-val ur-mono">{clock(d.written)}</span>
					</Property>
					<div class="insp-actions">
						<Button icon="undo-2" shortcut="⌘Z" onClick={() => run("edit.undo")}>
							Undo
						</Button>
						<Button icon="redo-2" shortcut="⇧⌘Z" onClick={() => run("edit.redo")}>
							Redo
						</Button>
						<Button disabled={!d.dirty} onClick={() => run("file.revert")}>
							Revert
						</Button>
						<Button shortcut="⌘S" onClick={() => run("file.save")}>
							Save
						</Button>
					</div>
				</InspectorSection>
			)}
			<InspectorSection title="Activity">
				{log.length === 0 && <div class="insp-hint flush">Saves, commits and file operations show up here</div>}
				<div class="ur-log">
					{log.map((l) => (
						<div class="ur-log-row" key={l.at}>
							<Icon name={l.icon ?? "circle-dot"} size={14} />
							<span class="ur-log-text" title={l.text}>
								{l.text}
							</span>
							<span class="ur-log-time">{ago(l.at)}</span>
						</div>
					))}
				</div>
			</InspectorSection>
		</div>
	);
}

/** The view settings every canvas shares: zoom and the grid. Screens put their own above it. */
export function CanvasView({ children }: { children?: ComponentChildren }) {
	return (
		<div class="inspector">
			{children}
			<InspectorSection title="Canvas">
				<Property label="Zoom">
					<NumberField value={Math.round(view.zoom.value * 10) / 10} min={0.1} step={1} suffix="×" onChange={(v) => (view.zoom.value = v)} />
				</Property>
				<Property label="">
					<Checkbox checked={view.snapGrid.value} label="Snap to grid" onChange={() => run("view.snapGrid")} />
				</Property>
				<div class="insp-actions">
					<Button shortcut="⇧1" onClick={() => run("view.fit")}>
						Fit
					</Button>
					<Button shortcut="⇧0" onClick={() => run("view.zoom100")}>
						Actual size
					</Button>
				</div>
			</InspectorSection>
		</div>
	);
}

/** The column. `inspector` and `view` come from whichever screen is up. */
export function InspectorPane({ inspector, view: viewTab }: { inspector: ComponentChildren; view: ComponentChildren }) {
	if (!sidebar.inspector.value) return null;
	const tab = sidebar.tab.value === "ask" && !shell.chat ? "inspector" : sidebar.tab.value;
	const tabs: TabSpec<InspectorTab>[] = [
		{ id: "inspector", icon: "sliders-horizontal", label: "Inspector" },
		{ id: "view", icon: "eye", label: "View" },
		{ id: "history", icon: "history", label: "History" },
	];
	if (shell.chat) tabs.push({ id: "ask", icon: "message-square", label: "Ask (⌘J)" });
	tabs.push({ id: "help", icon: "circle-help", label: "Help (?)" });
	return (
		<div class="col col-insp" onFocusCapture={() => (sidebar.focus.value = "insp")}>
			<PaneHeader pane="sidebar" trailing={<PaneToggle side="right" open onClick={toggleInspector} />}>
				<NavigatorTabs inline tabs={tabs} value={tab} onChange={showInspectorTab} label="Inspector" />
			</PaneHeader>
			<div class="insp-body">
				{tab === "inspector" && inspector}
				{tab === "view" && (viewTab ?? <EmptyState icon="eye" title="Nothing to set" />)}
				{tab === "history" && <History />}
				{tab === "ask" && <ChatPanel />}
				{tab === "help" && <HelpTab />}
			</div>
			<Gutter k="right" edge="left" />
		</div>
	);
}
