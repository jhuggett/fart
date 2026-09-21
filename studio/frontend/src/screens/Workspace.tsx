// The workspace: the project as an IDE split view. Sidebar on the left
// (assets, or the open asset's insides), the canvas in the middle headed
// by the project bar and footed by the floating tools, the inspector on
// the right. Which asset screen fills the middle follows project.screen.

import type { ComponentChildren } from "preact";
import { project } from "../state/project.ts";
import { sidebar } from "../state/sidebar.ts";
import { chat } from "../state/chat.ts";
import { ed } from "../state/editor.ts";
import { sc } from "../state/scene.ts";
import { Sidebar, assetAddMenu } from "../ui/Sidebar.tsx";
import { ProjectBar } from "../ui/ProjectBar.tsx";
import { ChatPanel } from "../ui/ChatPanel.tsx";
import { Gutter } from "../ui/Gutter.tsx";
import { Shelf } from "../ui/Shelf.tsx";
import { Inspector } from "../ui/Inspector.tsx";
import { ProjectInspector } from "../ui/ProjectInspector.tsx";
import { EditorSidebar, EditorTools, EditorCanvas, EditorBottom, editorAdd } from "./Editor.tsx";
import { ModelSidebar, ModelTools, ModelCanvasView, ModelTimeline, Inspector3, modelAdd } from "./Model.tsx";
import { SceneSidebar, SceneTools, SceneCanvasView, SceneInspector, sceneAdd } from "./Scene.tsx";
import type { MenuItem } from "../state/menu.ts";

interface Fill {
	side: ComponentChildren;
	add: MenuItem[];
	kind: string;
	center: ComponentChildren;
	/** the centre is a canvas (absolute-filled) rather than a scrolling page */
	canvas: boolean;
	bottom?: ComponentChildren;
	inspector: ComponentChildren;
}

function fill(): Fill {
	switch (project.screen.value) {
		case "edit":
			return {
				side: <EditorSidebar />,
				add: editorAdd(),
				kind: ed.isPalette.value ? "palette" : "",
				canvas: !ed.isPalette.value,
				center: (
					<>
						<EditorCanvas />
						<EditorTools />
					</>
				),
				bottom: <EditorBottom />,
				inspector: <Inspector />,
			};
		case "model":
			return {
				side: <ModelSidebar />,
				add: modelAdd(),
				kind: "3D",
				canvas: true,
				center: (
					<>
						<ModelCanvasView />
						<ModelTools />
					</>
				),
				bottom: <ModelTimeline />,
				inspector: <Inspector3 />,
			};
		case "scene":
			return {
				side: <SceneSidebar />,
				add: sceneAdd(),
				kind: sc.scene.value.space === "3d" ? "3D scene" : "scene",
				canvas: true,
				center: (
					<>
						<SceneCanvasView />
						<SceneTools />
					</>
				),
				inspector: <SceneInspector />,
			};
		default:
			return { side: null, add: assetAddMenu(), kind: "", canvas: false, center: <Shelf />, inspector: <ProjectInspector /> };
	}
}

export function Workspace() {
	const f = fill();
	const side = sidebar.open.value;
	const insp = sidebar.inspector.value;
	const chatRight = chat.open.value && chat.dock.value === "right";
	const chatBelow = chat.open.value && chat.dock.value === "bottom";
	return (
		<div class="app">
			<div class={`workspace ${side ? "" : "no-side"} ${insp ? "" : "no-insp"} ${chatRight ? "chat-right" : ""}`}>
				<Sidebar add={f.add}>
					{f.side}
				</Sidebar>
				<div class="center">
					<ProjectBar />
					{f.canvas ? <div class="canvas-wrap">{f.center}</div> : f.center}
					{f.bottom}
				</div>
				{insp && (
					<div class="dock">
						{f.inspector}
						<Gutter k="right" edge="left" />
					</div>
				)}
				{chatRight && <ChatPanel />}
			</div>
			{chatBelow && <ChatPanel />}
			{project.serve.value?.on && project.serve.value.qr && (
				<div class="qr">
					<img src={project.serve.value.qr} alt="" />
					scan to open the editor on a tablet
				</div>
			)}
		</div>
	);
}
