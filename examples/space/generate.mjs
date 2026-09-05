// examples/space: a top-down space set that exercises the whole format.
import { bakeTris, solveTargets, stringifyDoc, validate } from "@fastart/core";
import fs from "node:fs";
import path from "node:path";

const OUT = new URL(".", import.meta.url).pathname;
const col = (color) => (color === undefined ? {} : { color });
const P = (color, points) => ({ kind: "poly", ...col(color), points });
const C = (color, at, r) => ({ kind: "circle", ...col(color), at, r });
const L = (color, a, b, w) => ({ kind: "line", ...col(color), a, b, w });
const mx = (pts) => pts.map(([x, y]) => [-x, y]).reverse();
const mirrorShape = (s) =>
	s.kind === "poly" ? { ...s, points: mx(s.points) } : s.kind === "circle" ? { ...s, at: [-s.at[0], s.at[1]] } : { ...s, a: [-s.a[0], s.a[1]], b: [-s.b[0], s.b[1]] };
const part = (name, pivot, shapes, extra = {}) => ({ name, pivot, shapes, ...extra });
const mirrorPart = (p, name, extra = {}) => ({
	...p,
	name,
	pivot: [-p.pivot[0], p.pivot[1]],
	shapes: p.shapes.map(mirrorShape),
	...(p.anchors ? { anchors: p.anchors.map((a) => ({ name: a.name.replace(/_l$/, "_r"), at: [-a.at[0], a.at[1]] })) } : {}),
	...extra,
});
const st = (name, parts) => ({ name, parts });
const k = (t, state, ease) => ({ t, state, ...(ease ? { ease } : {}) });
const clip = (name, keys, loop = false) => ({ name, loop, keys });
const rad = (deg) => (deg * Math.PI) / 180;
const polar = (r, deg) => [+(r * Math.cos(rad(deg))).toFixed(2), +(r * Math.sin(rad(deg))).toFixed(2)];

const docs = {};
const D = (rel, doc) => (docs[rel] = { version: 1, ...doc });
const REF = ["../palettes/hull.fart"];

// ---- palettes: the slots every file names, and two swaps for them
D("palettes/hull.fart", {
	name: "hull",
	palette: [
		{ name: "hull", rgb: [150, 160, 175, 255] },
		{ name: "hull_dark", rgb: [92, 100, 114, 255] },
		{ name: "trim", rgb: [235, 125, 60, 255] },
		{ name: "glass", rgb: [120, 205, 235, 255] },
		{ name: "glow", rgb: [255, 225, 130, 255], emissive: 1 },
		{ name: "flame", rgb: [255, 140, 50, 255], emissive: 1.5 },
		{ name: "flame_core", rgb: [255, 242, 205, 255], emissive: 2 },
		{ name: "metal", rgb: [205, 210, 220, 255] },
		{ name: "warn", rgb: [235, 75, 60, 255] },
		{ name: "rock", rgb: [125, 110, 95, 255] },
		{ name: "rock_dark", rgb: [82, 72, 62, 255] },
		{ name: "ore", rgb: [110, 205, 160, 255] },
	],
});
D("palettes/pirate.fart", {
	name: "pirate",
	palette: [
		{ name: "hull", rgb: [125, 62, 62, 255] },
		{ name: "hull_dark", rgb: [72, 36, 36, 255] },
		{ name: "trim", rgb: [240, 205, 70, 255] },
		{ name: "glass", rgb: [235, 130, 120, 255] },
		{ name: "glow", rgb: [255, 130, 120, 255] },
		{ name: "flame", rgb: [255, 85, 60, 255] },
		{ name: "flame_core", rgb: [255, 230, 200, 255] },
		{ name: "metal", rgb: [170, 150, 150, 255] },
		{ name: "warn", rgb: [255, 90, 70, 255] },
	],
});
D("palettes/alliance.fart", {
	name: "alliance",
	palette: [
		{ name: "hull", rgb: [72, 104, 152, 255] },
		{ name: "hull_dark", rgb: [42, 62, 98, 255] },
		{ name: "trim", rgb: [245, 245, 245, 255] },
		{ name: "glass", rgb: [155, 225, 255, 255] },
		{ name: "glow", rgb: [155, 205, 255, 255] },
		{ name: "flame", rgb: [120, 180, 255, 255] },
		{ name: "flame_core", rgb: [232, 246, 255, 255] },
		{ name: "metal", rgb: [200, 212, 230, 255] },
		{ name: "warn", rgb: [255, 120, 90, 255] },
	],
});

