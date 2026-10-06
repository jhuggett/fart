package fastart_test

// Format 1.8 against the reference loader: paint, shades, mods, pipes,
// parity with @fastart/core point for point, and the compiled sidecar.
//
// Two of these read what node made:
//   parity.json           node loaders/odin/test/parity.mjs
//   name.fart.glb         node packages/core/dist/cli.js build spec/examples/valid examples/helm
// Without them (or with a .fart that has changed since) those checks say
// so and pass over the file: they never fail for want of a build.

import "core:encoding/json"
import "core:fmt"
import "core:log"
import "core:math"
import "core:os"
import "core:testing"
import fart ".."

ROOT :: #directory + "/../../../"

V18_FILES :: [4]string{"spec/examples/valid/paint.fart", "spec/examples/valid/mods.fart", "spec/examples/valid/pipe.fart", "examples/helm/helm.fart"}

@(private = "file")
read :: proc(rel: string) -> ([]byte, bool) {
	data, err := os.read_entire_file(fmt.tprintf("%s%s", ROOT, rel), context.temp_allocator)
	return data, err == nil
}

@(test)
source_hash_vectors :: proc(t: ^testing.T) {
	none := fart.source_hash_hex(nil)
	testing.expect_value(t, string(none[:]), "cbf29ce484222325")
	a := fart.source_hash_hex(transmute([]byte)string("a"))
	testing.expect_value(t, string(a[:]), "af63dc4c8601ec8c")
	testing.expect_value(t, fart.source_hash(nil), u64(0xcbf29ce484222325))
}

// The new valid files load, and every part of them flattens to triangles
// that carry their tokens and shades.
@(test)
v18_corpus :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	for file in V18_FILES {
		data, ok := read(file)
		if !testing.expectf(t, ok, "%s should be readable", file) do continue
		doc, dok := fart.load_bytes_3d(data)
		if !testing.expectf(t, dok, "%s should load", file) do continue
		for &part in doc.parts {
			tms := make([dynamic]fart.Tri_Mesh)
			fart.flatten_part(&doc, &part, &tms)
			testing.expect_value(t, len(tms), len(fart.shapes_of_3d(&doc, &part)))
			for &tm, si in tms {
				testing.expectf(t, len(tm.positions) > 0 && len(tm.positions) % 3 == 0, "%s %s[%d] has triangles", file, part.name, si)
				testing.expect_value(t, len(tm.normals), len(tm.positions))
				testing.expectf(t, len(tm.tokens) == 0 || len(tm.tokens) * 3 == len(tm.positions), "%s %s[%d]: a token per triangle", file, part.name, si)
				testing.expectf(t, len(tm.shades) == 0 || len(tm.shades) == len(tm.positions), "%s %s[%d]: a shade per vertex", file, part.name, si)
				for tok in tm.tokens do testing.expectf(t, fart.color_of_3d(&doc, tok) != [4]u8{255, 0, 255, 255}, "%s: token %q resolves", file, tok)
			}
		}
	}
}

@(private = "file")
count_tokens :: proc(tm: ^fart.Tri_Mesh, token: string) -> int {
	n := 0
	for t in 0 ..< len(tm.positions) / 3 do if fart.tri_token(tm, t) == token do n += 1
	return n
}

