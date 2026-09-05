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
	/** Since 1.2: light this slot gives off, 0 or absent for none. The game decides what that means. */
	emissive?: number;
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
	/** Since 1.2: the direction an attached thing points, radians in the part's rest space. */
	angle?: number;
	[extra: string]: unknown;
}

export interface Part {
	name: string;
	/** Since 1.1: the part this one is posed relative to. */
	parent?: string;
	/** Absent means [0, 0]; with `like`, absent means the source part's pivot. */
	pivot?: Vec2;
	/** Since 1.2: this part's shapes and anchors are that part's. It has none of its own. */
	like?: string;
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
	/** Since 1.2: flipped left-to-right about the pivot, before the turn. */
	mirror?: boolean;
	[extra: string]: unknown;
}

/** Since 1.2: where a chain should reach in this pose, document space. */
export interface Target {
	chain: string;
	at: Vec2;
	[extra: string]: unknown;
}

export interface State {
	name: string;
	/** Paint order. Parts left out are not drawn. */
	parts: StatePart[];
	/** Since 1.2: chains this pose reaches with; the parts' rotations hold the solved pose too. */
	targets?: Target[];
	[extra: string]: unknown;
}

export type Ease = "linear" | "in" | "out" | "in-out" | "step";

/** Since 1.2: a cubic bezier's two control points, [x1, y1, x2, y2], x in 0..1. */
export type Curve = [number, number, number, number];

/** One moment in a clip: a time, and a pose named or inline. */
export interface ClipKey {
	/** Seconds. */
	t: number;
	state?: string;
	parts?: StatePart[];
	/** How time approaches this key from the previous one. Absent means linear. */
	ease?: Ease;
	/** Since 1.2: a bezier easing that wins over `ease` where a reader knows it. */
	curve?: Curve;
	/** Since 1.2: chains this key reaches with, tweened toward the next key's. */
	targets?: Target[];
	/** Since 1.2: names a runtime hears when the playhead crosses this key. */
	events?: string[];
	[extra: string]: unknown;
}

/** Since 1.1: states in time. */
export interface Clip {
	name: string;
	/** Time wraps at the last key. Absent means false. */
	loop?: boolean;
	/** In non-decreasing t, at least one. */
	keys: ClipKey[];
	[extra: string]: unknown;
}

/** Since 1.1: an inverse-kinematics chain a runtime may solve live. */
export interface Constraint {
	name: string;
	/** Parts root-first, each parented to the previous. */
	chain: string[];
	/** "part/anchor" on the chain's last part. */
	end: string;
	/** Preferred elbow direction where a solution is ambiguous. */
	bend?: 1 | -1;
	[extra: string]: unknown;
}

export interface Doc {
	version: 1;
	name?: string;
	palette_refs?: string[];
	palette?: Token[];
	parts?: Part[];
	states?: State[];
	clips?: Clip[];
	constraints?: Constraint[];
	collision?: Shape[];
	meta?: Record<string, unknown>;
	[extra: string]: unknown;
}

/** The format major this library speaks. */
export const FORMAT_VERSION = 1;
/** The minor: what this library knows past the major. */
export const FORMAT_MINOR = 2;

/** What an unresolvable token renders as: loud, on purpose. */
export const MAGENTA: Rgba = [255, 0, 255, 255];
