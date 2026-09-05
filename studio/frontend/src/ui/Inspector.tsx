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
	doc,
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
	movePartInState,
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
	linkPalette,
	unlinkPalette,
	overrideToken,
	anchorsIn,
	setAnchorAngle,
	likeCandidates,
	setLike,
	targetOf,
	clearTarget,
	setTokenEmissive,
} from "../state/editor.ts";
import { renaming, openContextMenu, type MenuItem } from "../state/menu.ts";
import { paletteFiles } from "../state/project.ts";
import { askNewPalette } from "./fileMenu.ts";
import { basename, stripExt } from "../state/paths.ts";

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

function PoseBlock() {
	const st = curState();
	const part = curPart();
	if (!part || !st) return null;
	const sp = poseOfCur();
	return (
		<>
			<div class="hdr sub" title={`how "${part.name}" sits in the state "${st.name}"`}>
				In {st.name}
			</div>
			{sp ? (
				<>
					<div class="fields">
						<Num label="x" value={(sp.offset ?? part.pivot ?? [0, 0])[0]} onChange={(v) => setPose(sp, { offset: [v, (sp.offset ?? part.pivot ?? [0, 0])[1]] }, "pose-x")} title="where the pivot lands" />
						<Num label="y" value={(sp.offset ?? part.pivot ?? [0, 0])[1]} onChange={(v) => setPose(sp, { offset: [(sp.offset ?? part.pivot ?? [0, 0])[0], v] }, "pose-y")} />
					</div>
					<Slider label="turn" value={(sp.rotate ?? 0) * DEG} min={-180} max={180} step={1} show={(v) => `${Math.round(v)}°`} onInput={(v) => setPose(sp, { rotate: v / DEG }, "pose-turn")} />
					<Slider label="size" value={sp.scale === undefined || sp.scale === 0 ? 1 : sp.scale} min={0.1} max={3} step={0.05} show={(v) => `${v.toFixed(2)}×`} onInput={(v) => setPose(sp, { scale: v }, "pose-size")} />
					<div class="line">
						<span class={`check ${sp.mirror ? "on" : ""}`} title="flipped left-to-right about the pivot, before the turn" onClick={() => setPose(sp, { mirror: !sp.mirror })} />
						<span>mirror</span>
					</div>
					<div class="line">
						<button class="btn small ghost" onClick={() => resetPose(sp)}>
							reset
						</button>
						<button class="btn small ghost" onClick={() => toggleMembership(ed.curState.value, part.name)}>
							leave out of this state
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
		</>
	);
}

function ChainRows({ k }: { k: number }) {
	const ps = parts();
	const cs = constraints();
	const part = ps[k];
	const mine = cs.map((c, i) => ({ c, i })).filter(({ c }) => c.chain[c.chain.length - 1] === part.name);
	const ren = renaming.value;
	const anchors = anchorsIn(part);
	const canStart = anchors.length > 0;
	return (
		<>
			{mine.map(({ c, i }) => {
				const root = ps.find((p) => p.name === c.chain[0]);
				const pin = targetOf(c.name);
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
								{anchors.map((a) => (
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
						{pin && (
							<div class="line">
								<span class="chip" style="margin:0" title="the chain keeps reaching this point while the pose changes; drag the ring to move it">
									pinned at {pin.at[0]}, {pin.at[1]}
								</span>
								<button class="btn small ghost" title="let go: the rotations stay, the pin is gone" onClick={() => clearTarget(c.name)}>
									release
								</button>
							</div>
						)}
					</div>
				);
			})}
			<button
				class="add-row"
				disabled={!canStart}
				title={canStart ? "an IK chain reaching with this part's anchor" : "give the part an anchor first: that is what a chain reaches with"}
				onClick={() => {
					const chain = part.parent ? [part.parent, part.name] : [part.name];
					addChain(freshName(`${part.name} reach`, cs.map((c) => c.name)), chain, `${part.name}/${anchors[0].name}`);
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
	const ren = renaming.value;
	const preview = !!curClip();
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
				<select class="picker" style="flex:1" value={part.parent ?? ""} onChange={(e) => setParent(k, (e.target as HTMLSelectElement).value || undefined)} disabled={parts().length < 2} title="the part this one rides">
					<option value="">none</option>
					{parentCandidates(k).map((n) => (
						<option value={n}>{n}</option>
					))}
				</select>
			</div>
			<div class="line">
				<span class="k">drawn like</span>
				<select
					class="picker"
					style="flex:1"
					value={part.like ?? ""}
					disabled={!part.like && (!!part.shapes?.length || !!part.anchors?.length) ? true : likeCandidates(k).length === 0}
					title={
						!part.like && (part.shapes?.length || part.anchors?.length)
							? "a part drawn like another has no shapes of its own: empty this one first"
							: "draw another part's shapes and anchors (the left claw is the right one, mirrored in the state)"
					}
					onChange={(e) => setLike(k, (e.target as HTMLSelectElement).value || undefined)}
				>
					<option value="">itself</option>
					{likeCandidates(k).map((n) => (
						<option value={n}>{n}</option>
					))}
				</select>
			</div>
			{!preview && (
				<div class="line" style="gap:6px">
					<button class={`btn small ghost ${ed.pending.value === "pivot" ? "active" : ""}`} title="the next canvas click places the pivot" onClick={() => (ed.pending.value = ed.pending.value === "pivot" ? "none" : "pivot")}>
						<I.target size={12} /> set pivot
					</button>
					<button class={`btn small ghost ${ed.pending.value === "anchor" ? "active" : ""}`} title="the next canvas click places an anchor" onClick={() => (ed.pending.value = ed.pending.value === "anchor" ? "none" : "anchor")}>
						<I.anchor size={12} /> add anchor
					</button>
					<span class="spacer" />
					<button class="btn x" title="raise: paints later in this state" onClick={() => movePartInState(part.name, true)}>
						<I.up size={12} />
					</button>
					<button class="btn x" title="lower: paints earlier in this state" onClick={() => movePartInState(part.name, false)}>
						<I.down size={12} />
					</button>
				</div>
			)}
			{!preview && <PoseBlock />}
			{anchorsIn(part).length > 0 && (
				<>
					<div class="hdr sub" title="named points a game or a chain reaches for; a direction makes one a socket">
						Anchors{part.like ? ` (${part.like}'s)` : ""}
					</div>
					{anchorsIn(part).map((a, i) => (
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
							{a.angle === undefined ? (
								<button class="btn x" title="give it a direction: what attaches here points this way" onClick={() => setAnchorAngle(k, i, 0)}>
									↗
								</button>
							) : (
								<Num label="dir°" value={Math.round(a.angle * DEG)} onChange={(v) => setAnchorAngle(k, i, v / DEG, `angle-${i}`)} title="the direction an attached thing points; clear with the ×" />
							)}
							<button class="btn x" title={a.angle === undefined ? "delete anchor" : "drop the direction"} onClick={() => (a.angle === undefined ? deleteAnchor(k, i) : setAnchorAngle(k, i, undefined))}>
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
	const d = doc();
	const toks = palette();
	const shared = ed.shared.value;
	const refs = d.palette_refs ?? [];
	const missing = new Set(ed.unresolved.value);
	const local = new Set(toks.map((t) => t.name));
	const [pick, setPick] = useState<{ k: number; x: number; y: number } | null>(null);
	const ren = renaming.value;
	const linkMenu = (e: MouseEvent) => {
		const cur = ed.path.value;
		const linked = new Set(refs);
		const items: MenuItem[] = paletteFiles()
			.filter((f) => f !== cur)
			.map((f) => ({ label: stripExt(f), disabled: linked.has(f), run: () => linkPalette(f) }));
		items.push({
			label: "New palette…",
			sep: items.length > 0,
			run: () => void askNewPalette("", false).then((rel) => rel && linkPalette(rel)),
		});
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		openContextMenu(r.left, r.bottom + 4, items);
	};
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
			<Section title="Colours" hint="the file's colour slots: a shape names a slot, this says what it means today. Change one and every shape follows.">
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
						{(t.emissive ?? 0) > 0 && (
							<span class="chip" title="emissive: gives off light in a game that has it">
								☀ {t.emissive}
							</span>
						)}
						<button
							class="btn x"
							title="delete colour"
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
						addToken(freshName("colour", toks.map((t) => t.name)));
						renaming.value = { kind: "token", index: palette().length - 1 };
					}}
				>
					<I.plus size={11} /> colour
				</button>
				<div class="hdr sub" title="palette files this one draws from, by slot name. The file's own colours win.">
					Shared palettes
				</div>
				{refs.map((ref, i) => (
					<div class={`row ${missing.has(ref) ? "dim" : ""}`} title={ref}>
						<I.grid size={11} />
						<span class="name">{stripExt(basename(ref))}</span>
						{missing.has(ref) && <span class="chip">missing</span>}
						<button class="btn x" title="unlink: stop drawing from it" onClick={() => unlinkPalette(i)}>
							×
						</button>
					</div>
				))}
				<button class="add-row" onClick={linkMenu} title="draw from a palette file in this project">
					<I.plus size={11} /> link
				</button>
				{shared.length > 0 && (
					<>
						<div class="hdr sub" title="slots the linked palettes supply: paint with them here, change them in their own file, or override one">
							From shared
						</div>
						{shared.map((t) => (
							<div class="row dim">
								<span class="swatch" style={{ background: cssColor(t.rgb) }} />
								<span class="name">{t.name}</span>
								{local.has(t.name) ? (
									<span class="chip" title="this file has its own colour for the slot">overridden</span>
								) : (
									<button class="btn small ghost" title="copy the slot into this file, so it can be changed here" onClick={() => overrideToken(t.name)}>
										override
									</button>
								)}
							</div>
						))}
					</>
				)}
			</Section>
			{pick && toks[pick.k] && (
				<ColorPicker rgb={toks[pick.k].rgb} emissive={toks[pick.k].emissive ?? 0} onEmissive={(v) => setTokenEmissive(pick.k, v)} x={pick.x} y={pick.y} onChange={(rgb: Rgba) => setTokenColor(pick.k, rgb)} onClose={() => setPick(null)} />
			)}
		</>
	);
}

export function Inspector() {
	void ed.rev.value;
	const collide = ed.collide.value;
	const clip = curClip();
	const sh = collide ? colShape() : selShape();
	return (
		<div class="panel right inspector">
			{collide && (sh ? <ShapeSection sh={sh} collision /> : <Section title="Collision" hint="shapes a game may treat as solid; never drawn">
				<div class="empty">draw with the tools, or click a shape to select it</div>
			</Section>)}
			{!collide && clip && <ClipSection />}
			{!collide && !clip && sh && <ShapeSection sh={sh} collision={false} />}
			{!collide && <PartSection />}
			{!collide && !clip && !sh && <DocumentSection />}
		</div>
	);
}
