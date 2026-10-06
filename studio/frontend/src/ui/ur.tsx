// The Uranus components: the design system's primitives, in Preact. The
// styles are ur.css, the values are tokens.css; nothing here picks a
// colour or a size of its own. Menus drop from one layer (state/menu.ts),
// so every dropdown keys, dismisses and clips the same way.

import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ICONS, type IconName } from "./icons.ts";
import { openMenuBelow, menuAnchor, type MenuItem } from "../state/menu.ts";

export type { IconName };
export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Icon(p: { name: IconName; size?: number; strokeWidth?: number; class?: string; style?: JSX.CSSProperties }) {
	const size = p.size ?? 16;
	return (
		<svg
			class={cx("ur-icon", p.class)}
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			stroke-width={p.strokeWidth ?? 1.75}
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
			style={p.size ? { width: `${size}px`, height: `${size}px`, ...p.style } : p.style}
			dangerouslySetInnerHTML={{ __html: ICONS[p.name] ?? ICONS.file }}
		/>
	);
}

/** `~/Developer/…/meadium/art`: paths lose their middle, never their end. */
export function middleTruncate(s: string, max = 44): string {
	if (!s || s.length <= max) return s;
	const keep = max - 1;
	const head = Math.ceil(keep * 0.4);
	return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

/** Close an open surface when a pointer goes down outside it. */
function useDismiss(ref: { current: HTMLElement | null }, open: boolean, close: () => void) {
	useEffect(() => {
		if (!open) return;
		const down = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) close();
		};
		document.addEventListener("mousedown", down, true);
		return () => document.removeEventListener("mousedown", down, true);
	}, [open]);
}

// ------------------------------------------------------------- controls

export interface ButtonProps {
	variant?: "push" | "primary" | "danger" | "borderless" | "toolbar";
	icon?: IconName;
	active?: boolean;
	disabled?: boolean;
	title?: string;
	shortcut?: string;
	type?: "button" | "submit";
	class?: string;
	expanded?: boolean;
	onClick?: (e: MouseEvent) => void;
	children?: ComponentChildren;
}

export function Button(p: ButtonProps) {
	const v = p.variant ?? "push";
	return (
		<button
			type={p.type ?? "button"}
			class={cx("ur-btn", v === "primary" && "ur-btn-primary", v === "danger" && "ur-btn-danger", (v === "borderless" || v === "toolbar") && "ur-btn-borderless", v === "toolbar" && "ur-btn-icon", p.active && "ur-btn-active", p.class)}
			disabled={p.disabled}
			title={p.title}
			aria-label={p.title}
			aria-pressed={v === "toolbar" && p.active != null ? !!p.active : undefined}
			aria-expanded={p.expanded}
			onClick={p.onClick}
		>
			{p.icon && <Icon name={p.icon} />}
			{p.children}
			{p.shortcut && <span class="ur-kbd">{p.shortcut}</span>}
		</button>
	);
}

/** A button that drops a menu under itself. */
export function MenuButton(p: ButtonProps & { items: MenuItem[] | (() => MenuItem[]); align?: "left" | "right" }) {
	const ref = useRef<HTMLSpanElement>(null);
	const open = menuAnchor.value !== null && menuAnchor.value === ref.current;
	return (
		<span class="ur-anchor" ref={ref}>
			<Button {...p} expanded={open} onClick={() => ref.current && openMenuBelow(ref.current, typeof p.items === "function" ? p.items() : p.items, { align: p.align })} />
		</span>
	);
}

export function Chip(p: { variant?: "default" | "link"; mono?: boolean; title?: string; children?: ComponentChildren }) {
	return (
		<span class={cx("ur-chip", p.variant === "link" && "ur-chip-link", p.mono && "ur-chip-mono")} title={p.title}>
			{p.children}
		</span>
	);
}

export type SegOption<T extends string> = T | { value: T; label?: string; icon?: IconName; title?: string };

export function SegmentedControl<T extends string>(p: { options: SegOption<T>[]; value: T | null; onChange: (v: T) => void; label?: string }) {
	return (
		<div class="ur-seg" role="group" aria-label={p.label}>
			{p.options.map((o) => {
				const val = typeof o === "string" ? o : o.value;
				const lab = typeof o === "string" ? o : (o.label ?? (o.icon ? "" : o.value));
				return (
					<button key={val} type="button" title={typeof o === "string" ? undefined : o.title} aria-pressed={val === p.value} onClick={() => p.onChange(val)}>
						{typeof o !== "string" && o.icon && <Icon name={o.icon} size={14} />}
						{lab}
					</button>
				);
			})}
		</div>
	);
}

