import { useEffect } from "preact/hooks";
import { project, leaveSetup, goDocs } from "../state/project.ts";
import { setup, refreshSetup } from "../state/setup.ts";
import { pretty } from "../state/paths.ts";
import { ThemeButton } from "../ui/ThemeMenu.tsx";

export function Setup() {
	useEffect(() => void refreshSetup(), []);
	const checks = setup.checks.value;
	const busy = setup.busy.value;
	const home = project.home.value;
	return (
		<div class="app">
			<div class="topbar">
				<span class="brand">fastart</span>
				<span class="title">Setup</span>
				<div class="spacer" />
				<ThemeButton />
				<button class="btn ghost" onClick={() => goDocs("guide")}>
					Docs
				</button>
				<button class="btn ghost" title="back  (Esc)" onClick={leaveSetup}>
					Done
				</button>
			</div>
			<div class="setup">
				<div class="setup-lead">
					<p>
						What this machine and {project.root.value ? <b>{project.name.value}</b> : "the open project"} have in place for working with fastart. Each row is a
						fact the studio just checked; a button puts the missing piece there.
					</p>
					<p class="dim">
						{setup.checkout.value ? `checkout: ${pretty(setup.checkout.value, home)}` : "no fastart checkout found on this machine (a release build); the skill will say so"}
						{setup.repo.value ? ` · repository: ${pretty(setup.repo.value, home)}` : ""}
					</p>
				</div>
				{checks.map((c) => (
					<div class={`setup-row ${c.status}`} key={c.id}>
						<span class="mark" />
						<div class="what">
							<div class="h">{c.title}</div>
							<div class="p">{c.detail}</div>
						</div>
						{c.action && c.run && (
							<button class={`btn ${c.status === "ok" ? "ghost" : "primary"}`} disabled={busy} onClick={() => void c.run!()}>
								{c.action}
							</button>
						)}
					</div>
				))}
				{checks.length === 0 && <p class="dim">Setup runs on the machine the studio is on.</p>}
				<div class="setup-lead" style="margin-top:28px">
					<p>
						<b>How agents learn the format.</b> The skill is one page: the file annotated, the conventions, validate → look → load, the loader APIs.
						Claude Code reads it when a task matches, or when you type <code class="kbd">/fastart</code>. The CLAUDE.md section tells Claude, in your
						game's repository, that the art there is fastart and where the tools are. Other agents get the same page from <code class="kbd">AGENTS.md</code> in the checkout.
					</p>
					<p class="dim">Nothing here touches your art. The studio writes only the four files named above.</p>
				</div>
			</div>
		</div>
	);
}