@(test)
paint_and_shades :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	CUBE :: `"points":[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1]],"faces":[[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[4,5,1,0],[3,2,6,7]]`
	HEAD :: `{"version":1,"space":"3d","palette":[{"name":"a","rgb":[1,1,1,255]},{"name":"b","rgb":[2,2,2,255]},{"name":"c","rgb":[3,3,3,255]}],"parts":[{"name":"p","pivot":[0,0,0],"shapes":[`
	TAIL :: `]}]}`
	data := HEAD + `{"kind":"mesh","color":"a","colors":["b","c"],"paint":[1,1,0,0,2,0],"shade":0.5,"shades":[1,1,1,1,0.5,0.5,0.5,0.5],` + CUBE + `},` + `{"kind":"mesh","color":"a","colors":["b"],"paint":[1,1,0],` + CUBE + `},` + `{"kind":"mesh","color":"a","colors":["b"],"paint":[1,1,0,0,2,0],` + CUBE + `},` + `{"kind":"mesh","color":"a","paint":[1,1,0,0,0,0],` + CUBE + `},` + `{"kind":"mesh","color":"a",` + CUBE + `},` + `{"kind":"mesh","color":"a","colors":["b","c"],"paint":[1,1,0,0,2,0],"shades":[1,1,1,1,0.5,0.5,0.5,0.5],"smooth":1,` + CUBE + `}` + TAIL
	doc, ok := fart.load_bytes_3d(transmute([]byte)string(data))
	if !testing.expect(t, ok, "the painted cubes load") do return
	tms := make([dynamic]fart.Tri_Mesh)
	fart.flatten_part(&doc, &doc.parts[0], &tms)
	// a token per triangle, from the face each came from
	testing.expect_value(t, len(tms[0].tokens), 12)
	testing.expect_value(t, count_tokens(&tms[0], "b"), 4)
	testing.expect_value(t, count_tokens(&tms[0], "c"), 2)
	testing.expect_value(t, count_tokens(&tms[0], "a"), 6)
	testing.expect_value(t, tms[0].tokens[0], "b")
	// the point's own shade per vertex; the shape's stays apart
	testing.expect_value(t, tms[0].shade, f32(0.5))
	testing.expect_value(t, len(tms[0].shades), 36)
	testing.expect_value(t, tms[0].shades[0], f32(1))
	testing.expect_value(t, fart.vertex_shade(&tms[0], 0), f32(0.5))
	lo: f32 = 9
	for s in tms[0].shades do lo = min(lo, s)
	testing.expect_value(t, lo, f32(0.5))
	// a paint the loader cannot use (a wrong count, an index past colors, no colors) draws the shape in `color`
	for bad in 1 ..= 3 {
		testing.expectf(t, len(tms[bad].tokens) == 0 && tms[bad].color == "a", "shape %d: a bad paint draws in color", bad)
		testing.expect_value(t, len(tms[bad].positions), 36)
		testing.expect_value(t, fart.tri_token(&tms[bad], 3), "a")
	}
	// a shape without paint or shades is as it was before 1.8
	testing.expect(t, len(tms[4].tokens) == 0 && len(tms[4].shades) == 0 && len(tms[4].positions) == 36)
	testing.expect_value(t, fart.vertex_shade(&tms[4], 0), f32(1))
	// through subdivision a face's children wear its paint and shades are refined with the points
	testing.expect_value(t, len(tms[5].positions), 24 * 2 * 3)
	testing.expect_value(t, count_tokens(&tms[5], "b"), 16)
	testing.expect_value(t, count_tokens(&tms[5], "c"), 8)
	testing.expect_value(t, len(tms[5].shades), len(tms[5].positions))
	surf := fart.as_mesh(&doc.parts[0].shapes[5])
	testing.expect_value(t, len(surf.points), 26)
	testing.expect_value(t, len(surf.paint), 24)
	testing.expect_value(t, len(surf.shades), 26)
	// the face point of a face with two bright and two dark corners sits between
	mid := false
	for s in surf.shades do if abs(s - 0.75) < 1e-6 do mid = true
	testing.expect(t, mid, "a shade is refined as a fourth coordinate")
}

