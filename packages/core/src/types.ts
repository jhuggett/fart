// The Fast Art Format, as TypeScript. A Doc is the JSON itself: optional
// fields stay optional, unknown fields ride along untouched (index
// signatures), and the accessors in geometry.ts supply the defaults the
// spec promises. Nothing here is a class; a .fart is data.

/** [x, y]. y-down, x-right, in the project's world units. */
export type Vec2 = [number, number];

/** [r, g, b, a], each 0..255. The field is called rgb; it holds four. */
export type Rgba = [number, number, number, number];

export interface Token {
	name: string;
	rgb: Rgba;
	[extra: string]: unknown;
}

export interface CircleShape {
	kind: "circle";
	/** A palette token. Required inside a part, optional in collision. */
	color?: string;
	at: Vec2;
	r: number;
	[extra: string]: unknown;
}

export interface LineShape {
	kind: "line";
	color?: string;
	a: Vec2;
	b: Vec2;
	/** Stroke width, round caps. As collision, the capsule's girth. */
	w: number;
	[extra: string]: unknown;
}

export interface PolyShape {
	kind: "poly";
	color?: string;
	points: Vec2[];
	/** Index triples into points, baked on save. Absent: triangulate yourself. */
	tris?: number[];
	[extra: string]: unknown;
}

export type Shape = CircleShape | LineShape | PolyShape;
export type ShapeKind = Shape["kind"];

export interface Anchor {
	name: string;
	at: Vec2;
	[extra: string]: unknown;
}

export interface Part {
	name: string;
	/** Absent means [0, 0]. */
	pivot?: Vec2;
	shapes?: Shape[];
	anchors?: Anchor[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

export interface StatePart {
	part: string;
	/** Where the pivot lands. Absent means the pivot itself (rest). */
	offset?: Vec2;
	/** Radians about the pivot. Absent means 0. */
	rotate?: number;
	/** Absent or 0 means 1. */
	scale?: number;
	[extra: string]: unknown;
}

export interface State {
	name: string;
	/** Paint order. Parts left out are not drawn. */
	parts: StatePart[];
	[extra: string]: unknown;
}

export interface Doc {
	version: 1;
	name?: string;
	palette_refs?: string[];
	palette?: Token[];
	parts?: Part[];
	states?: State[];
	collision?: Shape[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

/** The format major this library speaks. */
export const FORMAT_VERSION = 1;

/** What an unresolvable token renders as: loud, on purpose. */
export const MAGENTA: Rgba = [255, 0, 255, 255];
