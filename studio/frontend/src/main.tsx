import { render } from "preact";
import "./theme.css";
import { App } from "./App.tsx";
import { boot } from "./state/project.ts";

render(<App />, document.getElementById("app")!);
void boot();
