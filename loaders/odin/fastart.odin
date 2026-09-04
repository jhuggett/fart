package fastart

// Reference Odin loader for the Fast Art Format (.fart). See spec/FORMAT.md.
// Engine-agnostic: no rendering here, just types, IO, palette resolution,
// and triangulation. Rendering is ~50 lines in whatever engine you're in.

import "core:encoding/json"
import "core:math"

V2 :: [2]f32

Shape :: struct {
	kind:   string, // "circle" | "line" | "poly"
	color:  string, // palette token
	at:     V2,
	r:      f32,
	a:      V2,
	b:      V2,
	w:      f32,
	points: [dynamic]V2,
	tris:   [dynamic]u16, // baked triangulation (index triples)
}

Anchor :: struct {
	name: string,
	at:   V2,
}

Part :: struct {
	name:    string,
	parent:  string, // 1.1: posed in this part's frame; "" = none
	pivot:   V2,
	shapes:  [dynamic]Shape,
	anchors: [dynamic]Anchor,
}

State_Part :: struct {
	part:   string,
	offset: V2,
	rotate: f32,
	scale:  f32, // 0 = 1
}

State :: struct {
	name:  string,
	parts: [dynamic]State_Part,
}

Tok :: struct {
	name: string,
	rgb:  [4]u8,
}

// 1.1: one moment in a clip -- a time, and a pose named or inline.
Clip_Key :: struct {
	t:     f32,
	state: string,
	parts: [dynamic]State_Part,
	ease:  string, // "linear" (default) | "in" | "out" | "in-out" | "step"
}

Clip :: struct {
	name: string,
	loop: bool,
	keys: [dynamic]Clip_Key,
}

// 1.1: an inverse-kinematics chain a runtime may solve live.
Constraint :: struct {
	name:  string,
	chain: [dynamic]string,
	end:   string, // "part/anchor"
	bend:  int,
}

Doc :: struct {
	version:      int,
	name:         string,
	palette_refs: [dynamic]string,
	palette:      [dynamic]Tok,
	parts:        [dynamic]Part,
	states:       [dynamic]State,
	clips:        [dynamic]Clip,
	constraints:  [dynamic]Constraint,
	// optional: shapes an engine may treat as solid (a line is a capsule).
	// Never drawn; rest-space, state-independent.
	collision:    [dynamic]Shape,
	// filled by resolve_palettes; never written
	resolved:     [dynamic]Tok `json:"-"`,
}

// A byte source for palette_refs: engines that embed assets pass their own.
Resolver :: proc(path: string, user: rawptr) -> ([]byte, bool)

// Strings inside the Doc belong to the allocator unmarshal used; destroy
// frees the containers only. Games load into an arena and drop the lot.
load_bytes :: proc(data: []byte) -> (doc: Doc, ok: bool) {
	// the raw tree first: the version gate must not trust unmarshal's
	// coercions ("1" is not 1), and absent offsets are only visible here
	tree, terr := json.parse(data, allocator = context.temp_allocator)
	if terr != nil do return {}, false
	root, is_obj := tree.(json.Object)
	if !is_obj || !version_ok(root["version"]) do return {}, false
	if json.unmarshal(data, &doc) != nil do return {}, false
	normalize_offsets(&doc, root)
	return doc, true
}

@(private)
version_ok :: proc(v: json.Value) -> bool {
	#partial switch n in v {
	case json.Integer:
		return n == 1
	case json.Float:
		return n == 1
	}
	return false
}

// A state entry with no offset means "the pivot lands on itself" (rest).
// Unmarshalling can't tell absent from [0, 0], so a second look at the
// raw tree fills the pivot in wherever the field was missing.
@(private)
normalize_offsets :: proc(doc: ^Doc, root: json.Object) {
	fill :: proc(doc: ^Doc, raw: json.Array, parts: []State_Part) {
		for sp_v, j in raw {
			if j >= len(parts) do break
			sp := sp_v.(json.Object) or_continue
			if "offset" in sp do continue
			if part := part_of(doc, parts[j].part); part != nil do parts[j].offset = part.pivot
		}
	}
	states := root["states"].(json.Array) or_else nil
	for st_v, i in states {
		if i >= len(doc.states) do break
		st := st_v.(json.Object) or_continue
		parts := st["parts"].(json.Array) or_continue
		fill(doc, parts, doc.states[i].parts[:])
	}
	clips := root["clips"].(json.Array) or_else nil
	for c_v, i in clips {
		if i >= len(doc.clips) do break
		c := c_v.(json.Object) or_continue
		keys := c["keys"].(json.Array) or_continue
		for k_v, j in keys {
			if j >= len(doc.clips[i].keys) do break
			k := k_v.(json.Object) or_continue
			parts := k["parts"].(json.Array) or_continue
			fill(doc, parts, doc.clips[i].keys[j].parts[:])
		}
	}
}