// ---- fighter: a small ship with banking wings and throttled flames
{
	const wing_l = part("wing_l", [-3, 1], [
		P("hull_dark", [[-3, -3], [-10, 3.5], [-10, 7], [-3, 6.5]]),
		P("hull", [[-3.2, -1.5], [-9, 4], [-9, 6.2], [-3.2, 5.5]]),
		L("trim", [-9.5, 4], [-9.5, 6.5], 0.7),
		C("warn", [-9.2, 5.3], 0.55),
	], { parent: "hull", anchors: [{ name: "gun_l", at: [-9.5, 3.5], angle: -Math.PI / 2 }] });
	const wing_r = mirrorPart(wing_l, "wing_r");
	wing_r.shapes[3] = C("ore", [9.2, 5.3], 0.55); // green to starboard, as at sea
	// the engines: one drawn, the other drawn like it and mirrored in every state (1.2);
	// its flame rides the mirror, so it needs none of its own
	const engine_l = part("engine_l", [-1.7, 8.5], [
		P("metal", [[-2.7, 4.5], [-0.7, 4.5], [-0.7, 8.5], [-2.7, 8.5]]),
		P("hull_dark", [[-2.4, 8.5], [-1, 8.5], [-1, 9], [-2.4, 9]]),
	], { parent: "hull", anchors: [{ name: "exhaust", at: [-1.7, 9], angle: Math.PI / 2 }] });
	const engine_r = { name: "engine_r", like: "engine_l", parent: "hull", pivot: [-1.7, 8.5] };
	const flame_l = part("flame_l", [-1.7, 9], [
		P("flame", [[-2.5, 9], [-0.9, 9], [-1.7, 13.5]]),
		P("flame_core", [[-2.1, 9], [-1.3, 9], [-1.7, 11.5]]),
	], { parent: "engine_l" });
	const flame_r = { name: "flame_r", like: "flame_l", parent: "engine_r", pivot: [-1.7, 9] };
	const body = ["hull", "wing_l", "wing_r", "engine_l", "engine_r", "cockpit"];
	const all = ["flame_l", "flame_r", ...body];
	const entry = (p, extra = {}) => (p === "engine_r" ? { part: p, mirror: true, offset: [1.7, 8.5], ...extra } : { part: p, ...extra });
	const withFlames = (scale) => all.map((p) => (p.startsWith("flame") ? entry(p, { scale }) : entry(p)));
	D("ships/fighter.fart", {
		name: "fighter",
		palette_refs: REF,
		parts: [
			flame_l,
			flame_r,
			part("hull", [0, 0], [
				P("hull_dark", [[0, -12], [3.4, -4], [3.4, 6], [0, 8.5], [-3.4, 6], [-3.4, -4]]),
				P("hull", [[0, -11], [2.8, -4], [2.8, 5.6], [0, 7.6], [-2.8, 5.6], [-2.8, -4]]),
				L("trim", [0, -6], [0, 4], 0.8),
			], { anchors: [{ name: "nose", at: [0, -12], angle: -Math.PI / 2 }] }),
			wing_l,
			wing_r,
			engine_l,
			engine_r,
			part("cockpit", [0, -3], [P("glass", [[0, -7.5], [1.5, -3], [0, -0.5], [-1.5, -3]])], { parent: "hull" }),
		],
		states: [
			st("idle", body.map((p) => entry(p))),
			st("thrust", withFlames(1)),
			st("burn", withFlames(1.6)),
			st("bank_l", body.map((p) => (p === "wing_l" ? entry(p, { scale: 0.75 }) : p === "wing_r" ? entry(p, { scale: 1.08 }) : p === "hull" ? entry(p, { rotate: -0.1 }) : entry(p)))),
			st("bank_r", body.map((p) => (p === "wing_r" ? entry(p, { scale: 0.75 }) : p === "wing_l" ? entry(p, { scale: 1.08 }) : p === "hull" ? entry(p, { rotate: 0.1 }) : entry(p)))),
		],
		clips: [
			clip("thrust", [k(0, "thrust"), k(0.1, "burn", "in-out"), k(0.2, "thrust", "in-out")], true),
			// a back-out curve: the bank overshoots a touch and settles (1.2)
			clip("bank_left", [k(0, "idle"), { ...k(0.25, "bank_l", "out"), curve: [0.34, 1.56, 0.64, 1] }]),
			clip("bank_right", [k(0, "idle"), { ...k(0.25, "bank_r", "out"), curve: [0.34, 1.56, 0.64, 1] }]),
		],
		collision: [P(undefined, [[0, -12], [3.4, -4], [10, 3.5], [10, 7], [3.4, 7], [0, 8.5], [-3.4, 7], [-10, 7], [-10, 3.5], [-3.4, -4]])],
	});
}