export interface NumberFieldProps {
	value: number | null | undefined;
	onChange: (v: number) => void;
	/** fired when the field is left, after a run of changes: one undo step */
	onDone?: () => void;
	step?: number;
	min?: number;
	max?: number;
	axis?: "x" | "y" | "z";
	suffix?: string;
	stepper?: boolean;
	placeholder?: string;
	width?: number | string;
	label?: string;
	title?: string;
	disabled?: boolean;
}

const tidy = (n: number) => String(+n.toFixed(3));

/**
 * A numeric field in tabular mono. Return or blur commits, Escape
 * restores, ↑ ↓ step (⇧ ×10), and the axis badge scrubs when dragged.
 */
export function NumberField(p: NumberFieldProps) {
	const shown = p.value != null && Number.isFinite(p.value) ? tidy(p.value) : "";
	const [v, set] = useState(shown);
	const live = useRef(false);
	useEffect(() => {
		if (!live.current) set(shown);
	}, [shown]);
	const step = p.step ?? 1;
	const clamp = (n: number) => {
		if (p.min != null) n = Math.max(p.min, n);
		if (p.max != null) n = Math.min(p.max, n);
		return +n.toFixed(3);
	};
	const commit = (raw: string) => {
		const n = parseFloat(raw);
		if (Number.isNaN(n)) return set(shown);
		const c = clamp(n);
		set(tidy(c));
		if (c !== p.value) p.onChange(c);
	};
	const bump = (d: number, mult = 1) => commit(String((parseFloat(v) || 0) + d * step * mult));
	const scrub = (e: PointerEvent) => {
		if (p.disabled) return;
		const el = e.currentTarget as HTMLElement;
		const x0 = e.clientX;
		const start = parseFloat(v) || 0;
		el.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => commit(String(start + Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1)));
		const up = () => {
			el.removeEventListener("pointermove", move);
			el.removeEventListener("pointerup", up);
			p.onDone?.();
		};
		el.addEventListener("pointermove", move);
		el.addEventListener("pointerup", up);
		e.preventDefault();
	};
	return (
		<div class={cx("ur-field", p.disabled && "disabled")} style={p.width ? { width: typeof p.width === "number" ? `${p.width}px` : p.width } : undefined} title={p.title}>
			{p.axis && (
				<span class={`ur-field-axis ${p.axis}`} onPointerDown={scrub}>
					{p.axis.toUpperCase()}
				</span>
			)}
			<input
				value={v}
				placeholder={p.placeholder}
				inputMode="decimal"
				disabled={p.disabled}
				aria-label={p.label ?? p.axis}
				onFocus={() => (live.current = true)}
				onInput={(e) => set((e.target as HTMLInputElement).value)}
				onBlur={() => {
					live.current = false;
					commit(v);
					p.onDone?.();
				}}
				onKeyDown={(e) => {
					e.stopPropagation();
					const el = e.target as HTMLInputElement;
					if (e.key === "Enter") {
						commit(v);
						el.blur();
					} else if (e.key === "ArrowUp") {
						e.preventDefault();
						bump(1, e.shiftKey ? 10 : 1);
					} else if (e.key === "ArrowDown") {
						e.preventDefault();
						bump(-1, e.shiftKey ? 10 : 1);
					} else if (e.key === "Escape") {
						set(shown);
						live.current = false;
						el.blur();
					}
				}}
			/>
			{p.suffix && <span class="ur-field-suffix">{p.suffix}</span>}
			{p.stepper !== false && (
				<div class="ur-field-step">
					<span onClick={() => (bump(1), p.onDone?.())} aria-label="Increment">
						<Icon name="chevron-up" />
					</span>
					<span onClick={() => (bump(-1), p.onDone?.())} aria-label="Decrement">
						<Icon name="chevron-down" />
					</span>
				</div>
			)}
		</div>
	);
}

export interface TextFieldProps {
	value: string;
	onChange?: (v: string) => void;
	onSubmit?: (v: string) => void;
	onBlur?: (v: string) => void;
	label?: string;
	placeholder?: string;
	icon?: IconName;
	clearable?: boolean;
	mono?: boolean;
	invalid?: boolean;
	hint?: string;
	trailing?: ComponentChildren;
	autoFocus?: boolean;
	readOnly?: boolean;
	class?: string;
}