destroy :: proc(doc: ^Doc) {
	for &p in doc.parts {
		for &s in p.shapes {
			delete(s.points)
			delete(s.tris)
		}
		delete(p.shapes)
		delete(p.anchors)
	}
	delete(doc.parts)
	for &s in doc.collision {
		delete(s.points)
		delete(s.tris)
	}
	delete(doc.collision)
	for &st in doc.states do delete(st.parts)
	delete(doc.states)
	for &c in doc.clips {
		for &k in c.keys do delete(k.parts)
		delete(c.keys)
	}
	delete(doc.clips)
	for &c in doc.constraints do delete(c.chain)
	delete(doc.constraints)
	delete(doc.palette)
	delete(doc.palette_refs)
	delete(doc.resolved)
}

// Flatten palette_refs (in order) + local palette into `resolved`.
// Lookup happens back-to-front, so local wins, later refs beat earlier.
resolve_palettes :: proc(doc: ^Doc, resolver: Resolver, user: rawptr) {
	clear(&doc.resolved)
	for ref in doc.palette_refs {
		if data, ok := resolver(ref, user); ok {
			if pal, pok := load_bytes(data); pok {
				for t in pal.palette do append(&doc.resolved, t)
			}
		}
	}
	for t in doc.palette do append(&doc.resolved, t)
}

// A palette swap: lay `palette` over the doc's colours by name. Same
// names take the new colour, new names join. The doc's own palette and
// refs are untouched; only the resolved table changes, so swapping back
// is another apply (or resolve_palettes again). One file, many looks:
//
//     red, _ := fastart.load_bytes(red_bytes)   // a palette file
//     fastart.apply_palette(&slime, red.palette[:])
apply_palette :: proc(doc: ^Doc, palette: []Tok) {
	if len(doc.resolved) == 0 {
		for t in doc.palette do append(&doc.resolved, t)
	}
	for p in palette {
		hit := false
		for i := len(doc.resolved) - 1; i >= 0; i -= 1 {
			if doc.resolved[i].name == p.name {
				doc.resolved[i].rgb = p.rgb
				hit = true
				break
			}
		}
		if !hit do append(&doc.resolved, p)
	}
}

color_of :: proc(doc: ^Doc, token: string) -> [4]u8 {
	if len(doc.resolved) > 0 {
		for i := len(doc.resolved) - 1; i >= 0; i -= 1 {
			if doc.resolved[i].name == token do return doc.resolved[i].rgb
		}
	}
	for i := len(doc.palette) - 1; i >= 0; i -= 1 {
		if doc.palette[i].name == token do return doc.palette[i].rgb
	}
	return {255, 0, 255, 255}
}

part_of :: proc(doc: ^Doc, name: string) -> ^Part {
	for &p in doc.parts do if p.name == name do return &p
	return nil
}

state_of :: proc(doc: ^Doc, name: string) -> ^State {
	for &s in doc.states do if s.name == name do return &s
	return nil
}

clip_of :: proc(doc: ^Doc, name: string) -> ^Clip {
	for &c in doc.clips do if c.name == name do return &c
	return nil
}

// ------------------------------------------------------------ posing (1.1)
// A part's pose is an affine map; a child's composes with its parent's.
// Xf is the canvas convention: x' = a x + c y + e, y' = b x + d y + f.

Xf :: [6]f32
XF_ID :: Xf{1, 0, 0, 1, 0, 0}

xf_mul :: proc(A, B: Xf) -> Xf {
	return {
		A[0] * B[0] + A[2] * B[1],
		A[1] * B[0] + A[3] * B[1],
		A[0] * B[2] + A[2] * B[3],
		A[1] * B[2] + A[3] * B[3],
		A[0] * B[4] + A[2] * B[5] + A[4],
		A[1] * B[4] + A[3] * B[5] + A[5],
	}
}

xf_apply :: proc(T: Xf, p: V2) -> V2 {
	return {T[0] * p.x + T[2] * p.y + T[4], T[1] * p.x + T[3] * p.y + T[5]}
}

xf_scale :: proc(T: Xf) -> f32 {
	return math.sqrt(T[0] * T[0] + T[1] * T[1])
}

// translate(offset) · rotate · scale · translate(-pivot). A nil pose is rest.
local_xf :: proc(part: ^Part, sp: ^State_Part) -> Xf {
	if sp == nil do return XF_ID
	s := sp.scale == 0 ? f32(1) : sp.scale
	c := math.cos(sp.rotate) * s
	sn := math.sin(sp.rotate) * s
	pv := part.pivot
	return {c, sn, -sn, c, sp.offset.x - (c * pv.x - sn * pv.y), sp.offset.y - (sn * pv.x + c * pv.y)}
}

