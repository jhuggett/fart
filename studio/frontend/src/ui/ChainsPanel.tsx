import { ed, parts, curPart, constraints, addChain, deleteChain, renameChain, setChain, setChainBend, curState } from "../state/editor.ts";
import { ask } from "../state/prompt.ts";
import { signal } from "@preact/signals";

const curChain = signal(-1);

export function ChainsPanel() {
	void ed.rev.value;
	const cs = constraints();
	const ps = parts();
	const part = curPart();
	const k = curChain.value < cs.length ? curChain.value : -1;
	const c = cs[k];
	const canStart = !!part && (part.anchors?.length ?? 0) > 0;
	const start = () => {
		if (!part) return;
		void ask("Name the new chain", `${part.name} reach`).then((name) => {
			if (!name) return;
			const chain = part.parent ? [part.parent, part.name] : [part.name];
			addChain(name, chain, `${part.name}/${part.anchors![0].name}`);
			curChain.value = constraints().length - 1;
		});
	};
	const longer = () => {
		if (!c) return;
		const root = ps.find((p) => p.name === c.chain[0]);
		if (root?.parent) setChain(k, [root.parent, ...c.chain], c.end);
	};
	const shorter = () => {
		if (!c || c.chain.length < 2) return;
		setChain(k, c.chain.slice(1), c.end);
	};
	const last = c ? ps.find((p) => p.name === c.chain[c.chain.length - 1]) : undefined;
	return (
		<>
			<div class="hdr" title="inverse kinematics: drag an anchor and the chain follows">
				Chains
			</div>
			{cs.map((x, i) => (
				<div
					class={`row ${i === k ? "active" : ""}`}
					onClick={() => (curChain.value = i)}
					onDblClick={() => void ask("New name for the chain", x.name).then((n) => n && renameChain(i, n))}
				>
					<span class="name">{x.name}</span>
					<span class="chip">{x.chain.join(" › ")}</span>
					{i === k && (
						<span class="tail">
							<button class="btn x" title="delete chain" onClick={(e) => (e.stopPropagation(), deleteChain(i), (curChain.value = -1))}>
								×
							</button>
						</span>
					)}
				</div>
			))}
			<button
				class="add-row"
				disabled={!canStart}
				title={canStart ? "a chain that ends at this part's anchor" : "give the current part an anchor first: that is what the chain reaches with"}
				onClick={start}
			>
				+ chain from {part?.name ?? "part"}
			</button>
			{c && (
				<div class="card">
					<div class="line">
						<span class="k">bones</span>
						<button class="btn small ghost" onClick={longer} title="one more part toward the root">
							longer
						</button>
						<button class="btn small ghost" onClick={shorter} disabled={c.chain.length < 2}>
							shorter
						</button>
					</div>
					<div class="line">
						<span class="k">end</span>
						<select class="picker" style="flex:1" value={c.end} onChange={(e) => setChain(k, c.chain, (e.target as HTMLSelectElement).value)}>
							{(last?.anchors ?? []).map((a) => (
								<option value={`${last!.name}/${a.name}`}>{`${last!.name}/${a.name}`}</option>
							))}
						</select>
					</div>
					<div class="line">
						<span class="k">bend</span>
						<select
							class="picker"
							style="flex:1"
							value={c.bend ?? 0}
							onChange={(e) => {
								const v = Number((e.target as HTMLSelectElement).value);
								setChainBend(k, v === 1 ? 1 : v === -1 ? -1 : undefined);
							}}
						>
							<option value={0}>either way</option>
							<option value={1}>clockwise</option>
							<option value={-1}>counter-clockwise</option>
						</select>
					</div>
					<div class="line">
						<span class="chip" style="margin:0">{curState() ? "drag the ring on the canvas to reach" : "pick a state, then drag the ring on the canvas"}</span>
					</div>
				</div>
			)}
		</>
	);
}