let fieldIds = 0;

export function TextField(p: TextFieldProps) {
	const id = useRef(`urf${++fieldIds}`).current;
	const input = (
		<div class={cx("ur-tf", p.mono && "mono", p.invalid && "invalid")}>
			{p.icon && <Icon name={p.icon} size={14} />}
			<input
				id={id}
				value={p.value ?? ""}
				placeholder={p.placeholder}
				spellcheck={false}
				autocomplete="off"
				readOnly={p.readOnly}
				aria-invalid={!!p.invalid}
				ref={(el) => {
					if (el && p.autoFocus && !el.dataset.focused) {
						el.dataset.focused = "1";
						el.focus();
						el.select();
					}
				}}
				onInput={(e) => p.onChange?.((e.target as HTMLInputElement).value)}
				onBlur={(e) => p.onBlur?.((e.target as HTMLInputElement).value)}
				onKeyDown={(e) => {
					// the field owns its keys: the canvas shortcuts stay out of the typing
					if (e.key !== "Escape") e.stopPropagation();
					if (e.key === "Enter" && p.onSubmit) p.onSubmit((e.target as HTMLInputElement).value);
				}}
			/>
			{p.value && p.clearable && (
				<button type="button" class="ur-tf-clear" aria-label="Clear" onClick={() => p.onChange?.("")}>
					<Icon name="x" size={12} strokeWidth={2.5} />
				</button>
			)}
		</div>
	);
	if (!p.label && !p.hint && !p.trailing) return <div class={cx("ur-tf-wrap", p.class)}>{input}</div>;
	return (
		<div class={cx("ur-tf-wrap", p.class)}>
			{p.label && (
				<label for={id} class="ur-tf-label">
					{p.label}
				</label>
			)}
			<div class="ur-tf-row">
				{input}
				{p.trailing}
			</div>
			{p.hint && <div class={cx("ur-tf-hint", p.invalid && "invalid")}>{p.hint}</div>}
		</div>
	);
}

export function Checkbox(p: { checked: boolean; onChange: (v: boolean) => void; label?: ComponentChildren; disabled?: boolean; title?: string }) {
	return (
		<label class={cx("ur-checkbox", p.disabled && "disabled")} title={p.title}>
			<input type="checkbox" checked={!!p.checked} disabled={p.disabled} onChange={(e) => p.onChange((e.target as HTMLInputElement).checked)} />
			<span class="ur-checkbox-box" aria-hidden="true">
				{p.checked && <Icon name="check" strokeWidth={3} />}
			</span>
			{p.label}
		</label>
	);
}

/** A native select, dressed as a control: the platform draws the list. */
export function Select<T extends string>(p: { value: T; options: (T | { value: T; label: string })[]; onChange: (v: T) => void; title?: string; disabled?: boolean; width?: number }) {
	return (
		<span class="ur-select" title={p.title} style={p.width ? { width: `${p.width}px` } : undefined}>
			<select value={p.value} disabled={p.disabled} onChange={(e) => p.onChange((e.target as HTMLSelectElement).value as T)} onKeyDown={(e) => e.stopPropagation()}>
				{p.options.map((o) => (typeof o === "string" ? <option value={o}>{o}</option> : <option value={o.value}>{o.label}</option>))}
			</select>
			<Icon name="chevrons-up-down" size={12} />
		</span>
	);
}

export function Popover(p: { align?: "left" | "right" | "center"; width?: number; label?: string; onClose: () => void; children?: ComponentChildren }) {
	const ref = useRef<HTMLDivElement>(null);
	useDismiss(ref, true, p.onClose);
	return (
		<div
			ref={ref}
			class={cx("ur-popover", p.align === "right" && "right", p.align === "center" && "center")}
			role="dialog"
			aria-label={p.label}
			style={p.width ? { width: `${p.width}px` } : undefined}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					p.onClose();
				}
			}}
		>
			{p.children}
		</div>
	);
}

export interface SheetAction {
	label: string;
	primary?: boolean;
	danger?: boolean;
	disabled?: boolean;
	onClick: () => void;
}

/**
 * A sheet dropped from the top of the window. It is a form: Return is
 * the primary action (while it is enabled), Escape cancels.
 */
