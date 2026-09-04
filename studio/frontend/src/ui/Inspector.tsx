// The inspector: the properties of whatever is selected. A shape gets its
// numbers and its fill; the part gets pivot, parent, anchors and chains;
// a pose gets offset, turn and size; nothing selected gets the document.

import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { cssColor, type Rgba, type Shape } from "@fastart/core";
import { I } from "./Icons.tsx";
import { Num, Text } from "./Field.tsx";
import { InlineName } from "./Rename.tsx";
import { ColorPicker } from "./ColorPicker.tsx";
import { Slider } from "./Slider.tsx";
import {
	ed,
	parts,
	palette,
	curPart,
	curState,
	curClip,
	selShape,
	colShape,
	poseOfCur,
	constraints,
	renamePart,
	deleteSel,
	selOrder,
	selToPart,
	paintSel,
	setShapeNumber,
	setPivotNumber,
	setAnchorNumber,
	renameAnchor,
	deleteAnchor,
	parentCandidates,
	setParent,
	swapParts,
	setPose,
	resetPose,
	toggleMembership,
	addToken,
	deleteToken,
	renameToken,
	setTokenColor,
	setDocName,
	addChain,
	deleteChain,
	renameChain,
	setChain,
	setChainBend,
	setClipLoop,
	freshName,
} from "../state/editor.ts";
import { renaming } from "../state/menu.ts";

const DEG = 180 / Math.PI;

function Section(props: { title: string; hint?: string; tail?: string; children: ComponentChildren }) {
	return (
		<>
			<div class="hdr" title={props.hint}>
				{props.title}
				{props.tail && <span class="hint">{props.tail}</span>}
			</div>
			{props.children}
		</>
	);
}

