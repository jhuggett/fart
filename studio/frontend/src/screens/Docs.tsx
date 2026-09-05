// Documentation, inside the app: the studio guide and the format spec,
// rendered from the same markdown the repo keeps.

import { useMemo } from "preact/hooks";
import { marked } from "marked";
import { leaveDocs, project } from "../state/project.ts";
import { ThemeButton } from "../ui/ThemeMenu.tsx";
import guide from "../docs/guide.md?raw";
import spec from "../../../../spec/FORMAT.md?raw";

const PAGES = [
	{ id: "guide", title: "Studio guide", md: guide },
	{ id: "format", title: "The format", md: spec },
];
const page = project.docsPage;

export function Docs() {
	const cur = PAGES.find((p) => p.id === page.value) ?? PAGES[0];
	const html = useMemo(() => marked.parse(cur.md, { async: false }) as string, [cur]);
	return (
		<div class="app">
			<div class="topbar">
				<span class="brand">Uranus</span>
				<span class="sub">docs</span>
				<div class="spacer" />
				<ThemeButton label />
				<button class="btn ghost" onClick={leaveDocs}>
					Back
				</button>
			</div>
			<div class="docs">
				<nav>
					{PAGES.map((p) => (
						<div class={`row ${p.id === cur.id ? "active" : ""}`} onClick={() => (page.value = p.id)}>
							<span class="name">{p.title}</span>
						</div>
					))}
				</nav>
				<article>
					<div class="prose" dangerouslySetInnerHTML={{ __html: html }} />
				</article>
			</div>
		</div>
	);
}
