import { render } from "preact";
import "./theme.css";
import { App } from "./App.tsx";
import { boot } from "./state/project.ts";
import { initTheme } from "./state/theme.ts";

initTheme();
render(<App />, document.getElementById("app")!);
void boot();
