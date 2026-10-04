package fastart

// Curves and smooth surfaces (1.7): paths flattened within a tolerance,
// sweeps generated from a profile, Catmull-Clark subdivision with
// semi-sharp creases (OpenSubdiv's rules), and vertex normals for smooth
// shading that stop at sharp edges. The cage is always the file; a game
// that wants none of this draws paths from their bakes and meshes as
// cages, and everything still looks like the thing.

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

@(private)
lift :: proc(axis: string, along: f32, uv: V2) -> V3 {
	switch axis {
	case "x":
		return {along, uv.y, uv.x}
	case "y":
		return {uv.x, along, uv.y}
	}
	return {uv.x, uv.y, along}
}

// The mesh a sweep generates (1.7): its profile flattened, then revolved
// or run along the axis. Faces wind outward. The sweep's look, smoothing
// and bake ride along, so the result is a mesh in every respect.
sweep_mesh :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	out: Shape3
	out.kind = "mesh"
	out.color = sh.color
	out.shade = sh.shade
	out.texture = sh.texture
	out.mapping = sh.mapping
	out.normals = sh.normals
	out.angle = sh.angle
	out.smooth = sh.smooth
	out.creases = sh.creases
	out.bake = sh.bake
	if len(sh.bake.points) > 0 && sh.smooth == 0 {
		// a tool generated it already
		out.points = sh.bake.points
		out.faces = sh.bake.faces
		out.tris = sh.bake.tris
		return out
	}
	closed := sh.op == "extrude" ? true : sh.profile.closed
	profile := path_polygon(sh.profile.points[:], sh.profile.in_[:], sh.profile.out[:], closed, FLATNESS, allocator)
	out.points = make([dynamic]V3, allocator)
	out.faces = make([dynamic][dynamic]u16, allocator)
	if sh.op == "lathe" {
		segments := sh.segments < 3 ? 12 : sh.segments
		rings := make([dynamic][dynamic]u16, allocator)
		for p in profile {
			ring := make([dynamic]u16, allocator)
			if p.x <= 0 {
				append(&out.points, lift(sh.axis, p.y, {0, 0}))
				append(&ring, u16(len(out.points) - 1))
			} else {
				for k in 0 ..< segments {
					th := f32(k) / f32(segments) * math.TAU
					append(&out.points, lift(sh.axis, p.y, {p.x * math.cos(th), p.x * math.sin(th)}))
					append(&ring, u16(len(out.points) - 1))
				}
			}
			append(&rings, ring)
		}
		for i in 0 ..< len(rings) - 1 {
			a, b := rings[i], rings[i + 1]
			if len(a) == 1 && len(b) == 1 do continue
			for k in 0 ..< segments {
				k2 := (k + 1) % segments
				f := make([dynamic]u16, allocator)
				if len(a) == 1 do append(&f, a[0], b[k2], b[k])
				else if len(b) == 1 do append(&f, a[k], a[k2], b[0])
				else do append(&f, a[k], a[k2], b[k2], b[k])
				append(&out.faces, f)
			}
		}
		if len(rings) > 0 && len(rings[0]) > 1 {
			f := make([dynamic]u16, allocator)
			append(&f, ..rings[0][:])
			append(&out.faces, f)
		}
		if len(rings) > 1 && len(rings[len(rings) - 1]) > 1 {
			f := make([dynamic]u16, allocator)
			append(&f, ..rings[len(rings) - 1][:])
			append(&out.faces, f)
		}
	} else {
		n := len(profile)
		if n < 3 do return out
		for p in profile do append(&out.points, lift(sh.axis, sh.from, p))
		for p in profile do append(&out.points, lift(sh.axis, sh.to, p))
		bottom := make([dynamic]u16, allocator)
		top := make([dynamic]u16, allocator)
		for i in 0 ..< n {
			append(&bottom, u16(i))
			append(&top, u16(i + n))
		}
		append(&out.faces, bottom, top)
		for i in 0 ..< n {
			j := (i + 1) % n
			f := make([dynamic]u16, allocator)
			append(&f, u16(i), u16(j), u16(j + n), u16(i + n))
			append(&out.faces, f)
		}
	}
	wind_outward(&out)
	return out
}

// Flip every face whose normal points toward the mesh's centroid: the cheap
// winding fix for closed convex-ish generated solids.
@(private)
wind_outward :: proc(m: ^Shape3) {
	if len(m.points) == 0 do return
	c: V3
	for p in m.points do c += p
	c /= f32(len(m.points))
	for &f in m.faces {
		if len(f) < 3 do continue
		n := face_normal(m.points[:], f[:])
		mid: V3
		for i in f do mid += m.points[i]
		mid /= f32(len(f))
		if linalg.dot(n, mid - c) < 0 {
			for i in 0 ..< len(f) / 2 do f[i], f[len(f) - 1 - i] = f[len(f) - 1 - i], f[i]
		}
	}
}

