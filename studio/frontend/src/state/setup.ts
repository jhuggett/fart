// Setup: what this machine and this repository have in place for
// working with fastart, and the one-click fixes. The skill and the Odin
// loader are bundled here, so the studio can install them without a
// checkout; the checkout, when found, fills the paths in.

import { signal, batch } from "@preact/signals";
import { shell } from "../shell/shell.ts";
import { project, openProject } from "./project.ts";
import { relativeTo } from "./paths.ts";
import SKILL from "../../../../skills/fastart/SKILL.md?raw";
import LOADER from "../../../../loaders/odin/fastart.odin?raw";
import LOADER_IO from "../../../../loaders/odin/fastart_io.odin?raw";

export type Status = "ok" | "warn" | "missing" | "na";

export interface Check {
	id: string;
	title: string;
	status: Status;
	/** one line on what was found */
	detail: string;
	/** the fix, as a button label; absent when there is nothing to do */
	action?: string;
	run?: () => Promise<void>;
}

export const setup = {
	checks: signal<Check[]>([]),
	busy: signal(false),
	checkout: signal(""),
	repo: signal(""),
	/** something is missing or stale */
	attention: signal(false),
};

const SKILL_REL = ".claude/skills/fastart/SKILL.md";

/** The skill as it should read on this machine. */
function skillText(checkout: string): string {
	return SKILL.replaceAll("{{FASTART}}", checkout || "<the fastart checkout>");
}

/** Where art sits inside the repo, for the guide: "assets/art", or "." */
function artRel(repo: string, root: string): string {
	if (!repo || !root || repo === root) return ".";
	return relativeTo(repo, root);
}

function guideSection(repo: string, root: string, checkout: string): string {
	const art = artRel(repo, root);
	const where = art === "." ? "this repository" : `\`${art}/\``;
	const validate = checkout ? `\`make validate DIR=${root}\` in the fastart checkout at \`${checkout}\`` : "the studio (it lists issues when a file opens)";
	return `
## Art is fastart (\`.fart\`)

Art lives in ${where} as \`.fart\` files: the Fast Art Format, JSON
vector art with parts, states, clips and palette slots. To make or change
art, use the **fastart** skill (\`/fastart\`): the format, the conventions
and the loader API in one page. Validate with ${validate}. \`*.fart~\`
files are studio checkpoints: never commit or read them.
`;
}

async function withBusy(fn: () => Promise<void>) {
	setup.busy.value = true;
	try {
		await fn();
	} catch (e) {
		project.error.value = String(e);
	} finally {
		setup.busy.value = false;
		await refreshSetup();
	}
}