@(test)
modifiers :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	// one quad standing on the mirror plane: points 0 and 3 weld, 1 and 2 are copied as 4 and 5
	QUAD :: `"points":[[0,0,0],[2,0,0],[2,2,0],[0.0005,2,0]],"faces":[[0,1,2,3]]`
	HEAD :: `{"version":1,"space":"3d","palette":[{"name":"a","rgb":[1,1,1,255]},{"name":"b","rgb":[2,2,2,255]},{"name":"c","rgb":[3,3,3,255]}],"parts":[{"name":"p","pivot":[0,0,0],"shapes":[`
	data := HEAD + `{"kind":"mesh","color":"a","colors":["b","c"],"paint":[1],"shades":[1,0.5,0.25,1],"creases":[[1,2,1],[0,3,1],[1,0.5]],"mods":[{"op":"mirror","axis":"x"}],` + QUAD + `},` + `{"kind":"mesh","color":"a","colors":["b","c"],"mods":[{"op":"solidify","thick":0.5,"inner":1,"rim":2}],` + QUAD + `},` + `{"kind":"mesh","color":"a","colors":["b","c"],"mods":[{"op":"solidify","thick":0.5,"offset":0}],` + QUAD + `},` + `{"kind":"mesh","color":"a","mods":[{"op":"crease","angle":40,"value":0.5},{"op":"twist"}],"creases":[[0,1,0.25]],"points":[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1]],"faces":[[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[4,5,1,0],[3,2,6,7]]}` + `]}],"states":[{"name":"s","parts":[{"part":"p","morph":[{"shape":0,"points":[[0.3,0,1],[3,0,0],[3,2,0],[0,2,0]]}]}]}]}`
	doc, ok := fart.load_bytes_3d(transmute([]byte)string(data))
	if !testing.expect(t, ok, "the modified meshes load") do return
	shapes := doc.parts[0].shapes[:]
	// mirror
	m := fart.as_mesh(&shapes[0])
	testing.expect_value(t, len(m.points), 6)
	testing.expect_value(t, len(m.faces), 2)
	testing.expect_value(t, m.points[3], fart.V3{0, 2, 0}) // welded: exactly on the plane
	testing.expect_value(t, m.points[4], fart.V3{-2, 0, 0})
	testing.expect_value(t, m.points[5], fart.V3{-2, 2, 0})
	if len(m.faces) == 2 do testing.expect(t, m.faces[1][0] == 3 && m.faces[1][1] == 5 && m.faces[1][2] == 4 && m.faces[1][3] == 0, "the copy is mapped and reversed")
	testing.expect(t, len(m.paint) == 2 && m.paint[1] == 1, "a copied face has its source's paint")
	testing.expect(t, len(m.shades) == 6 && m.shades[4] == 0.5 && m.shades[5] == 0.25, "a copied point has its source's shade")
	// creases: the edge 1-2 is copied to 4-5; 0-3 lies on the plane and is not; the corner at 1 is copied to 4
	testing.expect_value(t, len(m.creases), 5)
	if len(m.creases) == 5 {
		testing.expect(t, m.creases[3][0] == 4 && m.creases[3][1] == 5 && m.creases[3][2] == 1)
		testing.expect(t, len(m.creases[4]) == 2 && m.creases[4][0] == 4 && m.creases[4][1] == 0.5)
	}
	// under a morph the weld is decided at rest: point 0 (moved off the plane) stays welded and on it, the count holds
	st := fart.state_of_3d(&doc, "s")
	posed := fart.posed_shape_3d(&doc, &doc.parts[0], &st.parts[0], 0)
	pm := fart.as_mesh(&posed)
	testing.expect_value(t, len(pm.points), 6)
	testing.expect_value(t, pm.points[0], fart.V3{0, 0, 1})
	testing.expect_value(t, pm.points[4], fart.V3{-3, 0, 0})
	// solidify: the outer shell keeps the indices, the inner follows, then the rim
	s := fart.as_mesh(&shapes[1])
	testing.expect_value(t, len(s.points), 8)
	testing.expect_value(t, len(s.faces), 6)
	testing.expect_value(t, s.points[0], fart.V3{0, 0, 0}) // offset -1: the cage is the outside
	testing.expect(t, abs(abs(s.points[4].z) - 0.5) < 1e-6, "the wall is thick deep")
	if len(s.faces) == 6 {
		testing.expect(t, s.faces[1][0] == 7 && s.faces[1][1] == 6 && s.faces[1][2] == 5 && s.faces[1][3] == 4, "the inner face is the source's plus n, reversed")
		testing.expect(t, s.faces[2][0] == 1 && s.faces[2][1] == 0 && s.faces[2][2] == 4 && s.faces[2][3] == 5, "a rim quad is [b, a, a + n, b + n]")
	}
	testing.expect(t, len(s.paint) == 6 && s.paint[0] == 0 && s.paint[1] == 1 && s.paint[2] == 2 && s.paint[5] == 2, "inner and rim paint")
	// offset 0: the cage is the middle
	h := fart.as_mesh(&shapes[2])
	testing.expect(t, abs(h.points[0].z + h.points[4].z) < 1e-6 && abs(abs(h.points[0].z) - 0.25) < 1e-6, "offset 0 grows both ways")
	testing.expect_value(t, len(h.paint), 0)
	// crease: every edge of a cube is past 40 degrees; the one the file creased keeps its value; an op the loader does not know is passed over
	c := fart.built_mesh(&shapes[3])
	testing.expect_value(t, len(c.creases), 12)
	n25, n50 := 0, 0
	for cr in c.creases {
		if cr[2] == 0.25 do n25 += 1
		if cr[2] == 0.5 do n50 += 1
	}
	testing.expect(t, n25 == 1 && n50 == 11, "explicit creases win")
	// flatten runs the mods: both halves, triangles painted
	tms := make([dynamic]fart.Tri_Mesh)
	fart.flatten_part(&doc, &doc.parts[0], &tms)
	testing.expect_value(t, len(tms[0].positions), 12)
	testing.expect_value(t, len(tms[1].positions), 36)
	testing.expect_value(t, count_tokens(&tms[1], "c"), 8)
}