// ---- cruiser: a capital ship with turrets that ride the hull and sweep
{
	const pod_l = part("pod_l", [-10, 26], [
		P("metal", [[-12, 6], [-8, 6], [-8, 26], [-12, 26]]),
		P("hull_dark", [[-11.6, 26], [-8.4, 26], [-8.4, 26.8], [-11.6, 26.8]]),
	], { parent: "hull", anchors: [{ name: "exhaust", at: [-10, 26.8], angle: Math.PI / 2 }] });
	const pod_r = { name: "pod_r", like: "pod_l", parent: "hull", pivot: [-10, 26] };
	const flame_l = part("flame_l", [-10, 26.8], [
		P("flame", [[-11.8, 26.8], [-8.2, 26.8], [-10, 36]]),
		P("flame_core", [[-11, 26.8], [-9, 26.8], [-10, 32]]),
	], { parent: "pod_l" });
	const flame_r = { name: "flame_r", like: "flame_l", parent: "pod_r", pivot: [-10, 26.8] };
	const turret = (name, y, dir) => [
		part(name, [0, y], [C("hull_dark", [0, y], 3), C("metal", [0, y], 2.4)], { parent: "hull" }),
		part(`barrel_${name.split("_")[1]}`, [0, y], [L("hull_dark", [0, y], [0, y + dir * 7], 1.3)], {
			parent: name,
			anchors: [{ name: "muzzle", at: [0, y + dir * 7], angle: dir < 0 ? -Math.PI / 2 : Math.PI / 2 }],
		}),
	];
	const body = ["pod_l", "pod_r", "hull", "bridge", "turret_fore", "barrel_fore", "turret_aft", "barrel_aft"];
	const all = ["flame_l", "flame_r", ...body];
	const entry = (p, extra = {}) => (p === "pod_r" ? { part: p, mirror: true, offset: [10, 26], ...extra } : { part: p, ...extra });
	const posed = (flame, turn) =>
		all.map((p) => (p.startsWith("flame") ? entry(p, { scale: flame }) : p.startsWith("turret") && turn ? entry(p, { rotate: turn }) : entry(p)));
	D("ships/cruiser.fart", {
		name: "cruiser",
		palette_refs: REF,
		parts: [
			flame_l,
			flame_r,
			pod_l,
			pod_r,
			part("hull", [0, 0], [
				P("hull_dark", [[0, -33], [5.5, -24], [8.5, -10], [8.5, 21], [5.5, 29], [-5.5, 29], [-8.5, 21], [-8.5, -10], [-5.5, -24]]),
				P("hull", [[0, -31.5], [4.6, -23.5], [7.4, -10], [7.4, 20.5], [4.8, 27.8], [-4.8, 27.8], [-7.4, 20.5], [-7.4, -10], [-4.6, -23.5]]),
				P("hull_dark", [[-5, -6], [5, -6], [5, 8], [-5, 8]]),
				L("trim", [-6.5, -8], [-6.5, 18], 0.9),
				L("trim", [6.5, -8], [6.5, 18], 0.9),
				P("hull_dark", [[-8.5, 10], [-11.5, 10], [-11.5, 13], [-8.5, 13]]),
				P("hull_dark", [[8.5, 10], [11.5, 10], [11.5, 13], [8.5, 13]]),
				C("glow", [-3, 24], 0.6),
				C("glow", [3, 24], 0.6),
				C("warn", [0, -29], 0.7),
			], { anchors: [{ name: "nose", at: [0, -33] }] }),
			part("bridge", [0, -10], [P("metal", [[-3, -15], [3, -15], [3, -5], [-3, -5]]), C("glass", [0, -11], 1.6)], { parent: "hull" }),
			...turret("turret_fore", -20, -1),
			...turret("turret_aft", 18, -1),
		],
		states: [
			st("idle", body.map((p) => entry(p))),
			st("cruise", posed(1, 0)),
			st("cruise_hi", posed(1.35, 0)),
			st("turrets_left", posed(1, -0.8)),
			st("turrets_right", posed(1, 0.8)),
		],
		clips: [
			clip("cruise", [k(0, "cruise"), k(0.35, "cruise_hi", "in-out"), k(0.7, "cruise", "in-out")], true),
			clip("sweep", [k(0, "cruise"), k(1.2, "turrets_left", "in-out"), k(3.6, "turrets_right", "in-out"), k(4.8, "cruise", "in-out")], true),
		],
		collision: [
			P(undefined, [[0, -33], [5.5, -24], [8.5, -10], [8.5, 21], [5.5, 29], [-5.5, 29], [-8.5, 21], [-8.5, -10], [-5.5, -24]]),
			P(undefined, [[-12, 6], [-8, 6], [-8, 26], [-12, 26]]),
			P(undefined, [[8, 6], [12, 6], [12, 26], [8, 26]]),
		],
	});
}