export function Sheet(p: { title: string; message?: ComponentChildren; children?: ComponentChildren; actions: SheetAction[]; footnote?: ComponentChildren; width?: number; onClose: () => void }) {
	const ref = useRef<HTMLFormElement>(null);
	useEffect(() => {
		// a sheet with no field still takes the keys: focus its primary button
		const el = ref.current;
		if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>("input, textarea") ?? el.querySelector<HTMLElement>("button[type=submit]"))?.focus();
	}, []);
	const submit = (e: Event) => {
		e.preventDefault();
		const pr = p.actions.find((a) => a.primary);
		if (pr && !pr.disabled) pr.onClick();
	};
	return (
		<div
			class="ur-sheet-scrim"
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Escape") p.onClose();
			}}
		>
			<form ref={ref} class="ur-sheet" role="dialog" aria-modal="true" aria-label={p.title} onSubmit={submit} style={p.width ? { width: `${p.width}px` } : undefined}>
				<div class="ur-sheet-title">{p.title}</div>
				{p.message && <p class="ur-sheet-msg">{p.message}</p>}
				{p.children && <div class="ur-sheet-body">{p.children}</div>}
				<div class="ur-sheet-foot">
					{p.footnote && <span class="ur-sheet-note">{p.footnote}</span>}
					{p.actions.map((a) => (
						<Button key={a.label} type={a.primary ? "submit" : "button"} variant={a.primary ? "primary" : a.danger ? "danger" : "push"} disabled={a.disabled} onClick={a.primary ? undefined : a.onClick}>
							{a.label}
						</Button>
					))}
				</div>
			</form>
		</div>
	);
}

// ------------------------------------------------------------- navigator

export interface SidebarRowProps {
	label: ComponentChildren;
	icon?: IconName;
	depth?: number;
	expandable?: boolean;
	open?: boolean;
	onToggle?: () => void;
	selected?: boolean;
	inactive?: boolean;
	current?: boolean;
	dim?: boolean;
	count?: number | string;
	chip?: string;
	link?: string;
	badge?: string;
	edited?: boolean;
	title?: string;
	class?: string;
	leading?: ComponentChildren;
	trailing?: ComponentChildren;
	onClick?: (e: MouseEvent) => void;
	onDoubleClick?: () => void;
	onContextMenu?: (e: MouseEvent) => void;
	onDelete?: () => void;
}

/** One 24px row of an outline. → expands, ← collapses, Return is the double click, ⌫ deletes. */
export function SidebarRow(p: SidebarRowProps) {
	return (
		<div
			class={cx("ur-row", p.selected && "selected", p.selected && p.inactive && "inactive", p.current && "current", p.dim && "dim", p.class)}
			style={{ paddingLeft: `${6 + (p.depth ?? 0) * 14}px` }}
			title={p.title}
			role="treeitem"
			tabIndex={p.selected || p.current ? 0 : -1}
			aria-selected={!!p.selected}
			aria-expanded={p.expandable ? !!p.open : undefined}
			onClick={p.onClick}
			onDblClick={p.onDoubleClick}
			onContextMenu={p.onContextMenu}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "ArrowRight" && p.expandable && !p.open) p.onToggle?.();
				else if (e.key === "ArrowLeft" && p.expandable && p.open) p.onToggle?.();
				else if (e.key === "Enter" && p.onDoubleClick) p.onDoubleClick();
				else if ((e.key === "Backspace" || e.key === "Delete") && p.onDelete) p.onDelete();
				else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
					// the next row, whatever group it is in
					const rows = [...(e.currentTarget.closest(".nav-body, .ur-tree")?.querySelectorAll<HTMLElement>(".ur-row") ?? [])];
					const next = rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
					if (next) {
						next.focus();
						next.click();
					}
				} else return;
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<span
				class={cx("ur-row-disc", p.open && "open")}
				onClick={
					p.onToggle &&
					((e) => {
						e.stopPropagation();
						p.onToggle!();
					})
				}
			>
				{p.expandable && <Icon name="chevron-right" strokeWidth={2.5} />}
			</span>
			{p.leading}
			{p.icon && <Icon name={p.icon} />}
			{p.edited && <span class="ur-dot" title="Edited" />}
			<span class="ur-row-label">{p.label}</span>
			<span class="ur-row-trail">
				{p.badge && <span class={`ur-row-badge ${p.badge}`}>{p.badge}</span>}
				{p.link && <Chip variant="link">{p.link}</Chip>}
				{p.chip && <Chip mono>{p.chip}</Chip>}
				{p.count != null && <span class="ur-row-count">{p.count}</span>}
				{p.trailing}
			</span>
		</div>
	);
}