/** The fill: a swatch button opening the token grid. */
function FillPick({ current, onPick }: { current: string | undefined; onPick: (t: string) => void }) {
	const [open, setOpen] = useState(false);
	const local = palette();
	const shared = ed.shared.value;
	const tok = ed.tokens.value.find((t) => t.name === current);
	return (
		<div class="popwrap" style="flex:1">
			<button class="swatch-btn" onClick={() => setOpen(!open)} title="fill: a palette token">
				<span class="swatch" style={{ background: tok ? cssColor(tok.rgb) : "#f0f" }} />
				<span class="name">{current ?? "—"}</span>
				<I.chevron size={11} />
			</button>
			{open && (
				<div class="popover left" style="min-width:220px" onPointerLeave={() => setOpen(false)}>
					{local.map((t) => (
						<div
							class={`row ${t.name === current ? "active" : ""}`}
							onClick={() => {
								onPick(t.name);
								setOpen(false);
							}}
						>
							<span class="swatch" style={{ background: cssColor(t.rgb) }} />
							<span class="name">{t.name}</span>
						</div>
					))}
					{shared.length > 0 && <div class="hdr" style="margin:6px 8px 2px">shared</div>}
					{shared.map((t) => (
						<div
							class={`row dim ${t.name === current ? "active" : ""}`}
							onClick={() => {
								onPick(t.name);
								setOpen(false);
							}}
						>
							<span class="swatch" style={{ background: cssColor(t.rgb) }} />
							<span class="name">{t.name}</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function ShapeSection({ sh, collision }: { sh: Shape; collision: boolean }) {
	const n = collision ? 1 : ed.sel.value.length;
	const elsewhere = !collision && ed.sel.value.some((r) => r.p !== ed.curPart.value);
	return (
		<Section title={collision ? "Collision shape" : n > 1 ? `${n} shapes` : "Shape"} hint="what is selected on the canvas" tail={sh.kind}>
			{!collision && (
				<div class="line">
					<span class="k">fill</span>
					<FillPick current={sh.color} onPick={paintSel} />
				</div>
			)}
			{n === 1 && sh.kind === "circle" && (
				<div class="fields">
					<Num label="x" value={sh.at[0]} onChange={(v) => setShapeNumber(sh, "at", 0, v)} />
					<Num label="y" value={sh.at[1]} onChange={(v) => setShapeNumber(sh, "at", 1, v)} />
					<Num label="r" value={sh.r} min={0} onChange={(v) => setShapeNumber(sh, "r", null, v)} />
				</div>
			)}
			{n === 1 && sh.kind === "line" && (
				<div class="fields">
					<Num label="ax" value={sh.a[0]} onChange={(v) => setShapeNumber(sh, "a", 0, v)} />
					<Num label="ay" value={sh.a[1]} onChange={(v) => setShapeNumber(sh, "a", 1, v)} />
					<Num label="bx" value={sh.b[0]} onChange={(v) => setShapeNumber(sh, "b", 0, v)} />
					<Num label="by" value={sh.b[1]} onChange={(v) => setShapeNumber(sh, "b", 1, v)} />
					<Num label={collision ? "girth" : "width"} value={sh.w} min={0} onChange={(v) => setShapeNumber(sh, "w", null, v)} wide />
				</div>
			)}
			{n === 1 && sh.kind === "poly" && (
				<div class="line" title="drag the corners on the canvas; Alt breaks a rect into a free quad">
					<span class="k">points</span>
					<span>{sh.points.length}</span>
				</div>
			)}
			<div class="line" style="margin-top:8px;gap:6px">
				{!collision && (
					<>
						<button class="btn small ghost" title="raise  ]" onClick={() => selOrder(true)}>
							raise
						</button>
						<button class="btn small ghost" title="lower  [" onClick={() => selOrder(false)}>
							lower
						</button>
						{elsewhere && (
							<button class="btn small ghost" title="move into the current part" onClick={selToPart}>
								to part
							</button>
						)}
					</>
				)}
				<button class="btn small ghost danger" title="delete  X" onClick={deleteSel}>
					delete
				</button>
			</div>
		</Section>
	);
}

function PoseSection() {
	const st = curState()!;
	const part = curPart();
	if (!part) return null;
	const sp = poseOfCur();
	return (
		<Section title="Pose" hint={`how "${part.name}" sits in this state`} tail={st.name}>
			{sp ? (
				<>
					<div class="fields">
						<Num label="x" value={(sp.offset ?? part.pivot ?? [0, 0])[0]} onChange={(v) => setPose(sp, { offset: [v, (sp.offset ?? part.pivot ?? [0, 0])[1]] }, "pose-x")} title="where the pivot lands" />
						<Num label="y" value={(sp.offset ?? part.pivot ?? [0, 0])[1]} onChange={(v) => setPose(sp, { offset: [(sp.offset ?? part.pivot ?? [0, 0])[0], v] }, "pose-y")} />
					</div>
					<Slider label="turn" value={(sp.rotate ?? 0) * DEG} min={-180} max={180} step={1} show={(v) => `${Math.round(v)}°`} onInput={(v) => setPose(sp, { rotate: v / DEG }, "pose-turn")} />
					<Slider label="size" value={sp.scale === undefined || sp.scale === 0 ? 1 : sp.scale} min={0.1} max={3} step={0.05} show={(v) => `${v.toFixed(2)}×`} onInput={(v) => setPose(sp, { scale: v }, "pose-size")} />
					<div class="line">
						<button class="btn small ghost" onClick={() => resetPose(sp)}>
							reset
						</button>
						<button class="btn small ghost" onClick={() => toggleMembership(ed.curState.value, part.name)}>
							hide in this state
						</button>
					</div>
				</>
			) : (
				<div class="line">
					<span class="chip" style="margin:0">not drawn in this state</span>
					<button class="btn small ghost" onClick={() => toggleMembership(ed.curState.value, part.name)}>
						add it
					</button>
				</div>
			)}
		</Section>
	);
}

function ChainRows({ k }: { k: number }) {
	const ps = parts();
	const cs = constraints();
	const part = ps[k];
	const mine = cs.map((c, i) => ({ c, i })).filter(({ c }) => c.chain[c.chain.length - 1] === part.name);
	const ren = renaming.value;
	const canStart = (part.anchors?.length ?? 0) > 0;
	return (
		<>
			{mine.map(({ c, i }) => {
				const root = ps.find((p) => p.name === c.chain[0]);
				return (
					<div class="card" style="margin-top:4px">
						<div class="line">
							{ren?.kind === "chain" && ren.index === i ? (
								<InlineName value={c.name} onCommit={(n) => (renameChain(i, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
							) : (
								<b onDblClick={() => (renaming.value = { kind: "chain", index: i })}>{c.name}</b>
							)}
							<span class="chip">{c.chain.join(" › ")}</span>
							<button class="btn x" title="delete chain" onClick={() => deleteChain(i)}>
								×
							</button>
						</div>
						<div class="line" style="gap:6px">
							<button class="btn small ghost" disabled={!root?.parent} title="one more part toward the root" onClick={() => root?.parent && setChain(i, [root.parent, ...c.chain], c.end)}>
								longer
							</button>
							<button class="btn small ghost" disabled={c.chain.length < 2} onClick={() => setChain(i, c.chain.slice(1), c.end)}>
								shorter
							</button>
							<select class="picker" value={c.end} onChange={(e) => setChain(i, c.chain, (e.target as HTMLSelectElement).value)} title="the anchor it reaches with">
								{(part.anchors ?? []).map((a) => (
									<option value={`${part.name}/${a.name}`}>{a.name}</option>
								))}
							</select>
							<select
								class="picker"
								value={c.bend ?? 0}
								title="which way an elbow folds"
								onChange={(e) => {
									const v = Number((e.target as HTMLSelectElement).value);
									setChainBend(i, v === 1 ? 1 : v === -1 ? -1 : undefined);
								}}
							>
								<option value={0}>bend either</option>
								<option value={1}>bend cw</option>
								<option value={-1}>bend ccw</option>
							</select>
						</div>
					</div>
				);
			})}
			<button
				class="add-row"
				disabled={!canStart}
				title={canStart ? "an IK chain reaching with this part's anchor" : "give the part an anchor first: that is what a chain reaches with"}
				onClick={() => {
					const chain = part.parent ? [part.parent, part.name] : [part.name];
					addChain(freshName(`${part.name} reach`, cs.map((c) => c.name)), chain, `${part.name}/${part.anchors![0].name}`);
					renaming.value = { kind: "chain", index: constraints().length - 1 };
				}}
			>
				<I.plus size={11} /> chain
			</button>
		</>
	);
}

function PartSection() {
	const k = ed.curPart.value;
	const part = parts()[k];
	if (!part) return null;
	const ps = parts();
	const ren = renaming.value;
	const posing = !!curState() || !!curClip();
	return (
		<Section title="Part" hint="a layer with a pivot: the unit that poses" tail={part.name}>
			<div class="line">
				<span class="k">name</span>
				<InlineName key={part.name} value={part.name} focus={false} class="field-name" onCommit={(n) => renamePart(k, n)} onCancel={() => {}} />
			</div>
			<div class="fields">
				<Num label="pivot x" value={(part.pivot ?? [0, 0])[0]} onChange={(v) => setPivotNumber(k, 0, v)} title="the point the part turns about and is placed by" />
				<Num label="pivot y" value={(part.pivot ?? [0, 0])[1]} onChange={(v) => setPivotNumber(k, 1, v)} />
			</div>
			<div class="line">
				<span class="k">parent</span>
				<select class="picker" style="flex:1" value={part.parent ?? ""} onChange={(e) => setParent(k, (e.target as HTMLSelectElement).value || undefined)} disabled={ps.length < 2} title="the part this one rides">
					<option value="">none</option>
					{parentCandidates(k).map((n) => (
						<option value={n}>{n}</option>
					))}
				</select>
			</div>
			{!posing && (
				<div class="line" style="gap:6px">
					<button class={`btn small ghost ${ed.pending.value === "pivot" ? "active" : ""}`} title="the next canvas click places the pivot" onClick={() => (ed.pending.value = ed.pending.value === "pivot" ? "none" : "pivot")}>
						<I.target size={12} /> set pivot
					</button>
					<button class={`btn small ghost ${ed.pending.value === "anchor" ? "active" : ""}`} title="the next canvas click places an anchor" onClick={() => (ed.pending.value = ed.pending.value === "anchor" ? "none" : "anchor")}>
						<I.anchor size={12} /> add anchor
					</button>
					<span class="spacer" />
					<button class="btn x" title={`raise: paints later (${k + 1} of ${ps.length})`} disabled={k === ps.length - 1} onClick={() => swapParts(k, k + 1)}>
						<I.up size={12} />
					</button>
					<button class="btn x" title="lower: paints earlier" disabled={k === 0} onClick={() => swapParts(k, k - 1)}>
						<I.down size={12} />
					</button>
				</div>
			)}
			{(part.anchors?.length ?? 0) > 0 && (
				<>
					<div class="hdr sub" title="named points a game or a chain reaches for">
						Anchors
					</div>
					{part.anchors!.map((a, i) => (
						<div class="line">
							{ren?.kind === "anchor" && ren.index === k && ren.sub === i ? (
								<InlineName value={a.name} onCommit={(n) => (renameAnchor(k, i, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
							) : (
								<span class="name" style="min-width:60px" onDblClick={() => (renaming.value = { kind: "anchor", index: k, sub: i })}>
									{a.name}
								</span>
							)}
							<Num label="x" value={a.at[0]} onChange={(v) => setAnchorNumber(k, i, 0, v)} />
							<Num label="y" value={a.at[1]} onChange={(v) => setAnchorNumber(k, i, 1, v)} />
							<button class="btn x" onClick={() => deleteAnchor(k, i)}>
								×
							</button>
						</div>
					))}
				</>
			)}
			<div class="hdr sub" title="inverse kinematics: drag the ring on the canvas and the chain follows">
				IK
			</div>
			<ChainRows k={k} />
		</Section>
	);
}

function ClipSection() {
	const c = curClip()!;
	const k = ed.curClip.value;
	return (
		<Section title="Clip" hint="states in time; the timeline below scrubs it" tail={c.name}>
			<div class="line">
				<span class={`check ${c.loop ? "on" : ""}`} onClick={() => setClipLoop(k, !c.loop)} />
				<span>loop</span>
				<span class="chip">
					{c.keys.length} key{c.keys.length === 1 ? "" : "s"}
				</span>
			</div>
			<div class="line">
				<span class="chip" style="margin:0;white-space:normal">keys name states: to change what a key looks like, pose that state</span>
			</div>
		</Section>
	);
}

function DocumentSection() {
	const d = ed.doc.value;
	const toks = palette();
	const shared = ed.shared.value;
	const [pick, setPick] = useState<{ k: number; x: number; y: number } | null>(null);
	const ren = renaming.value;
	return (
		<>
			<Section title="Document" hint="the file itself">
				<Text label="name" value={d.name ?? ""} placeholder="untitled" onChange={setDocName} />
				<div class="line">
					<span class="k">collision</span>
					<span class="chip" style="margin:0">
						{d.collision?.length ?? 0} shape{(d.collision?.length ?? 0) === 1 ? "" : "s"} · C to edit
					</span>
				</div>
			</Section>
			<Section title="Palette" hint="named colours; shapes name tokens, never colours">
				{toks.map((t, k) => (
					<div class={`row ${k === ed.curTok.value ? "active" : ""}`} onClick={() => (ed.curTok.value = k)} onDblClick={() => (renaming.value = { kind: "token", index: k })}>
						<button
							class="swatch"
							style={{ background: cssColor(t.rgb), border: "none", cursor: "pointer" }}
							title="edit the colour"
							onClick={(e) => {
								e.stopPropagation();
								const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
								setPick({ k, x: r.left, y: r.bottom + 6 });
							}}
						/>
						{ren?.kind === "token" && ren.index === k ? (
							<InlineName value={t.name} onCommit={(n) => (renameToken(k, n), (renaming.value = null))} onCancel={() => (renaming.value = null)} />
						) : (
							<span class="name">{t.name}</span>
						)}
						<button
							class="btn x"
							title="delete token"
							onClick={(e) => {
								e.stopPropagation();
								deleteToken(k);
							}}
						>
							×
						</button>
					</div>
				))}
				<button
					class="add-row"
					onClick={() => {
						addToken(freshName("token", toks.map((t) => t.name)));
						renaming.value = { kind: "token", index: palette().length - 1 };
					}}
				>
					<I.plus size={11} /> token
				</button>
				{shared.length > 0 && (
					<>
						<div class="hdr sub" title="from palette_refs: paint with them here, edit them in their own file">
							Shared
						</div>
						{shared.map((t) => (
							<div class="row dim">
								<span class="swatch" style={{ background: cssColor(t.rgb) }} />
								<span class="name">{t.name}</span>
							</div>
						))}
					</>
				)}
			</Section>
			{pick && toks[pick.k] && (
				<ColorPicker rgb={toks[pick.k].rgb} x={pick.x} y={pick.y} onChange={(rgb: Rgba) => setTokenColor(pick.k, rgb)} onClose={() => setPick(null)} />
			)}
		</>
	);
}

export function Inspector() {
	void ed.rev.value;
	const collide = ed.collide.value;
	const st = curState();
	const clip = curClip();
	const sh = collide ? colShape() : selShape();
	return (
		<div class="panel right inspector">
			{collide && (sh ? <ShapeSection sh={sh} collision /> : <Section title="Collision" hint="shapes a game may treat as solid; never drawn">
				<div class="empty">draw with the tools, or click a shape to select it</div>
			</Section>)}
			{!collide && clip && <ClipSection />}
			{!collide && !clip && sh && <ShapeSection sh={sh} collision={false} />}
			{!collide && !clip && st && <PoseSection />}
			{!collide && <PartSection />}
			{!collide && !clip && !sh && !st && <DocumentSection />}
		</div>
	);
}
