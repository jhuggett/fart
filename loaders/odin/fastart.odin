package fastart

// Reference Odin loader for the Fast Art Format (.fart). See spec/FORMAT.md.
// Engine-agnostic: no rendering here, just types, IO, palette resolution,
// and triangulation. Rendering is ~50 lines in whatever engine you're in.

import "core:encoding/json"

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

Doc :: struct {
	version:      int,
	name:         string,
	palette_refs: [dynamic]string,
	palette:      [dynamic]Tok,
	parts:        [dynamic]Part,
	states:       [dynamic]State,
	// optional: shapes an engine may treat as solid (a line is a capsule).
	// Never drawn; rest-space, state-independent.
	collision:    [dynamic]Shape,
	// filled by resolve_palettes; not serialized meaningfully
	resolved:     [dynamic]Tok,
}

// A byte source for palette_refs: engines that embed assets pass their own.
Resolver :: proc(path: string, user: rawptr) -> ([]byte, bool)

load_bytes :: proc(data: []byte) -> (doc: Doc, ok: bool) {
	if json.unmarshal(data, &doc) != nil do return {}, false
	if doc.version > 1 do return {}, false
	return doc, true
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
