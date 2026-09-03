import { ed, clips, curClip, addClip, deleteClip, renameClip, setClipLoop, selectClip, states } from "../state/editor.ts";
import { project } from "../state/project.ts";
import { ask } from "../state/prompt.ts";

export function ClipsPanel() {
	void ed.rev.value;
	const cs = clips();
	const cur = ed.curClip.value;
	const clip = curClip();
	return (
		<>
			<div class="hdr">
				Clips <span class="hint">states in time</span>
			</div>
			{cs.map((c, k) => (
				<div
					class={`row ${k === cur ? "active" : ""}`}
					onClick={() => selectClip(k)}
					onDblClick={() => void ask("New name for the clip", c.name).then((n) => n && renameClip(k, n))}
				>
					<span class="name">{c.name}</span>
					<span class="chip">
						{c.keys.length} key{c.keys.length === 1 ? "" : "s"}
						{c.loop ? " · loop" : ""}
					</span>
					{k === cur && (
						<span class="tail">
							<button class="btn x" title="delete clip" onClick={(e) => (e.stopPropagation(), deleteClip(k))}>
								×
							</button>
						</span>
					)}
				</div>
			))}
			<button
				class="btn ghost"
				style="width:100%;margin-top:6px"
				onClick={() =>
					void ask("Name the new clip").then((n) => {
						if (n && !addClip(n)) project.error.value = "a clip is states in time: make a state first";
					})
				}
				disabled={states().length === 0}
				title={states().length === 0 ? "make a state first" : ""}
			>
				+ clip
			</button>
			{clip && (
				<div class="card">
					<div class="line">
						<span class={`check ${clip.loop ? "on" : ""}`} onClick={() => setClipLoop(cur, !clip.loop)} />
						<span>loop</span>
					</div>
					<div class="line">
						<span class="chip" style="margin:0">
							keys name states: to change what a key looks like, pose that state
						</span>
					</div>
				</div>
			)}
		</>
	);
}