// ---------------------------------------------------------------- subdivision

@(private)
Edge_Info :: struct {
	a, b:  u16,
	faces: [2]int,
	nf:    int,
	sharp: f32, // OpenSubdiv sharpness: c × 10, +inf at 1
}

@(private)
edge_key :: proc(a, b: u16) -> u32 {
	lo, hi := min(a, b), max(a, b)
	return u32(lo) << 16 | u32(hi)
}

// Sharpness from a crease in 0..1 (1 is infinitely sharp).
sharpness_of :: proc(c: f32) -> f32 {
	return c >= 1 ? math.INF_F32 : max(0, c) * 10
}

// One Catmull-Clark level with semi-sharp creases; child creases are one unit softer.
subdivide_once :: proc(points: []V3, faces: [][dynamic]u16, creases: [][dynamic]f32, allocator := context.allocator) -> (out_points: [dynamic]V3, out_faces: [dynamic][dynamic]u16, out_creases: [dynamic][dynamic]f32) {
	n := len(points)
	edges := make(map[u32]Edge_Info, context.temp_allocator)
	around := make([][dynamic]u16, n, context.temp_allocator)
	corner := make([]f32, n, context.temp_allocator)
	for &f, fi in faces {
		for i in 0 ..< len(f) {
			a, b := f[i], f[(i + 1) % len(f)]
			if int(a) >= n || int(b) >= n || a == b do continue
			k := edge_key(a, b)
			if k not_in edges {
				edges[k] = Edge_Info{a = min(a, b), b = max(a, b)}
				append(&around[min(a, b)], max(a, b))
				append(&around[max(a, b)], min(a, b))
			}
			e := &edges[k]
			if e.nf < 2 && (e.nf == 0 || e.faces[0] != fi) {
				e.faces[e.nf] = fi
				e.nf += 1
			}
		}
	}
	for c in creases {
		if len(c) >= 3 {
			if e, has := &edges[edge_key(u16(c[0]), u16(c[1]))]; has do e.sharp = max(e.sharp, sharpness_of(c[2]))
		} else if len(c) == 2 && int(c[0]) < n {
			corner[int(c[0])] = max(corner[int(c[0])], sharpness_of(c[1]))
		}
	}
	for _, &e in edges do if e.nf < 2 do e.sharp = math.INF_F32 // a boundary is sharp
	// face points
	face_pt := make([]V3, len(faces), context.temp_allocator)
	for f, fi in faces {
		acc: V3
		for i in f do acc += points[i]
		face_pt[fi] = acc / f32(max(1, len(f)))
	}
	// edge points
	edge_pt := make(map[u32]V3, context.temp_allocator)
	for k, e in edges {
		m := (points[e.a] + points[e.b]) / 2
		pt := m
		if e.nf == 2 {
			smooth := (points[e.a] + points[e.b] + face_pt[e.faces[0]] + face_pt[e.faces[1]]) / 4
			s := e.sharp
			pt = s >= 1 ? m : (s <= 0 ? smooth : smooth * (1 - s) + m * s)
		}
		edge_pt[k] = pt
	}
	// vertex points
	vert_pt := make([]V3, n, context.temp_allocator)
	for v, vi in points {
		nb := around[vi][:]
		nn := len(nb)
		if nn == 0 {
			vert_pt[vi] = v
			continue
		}
		sharp_count := 0
		s1, s2: f32 = 0, 0
		o1, o2: u16
		for o in nb {
			e := edges[edge_key(u16(vi), o)]
			if e.sharp >= 1 do sharp_count += 1
			if e.sharp > s1 {
				s2, o2 = s1, o1
				s1, o1 = e.sharp, o
			} else if e.sharp > s2 {
				s2, o2 = e.sharp, o
			}
		}
		if sharp_count >= 3 || corner[vi] >= 1 || (nn == 2 && sharp_count == 2) {
			vert_pt[vi] = v
			continue
		}
		q: V3
		nq := 0
		seen := make(map[int]bool, context.temp_allocator)
		for o in nb {
			e := edges[edge_key(u16(vi), o)]
			for fi in 0 ..< e.nf do if !seen[e.faces[fi]] {
				seen[e.faces[fi]] = true
				q += face_pt[e.faces[fi]]
				nq += 1
			}
		}
		q /= f32(max(1, nq))
		r: V3
		for o in nb do r += (v + points[o]) / 2
		r /= f32(nn)
		smooth := (q + r * 2 + v * f32(nn - 3)) / f32(nn)
		res := smooth
		if s2 > 0 {
			crease := (points[o1] + points[o2] + v * 6) / 8
			s := min(f32(1), (min(s1, 1) + min(s2, 1)) / 2)
			res = s >= 1 ? crease : smooth * (1 - s) + crease * s
		}
		cs := min(f32(1), corner[vi])
		if cs > 0 do res = res * (1 - cs) + v * cs
		vert_pt[vi] = res
	}
	// assemble
	out_points = make([dynamic]V3, 0, n + len(faces) + len(edges), allocator)
	append(&out_points, ..vert_pt)
	append(&out_points, ..face_pt)
	edge_index := make(map[u32]u16, context.temp_allocator)
	for k, pt in edge_pt {
		edge_index[k] = u16(len(out_points))
		append(&out_points, pt)
	}
	out_faces = make([dynamic][dynamic]u16, 0, len(faces) * 4, allocator)
	for f, fi in faces {
		fp := u16(n + fi)
		m := len(f)
		for i in 0 ..< m {
			v := f[i]
			en, has1 := edge_index[edge_key(v, f[(i + 1) % m])]
			ep, has2 := edge_index[edge_key(f[(i + m - 1) % m], v)]
			if !has1 || !has2 do continue
			nf := make([dynamic]u16, allocator)
			append(&nf, v, en, fp, ep)
			append(&out_faces, nf)
		}
	}
	out_creases = make([dynamic][dynamic]f32, allocator)
	for k, e in edges {
		if e.sharp <= 0 || e.nf < 2 do continue
		child := e.sharp == math.INF_F32 ? f32(1) : max(0, e.sharp - 1) / 10
		if child <= 0 do continue
		ei := f32(edge_index[k])
		c1 := make([dynamic]f32, allocator)
		append(&c1, f32(e.a), ei, child)
		c2 := make([dynamic]f32, allocator)
		append(&c2, f32(e.b), ei, child)
		append(&out_creases, c1, c2)
	}
	for c, vi in corner {
		if c <= 0 do continue
		child := c == math.INF_F32 ? f32(1) : max(0, c - 1) / 10
		if child <= 0 do continue
		cc := make([dynamic]f32, allocator)
		append(&cc, f32(vi), child)
		append(&out_creases, cc)
	}
	return
}

