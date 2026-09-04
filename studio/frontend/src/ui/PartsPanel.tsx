import {
	ed,
	parts,
	curState,
	addPart,
	deletePart,
	renamePart,
	swapParts,
	deleteAnchor,
	toggleMembership,
	parentCandidates,
	setParent,
} from "../state/editor.ts";
import { ask } from "../state/prompt.ts";

export function PartsPanel() {
	void ed.rev.value;
	const ps = parts();
	const cur = ed.curPart.value;
	const st = curState();
	const pending = ed.pending.value;
	const part = ps[cur];
	return (
		<>
			<div class="hdr" title="layers: the top row paints first, lower rows paint over it">
				Parts
			</div>
			{ps.map((p, k) => {
				const member = st ? st.parts.some((sp) => sp.part === p.name) : true;
				return (
					<div
						class={`row ${k === cur ? "active" : ""} ${st && !member ? "dim" : ""}`}
						onClick={() => (ed.curPart.value = k)}
						onDblClick={() => void ask("New name for the part", p.name).then((n) => n && renamePart(k, n))}
					>
						{st && (
							<span
								class={`check ${member ? "on" : ""}`}
								title="drawn in this state"
								onClick={(e) => {
									e.stopPropagation();
									toggleMembership(ed.curState.value, p.name);
								}}
							/>
						)}
						<span class="name">{p.name}</span>
						{k === cur && (
							<span class="tail">
								<button class="btn x" style="color:var(--dim)" title="raise (paints later)" disabled={k === 0} onClick={(e) => (e.stopPropagation(), swapParts(k, k - 1))}>
									˄
								</button>
								<button class="btn x" style="color:var(--dim)" title="lower" disabled={k === ps.length - 1} onClick={(e) => (e.stopPropagation(), swapParts(k, k + 1))}>
									˅
								</button>
								<button class="btn x" title="delete part" onClick={(e) => (e.stopPropagation(), deletePart(k))}>
									×
								</button>
							</span>
						)}
					</div>
				);
			})}
			<button class="add-row" onClick={() => void ask("Name the new part").then((n) => n && addPart(n))}>
				+ part
			</button>
			<div class="line" style="display:flex;gap:6px;margin-top:8px">
				<button
					class={`btn ghost ${pending === "pivot" ? "active" : ""}`}
					style="flex:1"
					title="the next canvas click places the pivot"
					onClick={() => (ed.pending.value = pending === "pivot" ? "none" : "pivot")}
				>
					Set pivot
				</button>
				<button
					class={`btn ghost ${pending === "anchor" ? "active" : ""}`}
					style="flex:1"
					title="the next canvas click places an anchor"
					onClick={() => (ed.pending.value = pending === "anchor" ? "none" : "anchor")}
				>
					Add anchor
				</button>
			</div>
			{part && ps.length > 1 && (
				<div class="line" style="display:flex;align-items:center;gap:8px;margin-top:8px">
					<span class="chip" style="margin:0">parent</span>
					<select class="picker" style="flex:1" value={part.parent ?? ""} onChange={(e) => setParent(cur, (e.target as HTMLSelectElement).value || undefined)}>
						<option value="">none</option>
						{parentCandidates(cur).map((n) => (
							<option value={n}>{n}</option>
						))}
					</select>
				</div>
			)}
			{part && (part.anchors?.length ?? 0) > 0 && (
				<>
					<div class="hdr">Anchors</div>
					{part.anchors!.map((a, i) => (
						<div class="row dim">
							<span class="name">{a.name}</span>
							<span class="chip">
								{a.at[0].toFixed(1)}, {a.at[1].toFixed(1)}
							</span>
							<button class="btn x" onClick={() => deleteAnchor(cur, i)}>
								×
							</button>
						</div>
					))}
				</>
			)}
		</>
	);
}