/** "Parts", "States", "Clips": a group's name, with a + (one action, or a menu of them). */
export function GroupHeader(p: { children: ComponentChildren; title?: string; onAdd?: () => void; addItems?: MenuItem[] | (() => MenuItem[]); addLabel?: string; disabled?: boolean }) {
	const ref = useRef<HTMLButtonElement>(null);
	const items = p.addItems;
	return (
		<div class="ur-group" title={p.title}>
			{p.children}
			{(p.onAdd || items) && (
				<button
					ref={ref}
					type="button"
					disabled={p.disabled}
					aria-label={p.addLabel ?? "Add"}
					title={p.addLabel ?? "Add"}
					onClick={() => (items ? ref.current && openMenuBelow(ref.current, typeof items === "function" ? items() : items, { align: "right" }) : p.onAdd?.())}
				>
					<Icon name="plus" size={14} />
				</button>
			)}
		</div>
	);
}

export interface TabSpec<T extends string> {
	id: T;
	icon: IconName;
	label: string;
	badge?: number | string;
}

export function NavigatorTabs<T extends string>(p: { tabs: TabSpec<T>[]; value: T; onChange: (id: T) => void; inline?: boolean; label?: string }) {
	return (
		<div class={cx("ur-navtabs", p.inline && "inline")} role="tablist" aria-label={p.label}>
			{p.tabs.map((t) => (
				<button key={t.id} role="tab" type="button" title={t.label} aria-label={t.label} aria-selected={t.id === p.value} onClick={() => p.onChange(t.id)}>
					<Icon name={t.icon} />
					{t.badge ? <span class="ur-navtabs-badge">{t.badge}</span> : null}
				</button>
			))}
		</div>
	);
}

// ------------------------------------------------------------- inspector

const closedSections = new Set<string>();

/** A collapsible group of the inspector. Which ones are shut lasts the session. */
export function InspectorSection(p: { title: string; hint?: string; tail?: ComponentChildren; defaultOpen?: boolean; actions?: ComponentChildren; children?: ComponentChildren }) {
	const [open, setOpen] = useState(p.defaultOpen !== false && !closedSections.has(p.title));
	const toggle = () => {
		if (open) closedSections.add(p.title);
		else closedSections.delete(p.title);
		setOpen(!open);
	};
	return (
		<section class="ur-insp">
			<div
				class="ur-insp-head"
				role="button"
				tabIndex={0}
				title={p.hint}
				aria-expanded={open}
				onClick={toggle}
				onKeyDown={(e) => {
					if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
						e.preventDefault();
						toggle();
					}
				}}
			>
				<span class={cx("ur-row-disc", open && "open")}>
					<Icon name="chevron-right" strokeWidth={2.5} />
				</span>
				<span class="ur-insp-title">{p.title}</span>
				{p.tail && <span class="ur-insp-tail">{p.tail}</span>}
				{p.actions && (
					<span class="ur-insp-act" onClick={(e) => e.stopPropagation()}>
						{p.actions}
					</span>
				)}
			</div>
			{open && <div class="ur-insp-body">{p.children}</div>}
		</section>
	);
}

/** One label/control row: the label right-aligned in its 76px column. */
export function Property(p: { label: ComponentChildren; layout?: "pair" | "trio"; title?: string; children?: ComponentChildren }) {
	return (
		<div class="ur-prop" title={p.title}>
			<label>{p.label}</label>
			<div class={p.layout === "pair" ? "ur-prop-pair" : p.layout === "trio" ? "ur-prop-trio" : "ur-prop-one"}>{p.children}</div>
		</div>
	);
}

export function ColorRow(p: { name: ComponentChildren; color: string; hex?: string; selected?: boolean; dim?: boolean; title?: string; trailing?: ComponentChildren; onClick?: () => void; onDoubleClick?: () => void; onSwatch?: (e: MouseEvent) => void; onContextMenu?: (e: MouseEvent) => void; onDelete?: () => void }) {
	return (
		<div
			class={cx("ur-color", p.selected && "selected", p.dim && "dim")}
			title={p.title}
			role="option"
			tabIndex={0}
			aria-selected={!!p.selected}
			onClick={p.onClick}
			onDblClick={p.onDoubleClick}
			onContextMenu={p.onContextMenu}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "Enter") p.onClick?.();
				else if ((e.key === "Backspace" || e.key === "Delete") && p.onDelete) p.onDelete();
				else return;
				e.stopPropagation();
			}}
		>
			<span
				class="ur-swatch"
				style={{ background: p.color }}
				onClick={
					p.onSwatch &&
					((e) => {
						e.stopPropagation();
						p.onSwatch!(e);
					})
				}
			/>
			<span class="ur-color-name">{p.name}</span>
			{p.trailing}
			{p.hex !== "" && <span class="ur-color-hex">{p.hex ?? p.color}</span>}
		</div>
	);
}