// The world transform of one part under a pose list: W = W(parent) · L.
// Parts the list leaves out contribute identity; a loop is cut where found.
world_xf :: proc(doc: ^Doc, poses: []State_Part, name: string, depth := 0) -> Xf {
	part := part_of(doc, name)
	if part == nil || depth > 64 do return XF_ID
	sp: ^State_Part
	for &p in poses do if p.part == name {
		sp = &p
		break
	}
	local := local_xf(part, sp)
	if part.parent == "" do return local
	return xf_mul(world_xf(doc, poses, part.parent, depth + 1), local)
}

// ------------------------------------------------------------ clips (1.1)

clip_duration :: proc(c: ^Clip) -> f32 {
	return len(c.keys) > 0 ? c.keys[len(c.keys) - 1].t : 0
}

ease :: proc(u: f32, kind: string) -> f32 {
	x := clamp(u, 0, 1)
	switch kind {
	case "in":
		return x * x
	case "out":
		return 1 - (1 - x) * (1 - x)
	case "in-out":
		return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x)
	case "step":
		return x >= 1 ? 1 : 0
	}
	return x
}

key_poses :: proc(doc: ^Doc, k: ^Clip_Key) -> []State_Part {
	if len(k.parts) > 0 || k.state == "" do return k.parts[:]
	if st := state_of(doc, k.state); st != nil do return st.parts[:]
	return nil
}

lerp_angle :: proc(a, b, u: f32) -> f32 {
	d := math.mod(b - a, math.TAU)
	if d > math.PI do d -= math.TAU
	if d < -math.PI do d += math.TAU
	return a + d * u
}

// The frame at time t, into `out` (cleared first): membership and order
// from the outgoing key, poses tweened toward the incoming one.
sample_clip :: proc(doc: ^Doc, c: ^Clip, t: f32, out: ^[dynamic]State_Part) {
	clear(out)
	n := len(c.keys)
	if n == 0 do return
	dur := clip_duration(c)
	time := t
	if c.loop && dur > 0 do time = math.mod(math.mod(t, dur) + dur, dur)
	if time <= c.keys[0].t {
		append(out, ..key_poses(doc, &c.keys[0]))
		return
	}
	if time >= c.keys[n - 1].t {
		append(out, ..key_poses(doc, &c.keys[n - 1]))
		return
	}
	i := 0
	for i + 1 < n && c.keys[i + 1].t <= time do i += 1
	A, B := &c.keys[i], &c.keys[i + 1]
	span := B.t - A.t
	u := ease(span > 0 ? (time - A.t) / span : 1, B.ease)
	to := key_poses(doc, B)
	for a in key_poses(doc, A) {
		b: ^State_Part
		for &q in to do if q.part == a.part {
			b = &q
			break
		}
		if b == nil {
			append(out, a)
			continue
		}
		sa := a.scale == 0 ? f32(1) : a.scale
		sb := b.scale == 0 ? f32(1) : b.scale
		append(out, State_Part{
			part   = a.part,
			offset = a.offset + (b.offset - a.offset) * u,
			rotate = lerp_angle(a.rotate, b.rotate, u),
			scale  = sa + (sb - sa) * u,
		})
	}
}

// ------------------------------------------------------------ triangulation
// Ear clipping, O(n^2): editors bake this into `tris` on save.

triangulate :: proc(pts: []V2, out: ^[dynamic]u16) {
	clear(out)
	n := len(pts)
	if n < 3 do return
	idx := make([dynamic]u16, 0, n, context.temp_allocator)
	// winding: signed area
	area: f32
	for i in 0 ..< n {
		j := (i + 1) % n
		area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
	}
	if area < 0 {
		for i := n - 1; i >= 0; i -= 1 do append(&idx, u16(i))
	} else {
		for i in 0 ..< n do append(&idx, u16(i))
	}
	cross :: proc(o, a, b: V2) -> f32 {
		return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
	}
	inside :: proc(a, b, c, p: V2) -> bool {
		return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0
	}
	guard := 0
	for len(idx) > 3 && guard < 10000 {
		guard += 1
		clipped := false
		m := len(idx)
		for i in 0 ..< m {
			i0 := idx[(i + m - 1) % m]
			i1 := idx[i]
			i2 := idx[(i + 1) % m]
			a, b, c := pts[i0], pts[i1], pts[i2]
			if cross(a, b, c) <= 0 do continue // reflex
			ear := true
			for k in 0 ..< m {
				kk := idx[k]
				if kk == i0 || kk == i1 || kk == i2 do continue
				if inside(a, b, c, pts[kk]) {
					ear = false
					break
				}
			}
			if !ear do continue
			append(out, i0, i1, i2)
			ordered_remove(&idx, i)
			clipped = true
			break
		}
		if !clipped do break // degenerate; caller may fan
	}
	if len(idx) == 3 do append(out, idx[0], idx[1], idx[2])
}