// ---- drone: a two-bone arm with a chain, for reaching at things
D("ships/drone.fart", {
	name: "drone",
	palette_refs: REF,
	parts: [
		part("arm_a", [0, 3.5], [L("metal", [0, 3.5], [0, 9.5], 1.7), C("hull_dark", [0, 3.5], 1.1)], { parent: "body" }),
		part("arm_b", [0, 9.5], [
			L("metal", [0, 9.5], [0, 14], 1.4),
			C("hull_dark", [0, 9.5], 0.9),
			L("hull_dark", [0, 14], [-1.6, 16.2], 0.9),
			L("hull_dark", [0, 14], [1.6, 16.2], 0.9),
		], { parent: "arm_a", anchors: [{ name: "tip", at: [0, 14], angle: Math.PI / 2 }] }),
		part("body", [0, 0], [
			C("hull_dark", [0, 0], 4.8),
			C("hull", [0, 0], 4.1),
			P("metal", [[-6.5, -1.5], [-4.5, -1.5], [-4.5, 2], [-6.5, 2]]),
			P("metal", [[4.5, -1.5], [6.5, -1.5], [6.5, 2], [4.5, 2]]),
			C("glass", [0, -1.4], 1.5),
			C("glow", [-2.6, 2.4], 0.5),
			C("glow", [2.6, 2.4], 0.5),
		]),
	],
	states: [
		st("idle", [{ part: "arm_a" }, { part: "arm_b" }, { part: "body" }]),
		st("folded", [{ part: "arm_a", rotate: 2.5 }, { part: "arm_b", rotate: -2.7 }, { part: "body" }]),
		{ ...st("reach_l", [{ part: "arm_a", rotate: 1.3 }, { part: "arm_b", rotate: -0.5 }, { part: "body" }]), targets: [{ chain: "arm", at: [-9.5, 9.5] }] },
		st("reach_r", [{ part: "arm_a", rotate: -1.3 }, { part: "arm_b", rotate: 0.5 }, { part: "body" }]),
	],
	clips: [clip("grab", [k(0, "folded"), k(0.45, "idle", "out"), { ...k(0.9, "reach_l", "in-out"), events: ["grab"] }, k(1.4, "folded", "in")])],
	constraints: [{ name: "arm", chain: ["arm_a", "arm_b"], end: "arm_b/tip", bend: 1 }],
	collision: [C(undefined, [0, 0], 4.8)],
});