// ------------------------------------------------------------- content

export type AssetKind = "2D" | "3D" | "scene" | "3D scene" | "palette" | "texture";
export const KIND_ICON: Record<AssetKind, IconName> = { "2D": "image", "3D": "box", scene: "layout-template", "3D scene": "layout-template", palette: "palette", texture: "brick-wall" };

export function AssetTile(p: { name: string; kind: AssetKind; folder?: string; thumbnail?: ComponentChildren; selected?: boolean; edited?: boolean; compact?: boolean; title?: string; onClick?: () => void; onOpen?: () => void; onContextMenu?: (e: MouseEvent) => void }) {
	return (
		<div
			class={cx("ur-tile", p.selected && "selected", p.compact && "compact")}
			title={p.title}
			role="option"
			tabIndex={0}
			aria-selected={!!p.selected}
			onClick={p.onClick}
			onDblClick={p.onOpen}
			onContextMenu={p.onContextMenu}
			onKeyDown={(e) => {
				if (e.key === "Enter") p.onOpen?.();
				else if (e.key === " ") p.onClick?.();
				else return;
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<div class="ur-tile-thumb">{p.thumbnail ?? <Icon name={KIND_ICON[p.kind] ?? "file"} size={p.compact ? 28 : 40} strokeWidth={1.25} />}</div>
			<div class="ur-tile-meta">
				<div class="ur-tile-name">
					{p.edited && <span class="ur-dot ur-dot-inline" />}
					{p.name}
				</div>
				<div class="ur-tile-sub">
					<Icon name={KIND_ICON[p.kind] ?? "file"} />
					{p.kind}
					{p.folder && ` · ${p.folder}`}
				</div>
			</div>
		</div>
	);
}

export interface ToolItem {
	id: string;
	icon: IconName;
	label: string;
	key?: string;
	/** an on/off mode (collision, snap) rather than one of the tools */
	toggle?: boolean;
	disabled?: boolean;
	/** why it is off, for the tooltip */
	why?: string;
}

/** The drawing tools, then the modes. Inline, it sits in the path bar: nothing floats over the canvas. */
export function ToolPalette(p: { tools: (ToolItem | "|")[]; value?: string; toggles?: Record<string, boolean>; onChange?: (id: string) => void; onToggle?: (id: string, on: boolean) => void; inline?: boolean }) {
	return (
		<div class={cx("ur-palette", p.inline && "inline")} role="toolbar" aria-label="Tools">
			{p.tools.map((t, i) => {
				if (t === "|") return <span key={`sep${i}`} class="ur-palette-sep" />;
				const on = t.toggle ? !!p.toggles?.[t.id] : t.id === p.value;
				return (
					<button
						key={t.id}
						type="button"
						class={cx("ur-tool", t.toggle && "toggle")}
						data-tool={t.id}
						disabled={t.disabled}
						title={t.disabled && t.why ? t.why : `${t.label}${t.key ? ` (${t.key})` : ""}`}
						aria-label={t.label}
						aria-pressed={on}
						onClick={() => (t.toggle ? p.onToggle?.(t.id, !on) : p.onChange?.(t.id))}
					>
						<Icon name={t.icon} />
						{t.key && !p.inline && <span class="ur-tool-key">{t.key}</span>}
					</button>
				);
			})}
		</div>
	);
}

/** Top-left of the content header: the project over its branch, one fixed-width dropdown. */
export function ProjectPicker(p: { project: string; branch?: string; icon?: IconName; width?: number; items: () => MenuItem[] }) {
	const ref = useRef<HTMLSpanElement>(null);
	const width = p.width ?? 220;
	const open = menuAnchor.value !== null && menuAnchor.value === ref.current;
	return (
		<span class="ur-anchor" ref={ref}>
			<button type="button" class="ur-loc" style={{ width: `${width}px` }} aria-haspopup="menu" aria-expanded={open} title={`${p.project}${p.branch ? ` · ${p.branch}` : ""}`} onClick={() => ref.current && openMenuBelow(ref.current, p.items(), { minWidth: width, class: "ur-loc-menu" })}>
				<span class="ur-loc-icon">
					<Icon name={p.icon ?? "folder"} size={14} />
				</span>
				<span class="ur-loc-text">
					<span class="ur-loc-project">{p.project}</span>
					<span class="ur-loc-detail">
						<Icon name="git-branch" size={11} />
						<span class="ur-loc-path">{p.branch || "no branch"}</span>
					</span>
				</span>
				<Icon name="chevrons-up-down" size={14} class="ur-loc-chev" />
			</button>
		</span>
	);
}

export interface CrumbItem {
	/** names the segment for the keys that open it ("asset", "state") */
	id?: string;
	label: string;
	icon?: IconName;
	tag?: string;
	edited?: boolean;
	menu?: () => MenuItem[];
	onClick?: () => void;
}

function Crumb({ item, last }: { item: CrumbItem; last: boolean }) {
	const ref = useRef<HTMLSpanElement>(null);
	const open = menuAnchor.value !== null && menuAnchor.value === ref.current;
	return (
		<span class="ur-anchor ur-crumb-wrap" ref={ref} style={last ? { flexShrink: 0.3 } : undefined}>
			<button
				type="button"
				class={cx("ur-crumb", last && "last")}
				data-crumb={item.id}
				title={item.label}
				aria-haspopup={item.menu ? "menu" : undefined}
				aria-expanded={item.menu ? open : undefined}
				onClick={() => {
					const items = item.menu?.();
					if (items?.length && ref.current) openMenuBelow(ref.current, items);
					else item.onClick?.();
				}}
			>
				{item.edited && <span class="ur-dot" aria-label="Edited" />}
				{item.icon && <Icon name={item.icon} size={14} />}
				<span class="ur-crumb-label">{item.label}</span>
				{item.tag && <span class="ur-tag">{item.tag}</span>}
			</button>
		</span>
	);
}

/** Under the content header: back and forward, the breadcrumb (every segment a menu of its siblings), the view's controls. */
export function PathBar(p: { items: CrumbItem[]; canBack?: boolean; canForward?: boolean; onBack?: () => void; onForward?: () => void; children?: ComponentChildren }) {
	return (
		<div class="ur-pathbar" role="toolbar" aria-label="Path bar">
			<span class="ur-pathbar-nav">
				<Button variant="toolbar" icon="chevron-left" title="Back (⌘[)" disabled={!p.canBack} onClick={p.onBack} class="ur-btn-sm" />
				<Button variant="toolbar" icon="chevron-right" title="Forward (⌘])" disabled={!p.canForward} onClick={p.onForward} class="ur-btn-sm" />
			</span>
			<nav class="ur-crumbs" aria-label="Breadcrumb">
				{p.items.map((it, i) => (
					<>
						{i > 0 && (
							<span class="ur-jump-chev">
								<Icon name="chevron-right" strokeWidth={2.5} />
							</span>
						)}
						<Crumb item={it} last={i === p.items.length - 1} />
					</>
				))}
			</nav>
			{p.children && <div class="ur-pathbar-tools">{p.children}</div>}
		</div>
	);
}

/** A strip under the content: what the view is doing on the left, small read-outs on the right. */
export function StatusBar(p: { children?: ComponentChildren; trailing?: ComponentChildren }) {
	return (
		<div class="ur-statusbar" role="status">
			<span class="ur-statusbar-text">{p.children}</span>
			{p.trailing && <span class="ur-statusbar-trail">{p.trailing}</span>}
		</div>
	);
}

export interface ActivityDetails {
	log: { icon?: IconName; text: string; time: string }[];
	actions?: { label: string; primary?: boolean; shortcut?: string; disabled?: boolean; onClick: () => void }[];
}

/** The pill at the centre of the content header: project, branch, and what Uranus is doing now. */
export function ActivityView(p: { project: string; branch?: string; status: "saved" | "edited" | "busy" | "error"; message?: string; progress?: number; details?: ActivityDetails }) {
	const [open, setOpen] = useState(false);
	const s = p.status;
	const body = (
		<>
			<Icon name="folder-git-2" size={14} />
			<b>{p.project}</b>
			{p.branch && <span class="ur-activity-branch">· {p.branch}</span>}
			<span class={cx("ur-activity-status", s === "saved" && "ok", s === "edited" && "edited")}>
				{s === "saved" && (
					<>
						<Icon name="circle-check" />
						{p.message || "Saved"}
					</>
				)}
				{s === "edited" && (
					<>
						<span class="ur-dot" />
						{p.message || "Edited"}
					</>
				)}
				{s === "busy" && (
					<>
						<span class="ur-activity-msg">{p.message || "Working…"}</span>
						<span class={cx("ur-activity-bar", p.progress == null && "indeterminate")}>
							<i style={{ width: `${Math.round((p.progress ?? 0.3) * 100)}%` }} />
						</span>
					</>
				)}
				{s === "error" && (
					<>
						<Icon name="triangle-alert" class="ur-danger" />
						<span class="ur-activity-msg">{p.message || "Error"}</span>
					</>
				)}
			</span>
		</>
	);
	const d = p.details;
	if (!d)
		return (
			<div class="ur-activity" role="status">
				{body}
			</div>
		);
	return (
		<span class="ur-anchor ur-activity-anchor">
			<button type="button" class="ur-activity" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
				{body}
			</button>
			{open && (
				<Popover align="center" width={320} label="Activity" onClose={() => setOpen(false)}>
					<div class="ur-pop-title">Activity</div>
					<div class="ur-log">
						{d.log.length === 0 && <div class="ur-log-row ur-log-empty">Nothing yet</div>}
						{d.log.map((l, i) => (
							<div key={i} class="ur-log-row">
								<Icon name={l.icon ?? "circle-dot"} size={14} />
								<span class="ur-log-text" title={l.text}>
									{l.text}
								</span>
								<span class="ur-log-time">{l.time}</span>
							</div>
						))}
					</div>
					{d.actions?.length ? (
						<div class="ur-pop-foot">
							{d.actions.map((a) => (
								<Button
									key={a.label}
									variant={a.primary ? "primary" : "push"}
									disabled={a.disabled}
									shortcut={a.shortcut}
									onClick={() => {
										setOpen(false);
										a.onClick();
									}}
								>
									{a.label}
								</Button>
							))}
						</div>
					) : null}
				</Popover>
			)}
		</span>
	);
}

/**
 * The 52px header a column owns. `lights` marks the header the traffic
 * lights sit in: the platform draws them, the header leaves them room
 * (and takes it back in full screen). The header drags the window.
 */
export function PaneHeader(p: { pane?: "sidebar" | "content" | "canvas"; lights?: boolean; center?: ComponentChildren; leading?: ComponentChildren; title?: string; trailing?: ComponentChildren; children?: ComponentChildren }) {
	const pane = p.pane ?? "content";
	if (p.center) {
		return (
			<header class={cx("ur-pane-head", `ur-pane-head-${pane}`, "centered", p.lights && "lights")}>
				<div class="ur-pane-left">
					{p.leading}
					{p.children}
				</div>
				<div class="ur-pane-center">{p.center}</div>
				<div class="ur-pane-right">{p.trailing}</div>
			</header>
		);
	}
	return (
		<header class={cx("ur-pane-head", `ur-pane-head-${pane}`, p.lights && "lights")}>
			{p.leading}
			{p.title && <span class="ur-pane-title">{p.title}</span>}
			<div class="ur-pane-main">{p.children}</div>
			{p.trailing && <div class="ur-pane-trail">{p.trailing}</div>}
		</header>
	);
}

/** Shows or hides a side column, from that column's own header. */
export function PaneToggle(p: { side: "left" | "right"; open: boolean; onClick: () => void }) {
	const name = p.side === "left" ? "navigator (⌘0)" : "inspector (⌥⌘0)";
	return <Button variant="toolbar" icon={p.side === "left" ? "panel-left" : "panel-right"} title={`${p.open ? "Hide" : "Show"} ${name}`} onClick={p.onClick} />;
}

/** A centred "nothing here" with one way forward. */
export function EmptyState(p: { icon?: IconName; title: string; message?: string; children?: ComponentChildren }) {
	return (
		<div class="ur-empty">
			{p.icon && <Icon name={p.icon} size={40} strokeWidth={1.25} />}
			<div class="ur-empty-title">{p.title}</div>
			{p.message && <div class="ur-empty-msg">{p.message}</div>}
			{p.children}
		</div>
	);
}
