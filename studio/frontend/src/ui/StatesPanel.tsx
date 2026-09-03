import { ed, states, curPart, curState, poseOfCur, addState, deleteState, renameState, setPose, resetPose, toggleMembership } from "../state/editor.ts";
import { ask } from "../state/prompt.ts";
import { Slider } from "./Slider.tsx";

const DEG = 180 / Math.PI;

export function StatesPanel() {
	void ed.rev.value;
	const sts = states();
	const cur = ed.curState.value;
	const st = curState();
	const part = curPart();
	const sp = poseOfCur();
	return (
		<>
			<div class="hdr">
				States <span class="hint">the preview</span>
			</div>
			<div
				class={`row ${cur < 0 ? "active" : ""}`}
				onClick={() => {
					ed.curState.value = -1;
					ed.sel.value = [];
				}}
			>
				<span class="name">all parts</span>
			</div>
			{sts.map((s, k) => (
				<div
					class={`row ${k === cur ? "active" : ""}`}
					onClick={() => {
						ed.curState.value = k;
						ed.sel.value = [];
					}}
					onDblClick={() => void ask("New name for the state", s.name).then((n) => n && renameState(k, n))}
				>
					<span class="name">{s.name}</span>
					{k === cur && (
						<span class="tail">
							<button class="btn x" title="delete state" onClick={(e) => (e.stopPropagation(), deleteState(k))}>
								×
							</button>
						</span>
					)}
				</div>
			))}
			<button class="btn ghost" style="width:100%;margin-top:6px" onClick={() => void ask("Name the new state").then((n) => n && addState(n))}>
				+ state
			</button>
			{st && part && (
				<>
					<div class="hdr">
						Pose <span class="hint">{part.name}</span>
					</div>
					{sp ? (
						<div class="card">
							<Slider
								label="turn"
								value={(sp.rotate ?? 0) * DEG}
								min={-180}
								max={180}
								step={1}
								show={(v) => `${Math.round(v)}°`}
								onInput={(v) => setPose(sp, { rotate: v / DEG }, "pose-turn")}
							/>
							<Slider
								label="size"
								value={sp.scale === undefined || sp.scale === 0 ? 1 : sp.scale}
								min={0.1}
								max={3}
								step={0.05}
								show={(v) => `${v.toFixed(2)}×`}
								onInput={(v) => setPose(sp, { scale: v }, "pose-size")}
							/>
							<div class="line" style="margin-top:8px">
								<button class="btn small ghost" onClick={() => resetPose(sp)}>
									reset
								</button>
								<span class="chip">drag the part to place it; pull the lever to turn</span>
							</div>
						</div>
					) : (
						<div class="card">
							<div class="line">
								<span style="color:var(--dim)">not drawn in this state</span>
							</div>
							<button class="btn small ghost" onClick={() => toggleMembership(cur, part.name)}>
								add it
							</button>
						</div>
					)}
				</>
			)}
		</>
	);
}
