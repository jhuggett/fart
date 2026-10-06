// Documentation, inside the app: the studio guide and the format spec,
// rendered from the same markdown the repo keeps.

import { useMemo } from "preact/hooks";
import { marked } from "marked";
import { leaveDocs, project } from "../state/project.ts";
import guide from "../docs/guide.md?raw";
import spec from "../../../../spec/FORMAT.md?raw";

const PAGES = [
	{ id: "guide", title: "Studio guide", md: guide },
	{ id: "format", title: "The format", md: spec },
];
const page = project.docsPage;

import { Button, PaneHeader, SidebarRow } from "../ui/ur.tsx";
import { inlineLights } from "../state/project.ts";

export function Docs() {
	const cur = PAGES.find((p) => p.id === page.value) ?? PAGES[0];
	const html = useMemo(() => marked.parse(cur.md, { async: false }) as string, [cur]);
	return (
		<div class="ur app">
			<PaneHeader pane="sidebar" lights={inlineLights()} title="Uranus docs" trailing={<Button onClick={leaveDocs}>Done</Button>} />
			<div class="docs">
				<nav class="ur-tree" aria-label="Pages">
					{PAGES.map((p) => (
						<SidebarRow label={p.title} icon="book-open" selected={p.id === cur.id} onClick={() => (page.value = p.id)} />
					))}
				</nav>
				<article>
					<div class="prose" dangerouslySetInnerHTML={{ __html: html }} />
				</article>
			</div>
		</div>
	);
}
