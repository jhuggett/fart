import { signal } from "@preact/signals";
import { THEMES, SYSTEM, theme, setTheme } from "../state/theme.ts";

const open = signal(false);

function Trio({ trio }: { trio: [string, string, string] }) {
	return (
		<span class="trio">
			<i style={{ background: trio[0] }} />
			<i style={{ background: trio[1] }} />
			<i style={{ background: trio[2] }} />
		</span>
	);
}

/** The theme picker: a button and its popover. `label` shows the word. */
export function ThemeButton({ label }: { label?: boolean }) {
	const choice = theme.choice.value;
	return (
		<div class="popwrap" onPointerLeave={() => (open.value = false)}>
			<button class={`btn ghost ${open.value ? "active" : ""}`} title="Theme" onClick={() => (open.value = !open.value)}>
				◐{label ? " Theme" : ""}
			</button>
			{open.value && (
				<div class="popover">
					<div class="hdr" style="margin:6px 9px 4px">
						Theme
					</div>
					<div class={`row ${choice === SYSTEM ? "active" : ""}`} onClick={() => setTheme(SYSTEM)}>
						<span class="trio system">
							<i style={{ background: "#131315" }} />
							<i style={{ background: "#f4f1ea" }} />
							<i style={{ background: "linear-gradient(135deg,#f5c451 50%,#c9531f 50%)" }} />
						</span>
						<span class="name">System</span>
						<span class="chip">follows the OS</span>
					</div>
					{THEMES.map((t) => (
						<div class={`row ${choice === t.id ? "active" : ""}`} onClick={() => setTheme(t.id)}>
							<Trio trio={t.trio} />
							<span class="name">{t.name}</span>
							<span class="chip">{t.blurb}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
