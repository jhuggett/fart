import { test } from "node:test";
import assert from "node:assert/strict";
import { docBounds, posePoint, shapeDistance, triangulate, unposePoint, type Doc, type Part, type Vec2 } from "../src/index.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const nearV = (a: Vec2, b: Vec2) => {
	near(a[0], b[0]);
	near(a[1], b[1]);
};

function polyArea(pts: Vec2[]): number {
	let a = 0;
	for (let i = 0; i < pts.length; i++) {
		const j = (i + 1) % pts.length;
		a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
	}
	return Math.abs(a) / 2;
}
function triArea(a: Vec2, b: Vec2, c: Vec2): number {
	return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
}
function checkTriangulation(pts: Vec2[]) {
	const tris = triangulate(pts);
	assert.equal(tris.length, (pts.length - 2) * 3, "n-2 triangles");
	let sum = 0;
	for (let k = 0; k < tris.length; k += 3) {
		const t = triArea(pts[tris[k]], pts[tris[k + 1]], pts[tris[k + 2]]);
		assert.ok(t > 0, "no degenerate triangles");
		sum += t;
	}
	near(sum, polyArea(pts), 1e-6);
}

test("triangulate a square, either winding", () => {
	checkTriangulation([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
	checkTriangulation([[-1, -1], [-1, 1], [1, 1], [1, -1]]);
});

test("triangulate a concave arrow", () => {
	checkTriangulation([[0, -6], [6, 0], [2, 0], [2, 6], [-2, 6], [-2, 0], [-6, 0]]);
});

test("triangulate refuses less than three points", () => {
	assert.deepEqual(triangulate([[0, 0], [1, 1]]), []);
});

const part: Part = { name: "arm", pivot: [3, -4] };

test("an absent offset is the rest pose", () => {
	nearV(posePoint([5, -4], part, { part: "arm" }), [5, -4]);
	nearV(posePoint([5, -4], part, { part: "arm", offset: [3, -4] }), [5, -4]);
});

test("rotate turns about the pivot, scale grows from it, offset lands the pivot", () => {
	nearV(posePoint([5, -4], part, { part: "arm", rotate: Math.PI / 2 }), [3, -2]);
	nearV(posePoint([5, -4], part, { part: "arm", scale: 2 }), [7, -4]);
	nearV(posePoint([5, -4], part, { part: "arm", offset: [0, 0] }), [2, 0]);
	nearV(posePoint([5, -4], part, { part: "arm", scale: 0 }), [5, -4]); // 0 means 1
});

test("unposePoint inverts posePoint", () => {
	const sp = { part: "arm", offset: [10, 10] as Vec2, rotate: 0.7, scale: 1.5 };
	const p: Vec2 = [4.2, -1.3];
	nearV(unposePoint(posePoint(p, part, sp), part, sp), p);
});

test("shapeDistance is zero on the paint and grows off it", () => {
	assert.equal(shapeDistance({ kind: "circle", at: [0, 0], r: 2 }, [1, 0]), 0);
	near(shapeDistance({ kind: "circle", at: [0, 0], r: 2 }, [5, 0]), 3);
	assert.equal(shapeDistance({ kind: "line", a: [0, 0], b: [10, 0], w: 2 }, [5, 0.9]), 0);
	near(shapeDistance({ kind: "line", a: [0, 0], b: [10, 0], w: 2 }, [5, 3]), 2);
	const sq = { kind: "poly" as const, points: [[0, 0], [4, 0], [4, 4], [0, 4]] as Vec2[] };
	assert.equal(shapeDistance(sq, [2, 2]), 0);
	near(shapeDistance(sq, [6, 2]), 2);
});

test("docBounds covers strokes and caps", () => {
	const doc: Doc = {
		version: 1,
		parts: [{ name: "a", shapes: [{ kind: "line", color: "x", a: [0, 0], b: [10, 0], w: 2 }, { kind: "circle", color: "x", at: [0, 5], r: 1 }] }],
	};
	const b = docBounds(doc)!;
	nearV(b.lo, [-1, -1]);
	nearV(b.hi, [11, 6]);
	assert.equal(docBounds({ version: 1 }), null);
});