/** Look everything over again. Cheap: a handful of small reads. */
export async function refreshSetup() {
	if (!shell.setup) {
		setup.checks.value = [];
		return;
	}
	const home = project.home.value;
	// served from this machine, the project's absolute path comes from the server
	const root = shell.kind === "http" ? project.servedRoot.value : (project.root.value ?? "");
	const checkout = await shell.checkout();
	const repo = root ? await shell.gitRoot(root) : "";
	const checks: Check[] = [];

	// the skill: Claude Code learns the format from it
	{
		const want = skillText(checkout);
		const have = home ? await shell.readAt(home, SKILL_REL) : null;
		const install = () => withBusy(() => shell.writeAt(home, SKILL_REL, want));
		if (!home) checks.push({ id: "skill", title: "Claude Code skill", status: "na", detail: "no home folder to install into" });
		else if (have === null) checks.push({ id: "skill", title: "Claude Code skill", status: "missing", detail: `not installed: agents in other projects will not know the format (~/${SKILL_REL})`, action: "Install", run: install });
		else if (have !== want) checks.push({ id: "skill", title: "Claude Code skill", status: "warn", detail: `installed at ~/${SKILL_REL}, but not what this studio carries`, action: "Update", run: install });
		else checks.push({ id: "skill", title: "Claude Code skill", status: "ok", detail: `installed at ~/${SKILL_REL}; say /fastart in any project` });
	}

	if (!root) {
		checks.push({ id: "repo", title: "This project", status: "na", detail: "open a folder to check its repository" });
	} else if (!repo) {
		checks.push({ id: "repo", title: "This project", status: "na", detail: "not inside a git repository, so there is no CLAUDE.md or .gitignore to keep" });
	} else {
		// CLAUDE.md at the repo root: tells Claude the art is fastart
		{
			const have = await shell.readAt(repo, "CLAUDE.md");
			const section = guideSection(repo, root, checkout);
			const add = () => withBusy(() => shell.writeAt(repo, "CLAUDE.md", (have ?? `# ${repo.split("/").pop()}\n`).replace(/\s*$/, "\n") + section));
			if (have === null) checks.push({ id: "guide", title: "CLAUDE.md in the repository", status: "missing", detail: `${repo}/CLAUDE.md does not exist: Claude working there will not know the art is fastart`, action: "Create", run: add });
			else if (!/fastart/i.test(have)) checks.push({ id: "guide", title: "CLAUDE.md in the repository", status: "warn", detail: "exists, but says nothing about fastart", action: "Add section", run: add });
			else checks.push({ id: "guide", title: "CLAUDE.md in the repository", status: "ok", detail: "mentions fastart" });
		}
		// .gitignore: the studio's checkpoints stay out of history
		{
			const have = await shell.readAt(repo, ".gitignore");
			const has = !!have && have.split(/\r?\n/).some((l) => l.trim() === "*.fart~");
			const add = () => withBusy(() => shell.writeAt(repo, ".gitignore", (have ?? "").replace(/\s*$/, have ? "\n" : "") + "*.fart~\n"));
			if (has) checks.push({ id: "ignore", title: ".gitignore ignores *.fart~", status: "ok", detail: "studio checkpoints stay out of git" });
			else checks.push({ id: "ignore", title: ".gitignore ignores *.fart~", status: have === null ? "missing" : "warn", detail: have === null ? "no .gitignore: the studio's *.fart~ checkpoints would be committed" : "the studio's *.fart~ checkpoints would be committed", action: "Add", run: add });
		}
		// the Odin loader, where the repo is Odin
		{
			const odin = await shell.findNamed(repo, "*.odin");
			if (!odin.length) {
				checks.push({ id: "loader", title: "Odin loader", status: "na", detail: checkout ? `no Odin sources here; the TypeScript core is at ${checkout}/packages/core` : "no Odin sources here" });
			} else {
				const found = await shell.findNamed(repo, "fastart.odin");
				const dir = found.length ? found[0].slice(0, found[0].lastIndexOf("/")) : `${repo}/fastart`;
				const rel = relativeTo(repo, dir + "/x").slice(0, -2);
				const put = () => withBusy(async () => {
					await shell.writeAt(repo, `${rel}/fastart.odin`, LOADER);
					await shell.writeAt(repo, `${rel}/fastart_io.odin`, LOADER_IO);
				});
				if (!found.length) checks.push({ id: "loader", title: "Odin loader", status: "missing", detail: `an Odin project with no fastart loader; it would go in ${rel}/`, action: "Copy in", run: put });
				else {
					const have = await shell.readAt(repo, `${rel}/fastart.odin`);
					const haveIo = await shell.readAt(repo, `${rel}/fastart_io.odin`);
					if (have === LOADER && haveIo === LOADER_IO) checks.push({ id: "loader", title: "Odin loader", status: "ok", detail: `${rel}/ matches this studio's` });
					else checks.push({ id: "loader", title: "Odin loader", status: "warn", detail: `${rel}/ differs from the loader this studio carries`, action: "Update", run: put });
				}
			}
		}
	}

	// the sample project, when the checkout is at hand
	if (checkout) {
		checks.push({ id: "sample", title: "Sample project", status: "ok", detail: `${checkout}/examples/space: ships, a station, rocks, palettes to swap`, action: "Open", run: () => openProject(`${checkout}/examples/space`) });
	}

	batch(() => {
		setup.checkout.value = checkout;
		setup.repo.value = repo;
		setup.checks.value = checks;
		setup.attention.value = checks.some((c) => c.status === "missing" || c.status === "warn");
	});
}