// ---- station: a ring that turns, docks that ride it, a beacon that blinks
{
	const ring = [];
	for (let i = 0; i < 8; i++) ring.push(L("metal", polar(9, i * 45), polar(17.5, i * 45), 1.4));
	for (let i = 0; i < 24; i++) ring.push(L("hull", polar(18, i * 15), polar(18, (i + 1) * 15), 2.2));
	const dock = (deg) => {
		const pts = [[-2.5, -21.5], [2.5, -21.5], [2.5, -18], [-2.5, -18]];
		const a = rad(deg);
		return P("metal", pts.map(([x, y]) => [+(x * Math.cos(a) - y * Math.sin(a)).toFixed(2), +(x * Math.sin(a) + y * Math.cos(a)).toFixed(2)]));
	};
	ring.push(dock(0), dock(90), dock(180), dock(270));
	D("structures/station.fart", {
		name: "station",
		palette_refs: REF,
		parts: [
			part("ring", [0, 0], ring, {
				parent: "core",
				anchors: [
					{ name: "dock_n", at: [0, -21.5], angle: -Math.PI / 2 },
					{ name: "dock_e", at: [21.5, 0], angle: 0 },
					{ name: "dock_s", at: [0, 21.5], angle: Math.PI / 2 },
					{ name: "dock_w", at: [-21.5, 0], angle: Math.PI },
				],
			}),
			part("core", [0, 0], [
				C("hull_dark", [0, 0], 9.5),
				C("hull", [0, 0], 8.5),
				C("hull_dark", [0, 0], 4),
				C("glass", [0, 0], 3),
				...[45, 135, 225, 315].map((d) => C("glow", polar(6.2, d), 0.7)),
			]),
			part("beacon", [0, 0], [C("warn", [0, -9.5], 0.9)], { parent: "core" }),
		],
		states: [
			st("on", [{ part: "ring" }, { part: "core" }, { part: "beacon" }]),
			st("off", [{ part: "ring" }, { part: "core" }]),
			st("turn_a", [{ part: "ring", rotate: 2.0944 }, { part: "core" }, { part: "beacon" }]),
			st("turn_b", [{ part: "ring", rotate: 4.1888 }, { part: "core" }, { part: "beacon" }]),
		],
		clips: [
			clip("spin", [k(0, "on"), k(5, "turn_a"), k(10, "turn_b"), k(15, "on")], true),
			clip("blink", [{ ...k(0, "on"), events: ["beacon"] }, k(0.6, "off", "step"), k(1.2, "on", "step")], true),
		],
		collision: [C(undefined, [0, 0], 19)],
	});
}

// ---- rocks: lumpy, with a slow tumble
const rock = (rel, name, radii, craters, ore, period) => {
	const n = radii.length;
	const outer = radii.map((r, i) => polar(r, (i * 360) / n - 90));
	const inner = radii.map((r, i) => polar(r * 0.86, (i * 360) / n - 90));
	D(rel, {
		name,
		palette_refs: REF,
		parts: [
			part("rock", [0, 0], [
				P("rock_dark", outer),
				P("rock", inner),
				...craters.map(([x, y, r]) => C("rock_dark", [x, y], r)),
				...(ore ? [P("ore", ore)] : []),
			]),
		],
		states: [
			st("idle", [{ part: "rock" }]),
			st("turn_a", [{ part: "rock", rotate: 2.0944 }]),
			st("turn_b", [{ part: "rock", rotate: 4.1888 }]),
		],
		clips: [clip("tumble", [k(0, "idle"), k(period / 3, "turn_a"), k((2 * period) / 3, "turn_b"), k(period, "idle")], true)],
		collision: [P(undefined, outer)],
	});
};
rock("rocks/asteroid_big.fart", "asteroid_big", [10, 11.5, 9.2, 10.8, 12, 9.5, 8.8, 11, 10.2, 9, 11.4], [[-3, -2, 2], [4, 3, 1.4], [1, -5, 1]], [[3, -3], [5.5, -1.5], [4, 0.5], [2, -1]], 18);
rock("rocks/asteroid_small.fart", "asteroid_small", [4.2, 5, 3.8, 4.6, 5.2, 4, 4.8, 4.3], [[-1.2, 0.8, 0.9]], null, 9);