// The cage subdivided `levels` times (0: the cage itself, shared).
subdivide_3d :: proc(sh: ^Shape3, levels: int, allocator := context.allocator) -> Shape3 {
	out := sh^
	if levels <= 0 do return out
	pts, faces, creases := sh.points[:], sh.faces[:], sh.creases[:]
	for _ in 0 ..< levels {
		p2, f2, c2 := subdivide_once(pts, faces, creases, allocator)
		pts, faces, creases = p2[:], f2[:], c2[:]
	}
	out.points = make([dynamic]V3, allocator)
	append(&out.points, ..pts)
	out.faces = make([dynamic][dynamic]u16, allocator)
	append(&out.faces, ..faces)
	out.tris = nil
	out.creases = nil
	out.smooth = 0
	out.bake = {}
	return out
}

// What a smooth mesh draws: its bake when a tool wrote one, else subdivided now.
surface_of :: proc(sh: ^Shape3, allocator := context.allocator) -> Shape3 {
	if sh.smooth <= 0 do return sh^
	if len(sh.bake.points) > 0 && len(sh.bake.faces) > 0 {
		out := sh^
		out.points = sh.bake.points
		out.faces = sh.bake.faces
		out.tris = sh.bake.tris
		out.smooth = 0
		out.creases = nil
		return out
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
	for p, i in tm.positions {
		// the fan around this position, grown from this corner's triangle to
		// neighbours within the angle, and theirs: an edge sharper than the
		// angle splits the fan, as it does in a cage
		seen := make(map[int]bool, context.temp_allocator)
		stack := make([dynamic]int, context.temp_allocator)
		seen[i / 3] = true
		append(&stack, i / 3)
		acc: V3
		for len(stack) > 0 {
			t := pop(&stack)
			nt := tm.normals[t * 3]
			acc += nt
			for j in at[key_of(p)] {
				u := j / 3
				if seen[u] do continue
				if linalg.dot(nt, tm.normals[u * 3]) < cos_limit do continue
				seen[u] = true
				append(&stack, u)
			}
		}
		fresh[i] = linalg.normalize0(acc)
	}
	copy(tm.normals[:], fresh)
}
