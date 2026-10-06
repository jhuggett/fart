// A part's shapes as rows under it in the outline: what the part is made
// of, in file order, each a kind, the colour it names and a swatch. Shapes
// have no names in the format, so a row's label is composed from what the
// file holds. The model screen and the 2D editor both list them this way.

import { Component, type ComponentChildren } from "preact";
import { signal } from "@preact/signals";
import { SidebarRow, cx, type IconName } from "./ur.tsx";

/** A part with more shapes than this starts folded. */
export const MANY_SHAPES = 12;

/**
 * Which parts are open in an outline: the ones the user opened or folded
 * (by key, for the session, never saved), and for the rest a default: a
 * part with children or a few shapes is open, one holding many shapes and
 * no children is folded.
 */
export function folding() {
	const chosen = signal<ReadonlyMap<string, boolean>>(new Map());
	const set = (key: string, open: boolean) => {
		if (chosen.peek().get(key) === open) return;
		const n = new Map(chosen.peek());
		n.set(key, open);
		chosen.value = n;
	};
	return {
		chosen,
		isOpen: (key: string, shapes: number, kids: number) => chosen.value.get(key) ?? (kids > 0 || shapes <= MANY_SHAPES),
		/** the same, read without subscribing */
		peekOpen: (key: string, shapes: number, kids: number) => chosen.peek().get(key) ?? (kids > 0 || shapes <= MANY_SHAPES),
		set,
	};
}

/** A part opens to rows when it has child parts or more than one shape: a part of one shape is that shape. */
export const opens = (shapes: number, kids: number) => kids > 0 || shapes > 1;

/**
 * The rows' labels: the kind and the colour ("mesh · white_plate"), and a
 * number after it, in file order, only where two of the same part would
 * read the same ("mesh · slit 1", "mesh · slit 2").
 */
export function shapeLabels(shapes: readonly { color?: string }[], word: (i: number) => string): string[] {
	const base = shapes.map((sh, i) => (sh.color ? `${word(i)} · ${sh.color}` : word(i)));
	const total = new Map<string, number>();
	for (const b of base) total.set(b, (total.get(b) ?? 0) + 1);
	const seen = new Map<string, number>();
	return base.map((b) => {
		if (total.get(b) === 1) return b;
		const n = (seen.get(b) ?? 0) + 1;
		seen.set(b, n);
		return `${b} ${n}`;
	});
}

/** What a shape row does; one object per outline, so a row's props stay the same between renders. */
export interface ShapeRowActs {
	pick: (part: number, shape: number, e: MouseEvent) => void;
	menu: (part: number, shape: number, e: MouseEvent) => void;
	remove: (part: number, shape: number) => void;
}

export interface ShapeRowProps {
	part: number;
	shape: number;
	depth: number;
	icon: IconName;
	label: string;
	/** the colour token resolved to css; undefined when the palette has no such colour */
	color?: string;
	/** the token it names, for the tooltip */
	token?: string;
	title: string;
	selected: boolean;
	inactive: boolean;
	dim: boolean;
	acts: ShapeRowActs;
}

/**
 * One shape of a part. It draws again only when one of its own props
 * changes, so a list of hundreds stays still while a drag on the canvas
 * rewrites the document under it.
 */
export class ShapeRow extends Component<ShapeRowProps> {
	shouldComponentUpdate(next: ShapeRowProps) {
		const now = this.props as unknown as Record<string, unknown>;
		const then = next as unknown as Record<string, unknown>;
		for (const k in then) if (then[k] !== now[k]) return true;
		return false;
	}
	render(): ComponentChildren {
		const p = this.props;
		return (
			<SidebarRow
				class="ur-shape"
				depth={p.depth}
				icon={p.icon}
				label={p.label}
				title={p.title}
				selected={p.selected}
				inactive={p.inactive}
				dim={p.dim}
				trailing={p.token ? <span class={cx("ur-swatch", p.color === undefined && "missing")} style={p.color === undefined ? undefined : { background: p.color }} /> : undefined}
				onClick={(e) => p.acts.pick(p.part, p.shape, e)}
				onContextMenu={(e) => p.acts.menu(p.part, p.shape, e)}
				onDelete={() => p.acts.remove(p.part, p.shape)}
			/>
		);
	}
}

/** Bring the selected shape's row into view, once the outline has drawn it. */
export function revealShapeRow() {
	requestAnimationFrame(() => document.querySelector<HTMLElement>(".outline .ur-shape.selected")?.scrollIntoView({ block: "nearest" }));
}