@(test)
pipes :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	HEAD :: `{"version":1,"space":"3d","palette":[{"name":"a","rgb":[1,1,1,255]}],"parts":[{"name":"p","pivot":[0,0,0],"shapes":[`
	data := HEAD + `{"kind":"sweep","color":"a","op":"pipe","segments":4,"path":{"points":[[0,0,0],[0,0,4]]},"radius":0.5},` + `{"kind":"sweep","color":"a","op":"pipe","segments":4,"path":{"points":[[0,0,0],[0,0,4]]},"radii":[1,0],"caps":false},` + `{"kind":"sweep","color":"a","op":"pipe","closed":true,"path":{"points":[[2,0,0],[0,0,2],[-2,0,0],[0,0,-2]]},"profile":{"points":[[-0.2,-0.2],[-0.2,0.2],[0.2,0.2],[0.2,-0.2]]}}` + `]}]}`
	doc, ok := fart.load_bytes_3d(transmute([]byte)string(data))
	if !testing.expect(t, ok, "the pipes load") do return
	shapes := doc.parts[0].shapes[:]
	// a straight square pipe along z: T is z, so N is x (x before y in a tie) and B is T x N = y
	m := fart.as_mesh(&shapes[0])
	testing.expect_value(t, len(m.points), 8)
	testing.expect_value(t, len(m.faces), 6)
	testing.expect_value(t, m.points[0], fart.V3{0.5, 0, 0})
	testing.expect_value(t, m.points[1], fart.V3{0, 0.5, 0})
	testing.expect_value(t, m.points[4], fart.V3{0.5, 0, 4})
	if len(m.faces) == 6 {
		testing.expect(t, m.faces[0][0] == 0 && m.faces[0][1] == 1 && m.faces[0][2] == 5 && m.faces[0][3] == 4, "a side is [a k, a k+1, b k+1, b k]")
		testing.expect(t, m.faces[4][0] == 3 && m.faces[4][3] == 0, "the first ring reversed")
		testing.expect(t, m.faces[5][0] == 4 && m.faces[5][3] == 7, "the last ring as it is")
		// all of it faces out
		for f in m.faces {
			nrm := fart.face_normal(m.points[:], f[:])
			mid: fart.V3
			for i in f do mid += m.points[i]
			mid /= f32(len(f))
			testing.expect(t, nrm.x * mid.x + nrm.y * mid.y + nrm.z * (mid.z - 2) > 0, "a pipe's faces wind outward")
		}
	}
	// a scale of 0 at an open end is an apex: one point, triangles to it, no cap; caps false leaves the other end open
	a := fart.as_mesh(&shapes[1])
	testing.expect_value(t, len(a.points), 5)
	testing.expect_value(t, len(a.faces), 4)
	testing.expect(t, len(a.faces) == 4 && len(a.faces[0]) == 3, "triangles to the apex")
	// a closed path carrying a section given clockwise (taken in reverse): four rings, sixteen quads, no caps
	c := fart.as_mesh(&shapes[2])
	testing.expect_value(t, len(c.points), 16)
	testing.expect_value(t, len(c.faces), 16)
}