// ---- projectiles
D("projectiles/laser.fart", {
	name: "laser",
	palette_refs: REF,
	parts: [part("bolt", [0, 0], [L("glow", [0, -4], [0, 4], 1.4), L("flame_core", [0, -3.5], [0, 3.5], 0.55)], { anchors: [{ name: "tip", at: [0, -4] }] })],
	states: [st("idle", [{ part: "bolt" }])],
	collision: [L(undefined, [0, -4], [0, 4], 1.4)],
});
D("projectiles/missile.fart", {
	name: "missile",
	palette_refs: REF,
	parts: [
		part("flame", [0, 4], [P("flame", [[-1.1, 4], [1.1, 4], [0, 9]]), P("flame_core", [[-0.6, 4], [0.6, 4], [0, 7]])], { parent: "body" }),
		part("body", [0, 0], [
			P("metal", [[0, -5], [1.3, -2.5], [1.3, 4], [-1.3, 4], [-1.3, -2.5]]),
			P("warn", [[0, -5], [1.3, -2.5], [-1.3, -2.5]]),
			P("hull_dark", [[-1.3, 1.5], [-3, 4.5], [-1.3, 4.5]]),
			P("hull_dark", [[1.3, 1.5], [1.3, 4.5], [3, 4.5]]),
		], { anchors: [{ name: "tip", at: [0, -5] }, { name: "exhaust", at: [0, 4] }] }),
	],
	states: [
		st("flying", [{ part: "flame" }, { part: "body" }]),
		st("burn_hi", [{ part: "flame", scale: 1.5 }, { part: "body" }]),
		st("coasting", [{ part: "body" }]),
	],
	clips: [clip("burn", [k(0, "flying"), k(0.08, "burn_hi", "in-out"), k(0.16, "flying", "in-out")], true)],
	collision: [P(undefined, [[0, -5], [1.3, -2.5], [1.3, 4], [-1.3, 4], [-1.3, -2.5]])],
});

// ---- an explosion: scale does the work, membership ends it
{
	const shards = [];
	for (let i = 0; i < 8; i++) shards.push(L("glow", polar(5.5, i * 45 + 22.5), polar(9, i * 45 + 22.5), 1.1));
	D("effects/explosion.fart", {
		name: "explosion",
		palette_refs: REF,
		parts: [part("blast", [0, 0], [C("flame", [0, 0], 5.5)]), part("shards", [0, 0], shards), part("core", [0, 0], [C("flame_core", [0, 0], 3)])],
		states: [
			st("mid", [{ part: "blast", scale: 1.1 }, { part: "shards" }, { part: "core" }]),
			st("start", [{ part: "blast", scale: 0.15 }, { part: "shards", scale: 0.1 }, { part: "core", scale: 0.2 }]),
			st("end", [{ part: "blast", scale: 2.2 }, { part: "shards", scale: 2.6 }]),
		],
		clips: [clip("boom", [k(0, "start"), k(0.16, "mid", "out"), k(0.55, "end", "in")])],
	});
}

// ---- a pickup that bobs
D("pickups/crate.fart", {
	name: "crate",
	palette_refs: REF,
	parts: [
		part("box", [0, 0], [
			P("hull_dark", [[-3.2, -3.2], [3.2, -3.2], [3.2, 3.2], [-3.2, 3.2]]),
			P("hull", [[-2.6, -2.6], [2.6, -2.6], [2.6, 2.6], [-2.6, 2.6]]),
			L("trim", [-3.2, 0], [3.2, 0], 0.8),
			L("trim", [0, -3.2], [0, 3.2], 0.8),
			C("glow", [0, 0], 0.9),
		]),
	],
	states: [st("rest", [{ part: "box" }]), st("up", [{ part: "box", offset: [0, -1.2] }])],
	clips: [clip("bob", [k(0, "rest"), k(0.7, "up", "in-out"), k(1.4, "rest", "in-out")], true)],
	collision: [P(undefined, [[-3.2, -3.2], [3.2, -3.2], [3.2, 3.2], [-3.2, 3.2]])],
});

// ---- write, baked (tris, and the rotations pinned targets solve to), and look each one over
let bad = 0;
for (const [rel, doc] of Object.entries(docs)) {
	bakeTris(doc);
	for (const st of doc.states ?? []) if (st.targets?.length) solveTargets(doc, st.parts, st.targets);
	const full = path.join(OUT, rel);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, stringifyDoc(doc));
	const r = validate(doc, { refTokens: null });
	if (r.errors.length) {
		bad++;
		console.log(rel, r.errors.map((e) => `${e.code} ${e.path}: ${e.message}`).join("; "));
	}
}
console.log(`${Object.keys(docs).length} files, ${bad} with errors`);
