// The workspace: one window, three columns, three headers. The navigator
// on the left (assets, the open asset's outline, search, source control),
// the content in the middle under its header and path bar and over its
// status bar, the inspector on the right. Nothing floats over the canvas:
// each asset screen hands in its outline, its tools for the path bar, its
// canvas, its status line, its inspector and its view settings.

import type { ComponentChildren } from "preact";
import { project } from "../state/project.ts";
import { sidebar } from "../state/sidebar.ts";
import { ed } from "../state/editor.ts";
import { md } from "../state/model.ts";
import { sc, is3d } from "../state/scene.ts";
import { nav } from "../state/nav.ts";
import { view } from "../canvas/view.ts";
import { run } from "../state/commands.ts";
import { Sidebar } from "../ui/Sidebar.tsx";
import { ContentHeader, JumpBar } from "../ui/ProjectBar.tsx";
import { InspectorPane, CanvasView } from "../ui/InspectorPane.tsx";
import { Shelf, BrowserTools, browsed } from "../ui/Shelf.tsx";
import { ProjectInspector, BrowserView } from "../ui/ProjectInspector.tsx";
import { StatusBar, cx } from "../ui/ur.tsx";
import { EditorSidebar, EditorTools, EditorCanvas, EditorBottom, EditorView, editorStatus } from "./Editor.tsx";
import { ModelSidebar, ModelTools, ModelCanvasView, ModelTimeline, Inspector3, ModelView, modelStatus } from "./Model.tsx";
import { SceneSidebar, SceneTools, SceneCanvasView, SceneInspector, SceneView, sceneStatus } from "./Scene.tsx";
import { Inspector } from "../ui/Inspector.tsx";

interface Fill {
	/** the navigator's Outline tab */
	outline: ComponentChildren;
	/** the path bar's right side */
	tools: ComponentChildren;
	center: ComponentChildren;
	/** the centre is a canvas (absolute-filled) rather than a scrolling page */
	canvas: boolean;
	bottom?: ComponentChildren;
	inspector: ComponentChildren;
	view: ComponentChildren;
}

/** State, hint, snapping and zoom, middle-dot separated: the status bar of a canvas. */
function canvasStatus(hint: string): string {
	return [hint, view.snapGrid.value ? "snap to grid" : "", `${view.zoom.value.toFixed(1)}×`].filter(Boolean).join("  ·  ");
}

/**
 * The status bar is its own component: it follows the document and the
 * zoom (every drag, every wheel tick), and nothing else should redraw
 * with it.
 */
function Status() {
	void ed.rev.value;
	void md.rev.value;
	void sc.rev.value;
	const s = project.screen.value;
	const text = s === "edit" ? (ed.isPalette.value ? editorStatus() : canvasStatus(editorStatus())) : s === "model" ? canvasStatus(modelStatus()) : s === "scene" ? canvasStatus(sceneStatus()) : browseStatus();
	const axes = s === "model" || (s === "scene" && is3d());
	return <StatusBar trailing={axes ? <AxisKey /> : undefined}>{text}</StatusBar>;
}

function browseStatus(): string {
	const shown = browsed().length;
	const all = project.files.value.length;
	const changes = project.changes.value.length;
	return [shown === all ? `${all} asset${all === 1 ? "" : "s"}` : `${shown} of ${all} assets`, nav.selected.value ? "1 selected" : "", changes ? `${changes} uncommitted change${changes === 1 ? "" : "s"}` : ""].filter(Boolean).join("  ·  ");
}

function fill(): Fill {
	switch (project.screen.value) {
		case "edit": {
			const pal = ed.isPalette.value;
			return {
				outline: <EditorSidebar />,
				tools: <EditorTools />,
				canvas: !pal,
				center: <EditorCanvas />,
				bottom: <EditorBottom />,
				inspector: <Inspector />,
				view: pal ? null : (
					<CanvasView>
						<EditorView />
					</CanvasView>
				),
			};
		}
		case "model":
			return {
				outline: <ModelSidebar />,
				tools: <ModelTools />,
				canvas: true,
				center: <ModelCanvasView />,
				bottom: <ModelTimeline />,
				inspector: <Inspector3 />,
				view: (
					<CanvasView>
						<ModelView />
					</CanvasView>
				),
			};
		case "scene":
			return {
				outline: <SceneSidebar />,
				tools: <SceneTools />,
				canvas: true,
				center: <SceneCanvasView />,
				inspector: <SceneInspector />,
				view: (
					<CanvasView>
						<SceneView />
					</CanvasView>
				),
			};
		default:
			return { outline: null, tools: <BrowserTools />, canvas: false, center: <Shelf />, inspector: <ProjectInspector />, view: <BrowserView /> };
	}
}

/** The axis key is the view cube, small: click an axis to look along it, again (or ⇧) for the other side. */
function AxisKey() {
	const name = project.screen.value === "model" ? md.viewName.value : sc.viewName.value;
	const look = (a: string, b: string) => (e: MouseEvent) => run(`view.${e.shiftKey || name === a ? b : a}`);
	return (
		<span class="axis-key">
			<button type="button" class="x" title="Look along X: the right side (1 3 7 9 are the views, F frames)" aria-pressed={name === "right" || name === "left"} onClick={look("right", "left")}>
				X
			</button>
			<button type="button" class="y" title="Look along Y: the top" aria-pressed={name === "top" || name === "bottom"} onClick={look("top", "bottom")}>
				Y
			</button>
			<button type="button" class="z" title="Look along Z: the front" aria-pressed={name === "front" || name === "back"} onClick={look("front", "back")}>
				Z
			</button>
		</span>
	);
}

export function Workspace() {
	const f = fill();
	const side = sidebar.open.value;
	const insp = sidebar.inspector.value;
	return (
		<div class={cx("ur", "workspace", !side && "no-nav", !insp && "no-insp")}>
			<Sidebar>{f.outline}</Sidebar>
			<div class={cx("col", "col-content", f.canvas ? "on-canvas" : "on-content")} onPointerDownCapture={() => (sidebar.focus.value = "content")}>
				<ContentHeader canvas={f.canvas} />
				<JumpBar>{f.tools}</JumpBar>
				{f.canvas ? <div class="canvas-wrap">{f.center}</div> : f.center}
				{f.bottom}
				<Status />
			</div>
			<InspectorPane inspector={f.inspector} view={f.view} />
			{project.serve.value?.on && project.serve.value.qr && (
				<div class="qr">
					<img src={project.serve.value.qr} alt="" />
					Scan to open the editor on a tablet
				</div>
			)}
		</div>
	);
}