// A shape's bake is drawn when it holds what the shape needs. `of` is not
// checked: the hash is over JavaScript's printing of numbers.
@(test)
bakes :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	QUAD :: `"points":[[0,0,0],[2,0,0],[2,2,0],[0,2,0]],"faces":[[0,1,2,3]]`
	BAKE :: `"points":[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[2,0,0],[2,1,0]],"faces":[[0,1,2,3],[1,4,5,2]],"of":"whatever"`
	HEAD :: `{"version":1,"space":"3d","palette":[{"name":"a","rgb":[1,1,1,255]},{"name":"b","rgb":[2,2,2,255]}],"parts":[{"name":"p","pivot":[0,0,0],"shapes":[`
	data := HEAD + `{"kind":"mesh","color":"a","smooth":1,` + QUAD + `,"bake":{` + BAKE + `}},` + `{"kind":"mesh","color":"a","colors":["b"],"paint":[1],"shades":[1,1,1,1],"smooth":1,` + QUAD + `,"bake":{` + BAKE + `}},` + `{"kind":"mesh","color":"a","colors":["b"],"paint":[1],"shades":[1,1,1,1],"smooth":1,` + QUAD + `,"bake":{` + BAKE + `,"paint":[0,1],"shades":[1,1,1,1,0.5,0.5]}},` + `{"kind":"sweep","color":"a","op":"pipe","path":{"points":[[0,0,0],[0,0,4]]},"mods":[{"op":"mirror","axis":"x"}],"bake":{` + BAKE + `}}` + `]}]}`
	doc, ok := fart.load_bytes_3d(transmute([]byte)string(data))
	if !testing.expect(t, ok, "the baked shapes load") do return
	shapes := doc.parts[0].shapes[:]
	plain := fart.as_mesh(&shapes[0])
	testing.expect_value(t, len(plain.points), 6)
	testing.expect_value(t, len(plain.faces), 2)
	// a painted, shaded shape passes over a bake that has neither, and subdivides
	made := fart.as_mesh(&shapes[1])
	testing.expect_value(t, len(made.points), 9)
	testing.expect_value(t, len(made.faces), 4)
	testing.expect_value(t, len(made.paint), 4)
	// and draws one that has both, by the bake's own paint and shades
	baked := fart.as_mesh(&shapes[2])
	testing.expect_value(t, len(baked.points), 6)
	testing.expect(t, len(baked.paint) == 2 && baked.paint[1] == 1 && len(baked.shades) == 6 && baked.shades[5] == 0.5)
	// a sweep's bake stands in for the sweep, mods and all
	swept := fart.as_mesh(&shapes[3])
	testing.expect_value(t, len(swept.points), 6)
	tms := make([dynamic]fart.Tri_Mesh)
	fart.flatten_part(&doc, &doc.parts[0], &tms)
	testing.expect_value(t, len(tms[0].positions), 12)
	testing.expect_value(t, len(tms[1].positions), 24)
	testing.expect(t, len(tms[2].tokens) == 4 && tms[2].tokens[0] == "a" && tms[2].tokens[3] == "b", "a baked shape is painted by its bake")
	testing.expect_value(t, len(tms[2].shades), 12)
}

// Point for point with @fastart/core: the mesh each shape draws, as
// parity.mjs dumped it.
@(test)
parity_with_typescript :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	Mesh :: struct {
		part:   string,
		shape:  int,
		state:  string,
		points: [][3]int,
		faces:  [][]u16,
		paint:  []int,
		shades: []f32,
	}
	File :: struct {
		file:   string,
		of:     string,
		shapes: []Mesh,
	}
	Dump :: struct {
		files: []File,
	}
	raw, rok := os.read_entire_file(#directory + "/parity.json", context.temp_allocator)
	if rok != nil {
		log.warn("parity.json is not here: run `node loaders/odin/test/parity.mjs`; parity was NOT checked")
		return
	}
	dump: Dump
	if !testing.expect(t, json.unmarshal(raw, &dump) == nil, "parity.json should parse") do return
	checked, exact := 0, 0
	for f in dump.files {
		data, ok := read(f.file)
		if !testing.expectf(t, ok, "%s should be readable", f.file) do continue
		hex := fart.source_hash_hex(data)
		if string(hex[:]) != f.of {
			log.warnf("%s has changed since parity.json was made: run `node loaders/odin/test/parity.mjs`; its parity was NOT checked", f.file)
			continue
		}
		doc, dok := fart.load_bytes_3d(data)
		if !testing.expectf(t, dok, "%s should load", f.file) do continue
		for want in f.shapes {
			part := fart.part_of_3d(&doc, want.part)
			if !testing.expectf(t, part != nil, "%s has a part %s", f.file, want.part) do continue
			sp: ^fart.State_Part3
			if want.state != "" {
				st := fart.state_of_3d(&doc, want.state)
				if st != nil do for &e in st.parts do if e.part == want.part do sp = &e
				if !testing.expectf(t, sp != nil, "%s has a state %s that poses %s", f.file, want.state, want.part) do continue
			}
			sh := fart.posed_shape_3d(&doc, part, sp, want.shape)
			got := fart.as_mesh(&sh)
			where_ := fmt.tprintf("%s %s[%d]%s%s", f.file, want.part, want.shape, want.state == "" ? "" : " in ", want.state)
			checked += 1
			same := true
			same &&= testing.expectf(t, len(got.points) == len(want.points), "%s: %d points, the reference has %d", where_, len(got.points), len(want.points))
			same &&= testing.expectf(t, len(got.faces) == len(want.faces), "%s: %d faces, the reference has %d", where_, len(got.faces), len(want.faces))
			if !same do continue
			off, worst := 0, 0
			for p, i in got.points {
				for k in 0 ..< 3 {
					d := abs(int(math.round(f64(p[k]) * 10000)) - want.points[i][k])
					if d != 0 do off += 1
					worst = max(worst, d)
				}
			}
			same &&= testing.expectf(t, off == 0, "%s: %d of %d coordinates differ from the reference, by up to %d ten-thousandths", where_, off, len(got.points) * 3, worst)
			faces_off := 0
			for face, i in got.faces {
				if len(face) != len(want.faces[i]) {
					faces_off += 1
					continue
				}
				for idx, k in face do if idx != want.faces[i][k] {
					faces_off += 1
					break
				}
			}
			same &&= testing.expectf(t, faces_off == 0, "%s: %d faces differ from the reference", where_, faces_off)
			same &&= testing.expectf(t, len(got.paint) == len(want.paint), "%s: paint for %d faces, the reference has %d", where_, len(got.paint), len(want.paint))
			if len(got.paint) == len(want.paint) {
				paint_off := 0
				for p, i in got.paint do if p != want.paint[i] do paint_off += 1
				same &&= testing.expectf(t, paint_off == 0, "%s: %d faces are painted otherwise than the reference", where_, paint_off)
			}
			same &&= testing.expectf(t, len(got.shades) == len(want.shades), "%s: %d shades, the reference has %d", where_, len(got.shades), len(want.shades))
			if len(got.shades) == len(want.shades) {
				shade_off: f32
				for s, i in got.shades do shade_off = max(shade_off, abs(s - want.shades[i]))
				same &&= testing.expectf(t, shade_off < 1e-6, "%s: a shade is %v from the reference", where_, shade_off)
			}
			if same do exact += 1
		}
	}
	log.infof("parity with @fastart/core: %d of %d meshes match exactly (points to four places, faces, paint, shades)", exact, checked)
}

