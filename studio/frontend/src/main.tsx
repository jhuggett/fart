import { render } from "preact";
import "./theme.css";
import { App } from "./App.tsx";
import { boot } from "./state/project.ts";
import { initTheme } from "./state/theme.ts";

initTheme();
render(<App />, document.getElementById("app")!);
void boot();

// A probe for scripts and the console: the store, the view, and the
// screen mapping. Read-only in spirit; nothing in the app uses it.
import { ed } from "./state/editor.ts";
import { view, toScreen, toWorld } from "./canvas/view.ts";
import { frameW, partXf, worldPivot, poseLever, chainGrabs } from "./canvas/interact.ts";
(globalThis as { fastart?: unknown }).fastart = { ed, view, toScreen, toWorld, frameW, partXf, worldPivot, poseLever, chainGrabs };
