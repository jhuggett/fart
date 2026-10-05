package fastart

// Curves and smooth surfaces (1.7): paths flattened within a tolerance,
// sweeps generated from a profile, Catmull-Clark subdivision with
// semi-sharp creases (OpenSubdiv's rules), and vertex normals for smooth
// shading that stop at sharp edges. The cage is always the file; a game
// that wants none of this draws paths from their bakes and meshes as
// cages, and everything still looks like the thing.

import "base:runtime"
import "core:math"
import "core:math/linalg"

// The tolerance editors bake at: a polyline within this of the curve conforms.
FLATNESS :: f32(0.05)

// ---------------------------------------------------------------- paths

@(private)
flatten_cubic :: proc(p0, p1, p2, p3: V2, tol: f32, out: ^[dynamic]V2, depth := 0) {
	d := p3 - p0
	l := linalg.length(d)
	d1, d2: f32
	if l < 1e-12 {
		d1 = linalg.length(p1 - p0)
		d2 = linalg.length(p2 - p0)
	} else {
		d1 = abs((p1.x - p0.x) * d.y - (p1.y - p0.y) * d.x) / l
		d2 = abs((p2.x - p0.x) * d.y - (p2.y - p0.y) * d.x) / l
	}
	if depth >= 16 || max(d1, d2) <= tol {
		append(out, p3)
		return
	}
	p01, p12, p23 := (p0 + p1) / 2, (p1 + p2) / 2, (p2 + p3) / 2
	p012, p123 := (p01 + p12) / 2, (p12 + p23) / 2
	mid := (p012 + p123) / 2
	flatten_cubic(p0, p01, p012, mid, tol, out, depth + 1)
	flatten_cubic(mid, p123, p23, p3, tol, out, depth + 1)
}

@(private)
near0 :: proc(v: V2) -> bool {
	return abs(v.x) < 1e-9 && abs(v.y) < 1e-9
}

// A path as a polyline within `tol` of the curve: every segment for a
// closed path (the first point not repeated), first to last for an open
// one. `in_`/`out` may be empty (a polygon). Allocated with the context allocator.
path_polygon :: proc(points, in_, out: []V2, closed: bool, tol := FLATNESS, allocator := context.allocator) -> []V2 {
	n := len(points)
	if n == 0 do return nil
	res := make([dynamic]V2, 0, n * 4, allocator)
	append(&res, points[0])
	segs := closed ? n : n - 1
	for i in 0 ..< segs {
		j := (i + 1) % n
		o := i < len(out) ? out[i] : V2{}
		inn := j < len(in_) ? in_[j] : V2{}
		if near0(o) && near0(inn) {
			append(&res, points[j])
		} else {
			flatten_cubic(points[i], points[i] + o, points[j] + inn, points[j], tol, &res)
		}
	}
	if closed && len(res) > 1 do pop(&res)
	return res[:]
}

// ---------------------------------------------------------------- sweeps

// A sweep's cage (1.7; `pipe` 1.8), generated: its profile flattened, then
// revolved, run along the axis, or carried along a path. Faces wind
// outward, in the order the spec gives each op (which is the order
// `paint` counts them in). The sweep's look, paint, mods, smoothing and
// bake ride along, so the result is a mesh in every respect; as_mesh
// takes it the rest of the way.
@(private)
sweep_cage :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	m := sweep64(sh)
	out := shape_of64(&m, sh, allocator)
	out.mapping = sh.mapping
	out.smooth = sh.smooth
	out.creases = sh.creases
	out.paint = sh.paint
	out.mods = sh.mods
	out.bake = sh.bake
	return out
}

// The mesh a sweep generates: its cage, or its bake when a tool generated
// it already (and nothing is left to do to it: no mods, no smoothing).
sweep_mesh :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	if sh.smooth == 0 && len(sh.mods) == 0 {
		if baked, ok := baked_surface(sh); ok {
			baked.bake = sh.bake
			return baked
		}
	}
	return sweep_cage(sh, allocator)
}

// ---------------------------------------------------------------- subdivision

@(private)
edge_key :: proc(a, b: u16) -> u32 {
	lo, hi := min(a, b), max(a, b)
	return u32(lo) << 16 | u32(hi)
}

// Sharpness from a crease in 0..1 (1 is infinitely sharp).
sharpness_of :: proc(c: f32) -> f32 {
	return c >= 1 ? math.INF_F32 : max(0, c) * 10
}

// Do explicit pattern coordinates fit these faces: one list per face, one pair per corner?
uvs_fit :: proc(uvs: [][dynamic]V2, faces: [][dynamic]u16) -> bool {
	if len(uvs) == 0 || len(uvs) != len(faces) do return false
	for f, i in faces do if len(uvs[i]) != len(f) do return false
	return true
}