// The sidecar of every 3D file in the corpus, and the helm's: fresh, the
// loader's own triangles, a primitive per shape and token, stale after
// one byte of the source changes.
@(test)
sidecars :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	defer free_all(context.temp_allocator)
	files := make([dynamic]string)
	append(&files, "examples/helm/helm.fart")
	mdata, mok := read("spec/examples/manifest.json")
	if !testing.expect(t, mok, "manifest.json should be readable") do return
	man: Manifest
	if !testing.expect(t, json.unmarshal(mdata, &man) == nil, "manifest.json should parse") do return
	for c in man.cases do if c.valid && c.space == "3d" && !c.shart do append(&files, fmt.tprintf("spec/examples/%s", c.file))
	read_n, tris_n, prims_n := 0, 0, 0
	for file in files {
		source, ok := read(file)
		if !testing.expectf(t, ok, "%s should be readable", file) do continue
		glb, gok := read(fart.sidecar_path(file))
		if !gok {
			log.warnf("%s.glb is not built: run `node packages/core/dist/cli.js build spec/examples/valid examples/helm`; this sidecar was NOT checked", file)
			continue
		}
		doc, dok := fart.load_bytes_3d(source)
		if !testing.expectf(t, dok, "%s should load", file) do continue
		if !fart.sidecar_fresh(source, glb) {
			log.warnf("%s.glb is stale (the .fart changed since it was built): rebuild it; this sidecar was NOT checked", file)
			_, used := fart.load_sidecar(&doc, source, glb)
			testing.expectf(t, !used, "%s: a stale sidecar is not used", file)
			continue
		}
		sc, fresh := fart.load_sidecar(&doc, source, glb)
		if !testing.expectf(t, fresh, "%s: a fresh sidecar loads", file) do continue
		read_n += 1
		testing.expect_value(t, len(sc.parts), len(doc.parts))
		for &part, pi in doc.parts {
			testing.expect_value(t, sc.parts[pi].name, part.name)
			testing.expect_value(t, sc.parts[pi].pivot, part.pivot)
			gen := make([dynamic]fart.Tri_Mesh)
			fart.flatten_part(&doc, &part, &gen)
			mesh := fart.sidecar_mesh_of(&sc, &doc, &part)
			pivot := fart.source_of_3d(&doc, &part).pivot
			at := 0 // primitives run in shape order
			shapes := fart.shapes_of_3d(&doc, &part)
			for &tm, si in gen {
				where_ := fmt.tprintf("%s %s[%d]", file, part.name, si)
				// a ball or a rod is tessellated as each reader likes (core lathes them; the loader has its own): only the token is common
				round := shapes[si].kind != "mesh" && shapes[si].kind != "sweep"
				// the tokens this shape paints, in the order its triangles first use them, and how many triangles each
				tokens := make([dynamic]string)
				counts := make([dynamic]int)
				for tri in 0 ..< len(tm.positions) / 3 {
					tok := fart.tri_token(&tm, tri)
					found := -1
					for name, i in tokens do if name == tok do found = i
					if found < 0 {
						append(&tokens, tok)
						append(&counts, 0)
						found = len(tokens) - 1
					}
					counts[found] += 1
				}
				total := 0
				for tok, gi in tokens {
					if !testing.expectf(t, mesh != nil && at < len(mesh.prims), "%s: a primitive for token %q", where_, tok) do break
					prim := &mesh.prims[at]
					at += 1
					prims_n += 1
					testing.expectf(t, prim.shape == si, "%s: primitive %d is shape %d", where_, at - 1, prim.shape)
					testing.expectf(t, prim.token == tok, "%s: primitive %d paints %q, the loader %q", where_, at - 1, prim.token, tok)
					testing.expectf(t, len(prim.positions) > 0, "%s token %q: the primitive has triangles", where_, tok)
					total += len(prim.positions) / 3
					if round do continue
					testing.expectf(t, len(prim.positions) == counts[gi] * 3, "%s token %q: %d triangles in the sidecar, %d generated", where_, tok, len(prim.positions) / 3, counts[gi])
					testing.expectf(t, prim.texture == tm.texture, "%s: texture %q, the loader %q", where_, prim.texture, tm.texture)
					testing.expectf(t, (len(prim.uvs) > 0) == (tm.texture != ""), "%s: pattern coordinates on a textured shape only", where_)
					// the same triangles: this token's, in generation's order, a document-space point being pivot + (x, -y, -z)
					if len(prim.positions) != counts[gi] * 3 do continue
					k := 0
					far, shade_off: f32
					for tri in 0 ..< len(tm.positions) / 3 {
						if fart.tri_token(&tm, tri) != tok do continue
						for c in 0 ..< 3 {
							d := fart.sidecar_point(pivot, prim.positions[k]) - tm.positions[tri * 3 + c]
							far = max(far, abs(d.x), abs(d.y), abs(d.z))
							shade_off = max(shade_off, abs(prim.shade[k] - fart.vertex_shade(&tm, tri * 3 + c)))
							k += 1
						}
					}
					testing.expectf(t, far < 1e-4, "%s token %q: a vertex is %v from the generated one", where_, tok, far)
					testing.expectf(t, shade_off < 1e-5, "%s token %q: a _SHADE is %v from shade times shades", where_, tok, shade_off)
				}
				tris_n += total
				testing.expectf(t, round || total == len(tm.positions) / 3, "%s: %d triangles in the sidecar, %d generated", where_, total, len(tm.positions) / 3)
			}
			testing.expectf(t, mesh == nil || at == len(mesh.prims), "%s %s: %d primitives, the loader makes %d", file, part.name, mesh == nil ? 0 : len(mesh.prims), at)
			// the drop-in: one Tri_Mesh per shape, the same triangle counts, in the document's frame
			side := make([dynamic]fart.Tri_Mesh)
			if testing.expectf(t, fart.flatten_part_sidecar(&sc, &doc, &part, &side), "%s %s: flattens from the sidecar", file, part.name) {
				testing.expect_value(t, len(side), len(gen))
				for &sm, si in side {
					if si >= len(gen) do break
					testing.expect(t, len(sm.positions) > 0 && sm.color == gen[si].color || len(sm.tokens) > 0)
					if shapes[si].kind != "mesh" && shapes[si].kind != "sweep" do continue
					testing.expect_value(t, len(sm.positions), len(gen[si].positions))
					testing.expect_value(t, len(sm.normals), len(sm.positions))
					testing.expect_value(t, len(sm.shades), len(sm.positions))
					for tok in ([]string{gen[si].color, len(gen[si].tokens) > 0 ? gen[si].tokens[0] : gen[si].color}) {
						testing.expect_value(t, count_tokens(&sm, tok), count_tokens(&gen[si], tok))
					}
					lo_s, hi_s, lo_g, hi_g: fart.V3 = 1e9, -1e9, 1e9, -1e9
					for p in sm.positions do lo_s, hi_s = {min(lo_s.x, p.x), min(lo_s.y, p.y), min(lo_s.z, p.z)}, {max(hi_s.x, p.x), max(hi_s.y, p.y), max(hi_s.z, p.z)}
					for p in gen[si].positions do lo_g, hi_g = {min(lo_g.x, p.x), min(lo_g.y, p.y), min(lo_g.z, p.z)}, {max(hi_g.x, p.x), max(hi_g.y, p.y), max(hi_g.z, p.z)}
					d := lo_s - lo_g + hi_s - hi_g
					testing.expectf(t, abs(d.x) + abs(d.y) + abs(d.z) < 1e-3, "%s %s[%d]: the sidecar's shape sits where the generated one does", file, part.name, si)
				}
			}
			// morph targets (1.6): a pose that reshapes the part is a target by name, base plus target the posed surface
			for &st in doc.states do for &sp in st.parts {
				if sp.part != part.name || !fart.morphs_3d(&doc, &sp) do continue
				if !testing.expectf(t, mesh != nil, "%s %s morphs: it has a mesh", file, part.name) do continue
				ti := fart.sidecar_target(mesh, st.name)
				if !testing.expectf(t, ti >= 0, "%s %s: a morph target named %q", file, part.name, st.name) do continue
				// (the builder lays a target out by the rest surface's triangles, so match by point: the rest surface's point under each vertex, moved)
				for &prim in mesh.prims {
					if shapes[prim.shape].kind != "mesh" do continue
					rest := fart.as_mesh(&shapes[prim.shape])
					posed_sh := fart.posed_shape_3d(&doc, &part, &sp, prim.shape)
					posed := fart.as_mesh(&posed_sh)
					if !testing.expect_value(t, len(posed.points), len(rest.points)) do continue
					far, moved: f32
					for p, k in prim.positions {
						at_rest := fart.sidecar_point(pivot, p)
						at_pose := fart.sidecar_point(pivot, p + prim.targets[ti][k])
						best: f32 = 1e9
						for q, qi in rest.points {
							d := q - at_rest
							if abs(d.x) + abs(d.y) + abs(d.z) > 1e-4 do continue
							e := posed.points[qi] - at_pose
							best = min(best, max(abs(e.x), abs(e.y), abs(e.z)))
						}
						far = max(far, best)
						moved = max(moved, abs(prim.targets[ti][k].x) + abs(prim.targets[ti][k].y) + abs(prim.targets[ti][k].z))
					}
					testing.expectf(t, far < 2e-4, "%s %s[%d] in %s: base plus target is %v from the posed surface", file, part.name, prim.shape, st.name, far)
					morphed := false
					for &mo in sp.morph do if mo.shape == prim.shape do morphed = true
					testing.expectf(t, morphed == (moved > 0), "%s %s[%d] in %s: a target moves the shapes the pose reshapes, and only those", file, part.name, prim.shape, st.name)
				}
			}
		}
		// one byte of the source changed: the sidecar is another file's now
		changed := make([]byte, len(source))
		copy(changed, source)
		changed[len(changed) / 2] ~= 1
		testing.expectf(t, !fart.sidecar_fresh(changed, glb), "%s: one byte changed makes the sidecar stale", file)
		_, used := fart.load_sidecar(&doc, changed, glb)
		testing.expectf(t, !used, "%s: a stale sidecar is not used", file)
		spaced := make([]byte, len(source) + 1)
		copy(spaced, source)
		spaced[len(source)] = ' '
		testing.expectf(t, !fart.sidecar_fresh(spaced, glb), "%s: a space added makes the sidecar stale", file)
		// a broken sidecar is ignored, never an error
		_, cut := fart.load_sidecar(&doc, source, glb[:len(glb) / 2])
		testing.expect(t, !cut, "half a sidecar is not used")
		_, junk := fart.load_sidecar(&doc, source, source)
		testing.expect(t, !junk, "bytes that are no glb are not used")
		_, none := fart.load_sidecar(&doc, source, nil)
		testing.expect(t, !none, "no sidecar is not used")
		// read off a 4-byte boundary the data is copied, not misread
		shifted := make([]byte, len(glb) + 1)
		copy(shifted[1:], glb)
		sc2, ok2 := fart.load_sidecar(&doc, source, shifted[1:])
		testing.expect(t, ok2, "a sidecar at an odd address loads")
		if ok2 && len(sc.meshes) > 0 do testing.expect_value(t, sc2.meshes[0].prims[0].positions[0], sc.meshes[0].prims[0].positions[0])
	}
	log.infof("sidecars: %d read and checked against generation (%d primitives, %d triangles)", read_n, prims_n, tris_n)
}
