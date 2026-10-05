import { useEffect } from "preact/hooks";
import { project, leaveSetup, goDocs, inlineLights, showLauncher, setShowLauncher } from "../state/project.ts";
import { theme, setTheme } from "../state/theme.ts";
import { shell } from "../shell/shell.ts";
import { HelpButton } from "../ui/Help.tsx";
import { BUTTONS } from "../state/help.ts";
import { Button, Checkbox, Icon, PaneHeader, SegmentedControl, type IconName } from "../ui/ur.tsx";
import { setup, refreshSetup } from "../state/setup.ts";
import { pretty } from "../state/paths.ts";

// a status never rides on colour alone: a glyph and a word with it
const MARK: Record<string, IconName> = { ok: "circle-check", warn: "triangle-alert", missing: "circle", na: "minus" };
const WORD: Record<string, string> = { ok: "In place", warn: "Needs attention", missing: "Missing", na: "Not needed" };

export function Setup() {
	useEffect(() => void refreshSetup(), []);
	const checks = setup.checks.value;
	const busy = setup.busy.value;
	const home = project.home.value;
	return (
		<div class="ur app">
			<PaneHeader
				pane="sidebar"
				lights={inlineLights()}
				title="Settings"
				trailing={
					<>
						<HelpButton topics={BUTTONS.settings} title="About setup, appearance and updates" />
						<Button variant="borderless" onClick={() => goDocs("guide")}>
							Docs
						</Button>
						<Button title="Back (Esc)" onClick={leaveSetup}>
							Done
						</Button>
					</>
				}
			/>
			<div class="setup">
				<div class="setup-group">
					<div class="title">Appearance</div>
					<SegmentedControl
						label="Appearance"
						value={theme.choice.value as "system" | "light" | "dark"}
						onChange={setTheme}
						options={[
							{ value: "system", label: "System", icon: "monitor" },
							{ value: "light", label: "Light", icon: "sun" },
							{ value: "dark", label: "Dark", icon: "moon" },
						]}
					/>
					{shell.kind === "wails" && <Checkbox checked={showLauncher.value} label="Show the welcome window when Uranus launches" onChange={setShowLauncher} />}
				</div>
				<div class="title">Setup</div>
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
				<div class="setup-list">
					{checks.map((c) => (
						<div class={`setup-row ${c.status}`} key={c.id}>
							<Icon name={MARK[c.status] ?? "minus"} class="setup-mark" />
							<div class="what">
								<div class="h">
									{c.title}
									<span class="setup-word">{WORD[c.status] ?? ""}</span>
								</div>
								<div class="p">{c.detail}</div>
							</div>
							{c.action && c.run && (
								<Button variant={c.status === "ok" ? "push" : "primary"} disabled={busy} onClick={() => void c.run!()}>
									{c.action}
								</Button>
							)}
						</div>
					))}
				</div>
				{checks.length === 0 && <p class="dim">Setup runs on the machine the studio is on.</p>}
				<div class="setup-lead setup-foot">
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