// One Catmull-Clark level with semi-sharp creases; child creases are one unit softer.
// Explicit pattern coordinates (1.5), when they fit the faces, stay within their face:
// a child's corners take the parent's corner, the middles of its two edges there, and
// the face's middle. `out_uvs` is then one list per child face, else empty.
// The new points follow the old in the reference's order: a point per face, then a
// point per edge as the faces first walk them. (Paint and shades ride through
// subdivide_3d and as_mesh.)
subdivide_once :: proc(points: []V3, faces: [][dynamic]u16, creases: [][dynamic]f32, allocator := context.allocator, uvs: [][dynamic]V2 = nil) -> (out_points: [dynamic]V3, out_faces: [dynamic][dynamic]u16, out_creases: [dynamic][dynamic]f32, out_uvs: [dynamic][dynamic]V2) {
	cage: Shape3
	cage.points = slice_dynamic(points)
	cage.faces = slice_dynamic(faces)
	cage.creases = slice_dynamic(creases)
	cage.mapping.uvs = slice_dynamic(uvs)
	m, ok := mesh64_of(&cage)
	if ok do ok = refine64(&m)
	if !ok do m = {}
	out := shape_of64(&m, &cage, allocator)
	if out.creases == nil do out.creases = make([dynamic][dynamic]f32, allocator)
	return out.points, out.faces, out.creases, out.mapping.uvs
}

// A slice seen as a dynamic array that must not grow: for handing borrowed lists to a Shape3.
@(private)
slice_dynamic :: proc(s: []$T) -> [dynamic]T {
	return transmute([dynamic]T)runtime.Raw_Dynamic_Array{data = raw_data(s), len = len(s), cap = len(s), allocator = runtime.nil_allocator()}
}

// The cage subdivided `levels` times (0: the cage itself, shared). Paint
// (1.8) goes to each face's children, a shade (1.8) is refined with its
// point. Mods are not applied here: as_mesh does the whole of it.
subdivide_3d :: proc(sh: ^Shape3, levels: int, allocator := context.allocator) -> Shape3 {
	if levels <= 0 do return sh^
	m, ok := mesh64_of(sh)
	if !ok do return sh^
	for _ in 0 ..< levels do if !refine64(&m) do break
	out := shape_of64(&m, sh, allocator)
	out.kind = sh.kind
	out.creases = nil
	// explicit pattern coordinates are the surface's own now (none, if the cage's never fitted its faces)
	if out.mapping.uvs == nil do out.mapping.uvs = make([dynamic][dynamic]V2, allocator)
	return out
}

// What a smooth mesh draws: its bake when a tool wrote one that will do, else subdivided now.
surface_of :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	if sh.smooth <= 0 do return sh^
	// (a cage with explicit pattern coordinates, paint or shades needs a bake that has them too: one written before they were carried is passed over)
	if baked, ok := baked_surface(sh); ok {
		baked.normals = sh.normals
		return baked
	}
	return subdivide_3d(sh, sh.smooth, allocator)
}

// Does a mesh want vertex normals: asked for, or smoothed and not told flat.
smooth_normals :: proc(sh: ^Shape3) -> bool {
	return sh.normals == "smooth" || (sh.normals != "flat" && sh.smooth > 0)
}

// Replace a flattened mesh's per-face normals with per-corner averages:
// each triangle corner takes the mean of the faces around its position
// whose normals lie within the angle (and that are not across a sharp
// crease of the cage, when the cage was drawn as is). Positions are
// matched by value, which is what a flattened Tri_Mesh leaves us.
smooth_tri_normals :: proc(sh: ^Shape3, tm: ^Tri_Mesh) {
	n := len(tm.positions)
	if n == 0 do return
	cos_limit: f32 = -1
	if sh.angle > 0 do cos_limit = math.cos(clamp(sh.angle, 0, 180) * math.PI / 180)
	// buckets by position
	Key :: [3]i32
	at := make(map[Key][dynamic]int, context.temp_allocator)
	key_of :: proc(p: V3) -> Key {
		return {i32(math.round(p.x * 1000)), i32(math.round(p.y * 1000)), i32(math.round(p.z * 1000))}
	}
	for p, i in tm.positions {
		k := key_of(p)
		if k not_in at do at[k] = make([dynamic]int, context.temp_allocator)
		append(&at[k], i)
	}
	fresh := make([]V3, n, context.temp_allocator)
	seen := make([dynamic]int, 0, 16, context.temp_allocator)
	stack := make([dynamic]int, 0, 16, context.temp_allocator)
	for p, i in tm.positions {
		// the fan around this position, grown from this corner's triangle to
		// neighbours within the angle, and theirs: an edge sharper than the
		// angle splits the fan, as it does in a cage
		here := at[key_of(p)][:]
		clear(&seen)
		clear(&stack)
		append(&seen, i / 3)
		append(&stack, i / 3)
		acc: V3
		for len(stack) > 0 {
			t := pop(&stack)
			nt := tm.normals[t * 3]
			acc += nt
			next: for j in here {
				u := j / 3
				for s in seen do if s == u do continue next
				if linalg.dot(nt, tm.normals[u * 3]) < cos_limit do continue
				append(&seen, u)
				append(&stack, u)
			}
		}
		fresh[i] = linalg.normalize0(acc)
	}
	copy(tm.normals[:], fresh)
}
