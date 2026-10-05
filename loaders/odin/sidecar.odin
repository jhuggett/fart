package fastart

// The compiled sidecar (1.8): `helm.fart.glb` beside `helm.fart`, a binary
// glTF a build made (`fart build art/`) holding every part's shapes as
// the triangles this loader would have generated. Reading it costs a
// small JSON parse and no arithmetic: the triangle data is used where it
// lies in the file's bytes.
//
// The .fart stays the source of truth. A game loads it as ever
// (load_bytes_3d: palettes, states, clips, anchors, collision, textures)
// and then asks for the sidecar; a sidecar that is missing, stale (its
// `of` is not the FNV-1a 64-bit hash of the .fart's bytes), malformed, or
// not this document's is simply not used, and the game generates:
//
//   doc, _ := fart.load_bytes_3d(source)
//   sc, fresh := fart.load_sidecar(&doc, source, glb) // glb: the bytes of name.fart.glb, or nil
//   for &part in doc.parts {
//       if !fresh || !fart.flatten_part_sidecar(&sc, &doc, &part, &meshes) {
//           fart.flatten_part(&doc, &part, &meshes)
//       }
//   }
//
// flatten_part_sidecar gives what flatten_part gives, one Tri_Mesh per
// shape in the document's own frame. A renderer that would rather upload
// the sidecar's arrays as they are walks sidecar_mesh_of(...).prims: one
// primitive per shape and palette token, unindexed triangles, y-up and
// relative to the part's pivot (a document-space rest point is
// sidecar_point(pivot, p) = pivot + (x, -y, -z)); `shade` per vertex is
// the shape's `shade` times the point's `shades`; `token` is resolved at
// run time with color_of_3d, so a palette swap still recolours.
//
// The slices of a Sidecar point into the `glb` bytes it was read from:
// keep those bytes for as long as the Sidecar (or copy what you upload).
// Morph targets are per primitive, deltas in the primitive's own vertex
// order, named by `target_names` (a state's name, or `clip#key`): a
// pose's surface is the base plus its target, between two keys the
// weighted sum. Clips in the sidecar are not read: play them from the
// document (sample_clip_3d), as before.

import "core:encoding/json"
import "core:mem"
import "core:strings"

// The hash a sidecar keeps of its source: FNV-1a, 64 bits, over the file's bytes as they are on disk.
source_hash :: proc(data: []byte) -> u64 {
	h := u64(0xcbf29ce484222325)
	for b in data {
		h ~= u64(b)
		h *= 0x100000001b3
	}
	return h
}

// The same as the spec writes it: sixteen lowercase hex digits. string(h[:]) to compare or print.
source_hash_hex :: proc(data: []byte) -> (hex: [16]u8) {
	digits := "0123456789abcdef"
	h := source_hash(data)
	for i in 0 ..< 16 do hex[i] = digits[(h >> uint(60 - i * 4)) & 0xf]
	return
}

// A document's sidecar: its own path with `.glb` after it.
sidecar_path :: proc(file: string, allocator := context.allocator) -> string {
	return strings.concatenate({file, ".glb"}, allocator)
}

// One primitive of a sidecar mesh: the triangles of one shape that paint one token.
Sidecar_Prim :: struct {
	shape:     int, // which of the part's shapes
	token:     string, // the palette token to resolve at run time
	texture:   string, // 1.5: the texture's name; "" for none
	positions: []V3, // three per triangle; y-up, relative to the part's pivot
	normals:   []V3, // unit, y-up; the corner's own where the shape is smooth-shaded
	shade:     []f32, // per vertex: the shape's `shade` times the point's `shades`
	colors:    [][4]f32, // per vertex, for the palette the builder had (COLOR_0); a reader that resolves tokens ignores it
	uvs:       []V2, // textured shapes only: 0..1 over the texture's cell (multiply by the cell for pattern coordinates)
	targets:   [][]V3, // one per morph target of the mesh: position deltas, y-up, in this primitive's vertex order
}

Sidecar_Mesh :: struct {
	name:         string, // the part it was made from (a part drawn `like` another wears its source's)
	prims:        []Sidecar_Prim, // in shape order; a shape's tokens in the order its triangles first use them
	target_names: []string, // a state's name, or `clip#key` for an inline key; empty when the part never morphs
}

Sidecar_Part :: struct {
	name:  string,
	pivot: V3, // the part's own, in the document's frame
	mesh:  int, // into Sidecar.meshes; -1 for a part that draws nothing
}

Sidecar :: struct {
	format:    string, // the format it was generated to, e.g. "1.8"
	generator: string, // the tool that made it
	of:        string, // the source's hash, sixteen hex digits
	parts:     []Sidecar_Part, // part i of the document is parts[i]
	meshes:    []Sidecar_Mesh,
	aligned:   []byte, // the binary chunk copied, when the bytes given did not sit on a 4-byte boundary
	allocator: mem.Allocator,
}

@(private = "file")
G_Accessor :: struct {
	buffer_view:    Maybe(int) `json:"bufferView"`,
	byte_offset:    int `json:"byteOffset"`,
	component_type: int `json:"componentType"`,
	count:          int,
	type:           string,
}

@(private = "file")
G_View :: struct {
	buffer:      int,
	byte_offset: int `json:"byteOffset"`,
	byte_length: int `json:"byteLength"`,
	byte_stride: int `json:"byteStride"`,
}

@(private = "file")
G_Prim :: struct {
	attributes: map[string]int,
	mode:       Maybe(int),
	targets:    [dynamic]map[string]int,
	extras:     struct {
		shape:   Maybe(int),
		token:   Maybe(string),
		texture: string,
	},
}

@(private = "file")
G_Mesh :: struct {
	name:       string,
	primitives: [dynamic]G_Prim,
	extras:     struct {
		target_names: [dynamic]string `json:"targetNames"`,
	},
}

@(private = "file")
G_Node :: struct {
	name:   string,
	mesh:   Maybe(int),
	extras: struct {
		pivot: [dynamic]f32,
	},
}

@(private = "file")
G_Fart :: struct {
	format:    string,
	generator: string,
	of:        string,
}

@(private = "file")
G_Root :: struct {
	asset:        struct {
		extras: struct {
			fart: G_Fart,
		},
	},
	nodes:        [dynamic]G_Node,
	meshes:       [dynamic]G_Mesh,
	accessors:    [dynamic]G_Accessor,
	buffer_views: [dynamic]G_View `json:"bufferViews"`,
}

// A binary glTF's two chunks: its JSON and its binary buffer. False when the bytes are not one.
@(private = "file")
glb_chunks :: proc(glb: []byte) -> (js: []byte, bin: []byte, ok: bool) {
	u32_at :: proc(b: []byte, at: int) -> int {
		return int(u32(b[at]) | u32(b[at + 1]) << 8 | u32(b[at + 2]) << 16 | u32(b[at + 3]) << 24)
	}
	if len(glb) < 20 || u32_at(glb, 0) != 0x46546c67 || u32_at(glb, 4) != 2 do return
	if u32_at(glb, 16) != 0x4e4f534a do return
	n := u32_at(glb, 12)
	if n < 2 || 20 + n > len(glb) do return
	js = glb[20:20 + n]
	at := 20 + n
	if at + 8 <= len(glb) && u32_at(glb, at + 4) == 0x004e4942 {
		m := u32_at(glb, at)
		if at + 8 + m > len(glb) do return
		bin = glb[at + 8:at + 8 + m]
	}
	return js, bin, true
}

// What a sidecar says of itself (`asset.extras.fart`); false when the bytes are not a sidecar.
// The strings are allocated with `allocator`.
sidecar_info :: proc(glb: []byte, allocator := context.temp_allocator) -> (format, generator, of: string, ok: bool) {
	js, _, is_glb := glb_chunks(glb)
	if !is_glb do return
	// only the asset is read here: the rest of the tree is skipped by the parser
	head: struct {
		asset: struct {
			extras: struct {
				fart: G_Fart,
			},
		},
	}
	if json.unmarshal(js, &head, allocator = allocator) != nil do return
	f := head.asset.extras.fart
	if f.of == "" do return
	return f.format, f.generator, f.of, true
}

// Is this sidecar its source's: does its `of` equal the hash of the .fart's bytes?
sidecar_fresh :: proc(source: []byte, glb: []byte) -> bool {
	_, _, of, ok := sidecar_info(glb)
	hex := source_hash_hex(source)
	return ok && of == string(hex[:])
}

// A sidecar's meshes, read from its bytes with no check against a source
// or a document: load_sidecar is the call a game wants. False when the
// bytes are not a well-formed sidecar of this major version. What the
// Sidecar owns is allocated with `allocator` (destroy_sidecar frees it);
// its triangle data points into `glb`.
read_sidecar :: proc(glb: []byte, allocator := context.allocator) -> (sc: Sidecar, ok: bool) {
	when ODIN_ENDIAN != .Little {
		return {}, false // the accessors are little-endian floats, used in place: generate instead
	} else {
		js, bin, is_glb := glb_chunks(glb)
		if !is_glb do return
		root: G_Root
		if json.unmarshal(js, &root, allocator = context.temp_allocator) != nil do return
		info := root.asset.extras.fart
		if info.of == "" || !strings.has_prefix(info.format, "1.") do return
		sc.allocator = allocator
		defer if !ok do destroy_sidecar(&sc)
		// floats are read where they lie, so they must sit on a 4-byte boundary
		if len(bin) > 0 && uintptr(raw_data(bin)) % align_of(f32) != 0 {
			sc.aligned = mem.alloc_bytes(len(bin), align_of(f32), allocator) or_else nil
			if len(sc.aligned) != len(bin) do return
			copy(sc.aligned, bin)
			bin = sc.aligned
		}
		sc.format = strings.clone(info.format, allocator)
		sc.generator = strings.clone(info.generator, allocator)
		sc.of = strings.clone(info.of, allocator)
		sc.meshes = make([]Sidecar_Mesh, len(root.meshes), allocator)
		for &gm, mi in root.meshes {
			m := &sc.meshes[mi]
			m.name = strings.clone(gm.name, allocator)
			m.target_names = make([]string, len(gm.extras.target_names), allocator)
			for name, i in gm.extras.target_names do m.target_names[i] = strings.clone(name, allocator)
			m.prims = make([]Sidecar_Prim, len(gm.primitives), allocator)
			for &gp, pi in gm.primitives {
				p := &m.prims[pi]
				if mode, has := gp.mode.?; has && mode != 4 do return
				shape, has_shape := gp.extras.shape.?
				token, has_token := gp.extras.token.?
				if !has_shape || !has_token || shape < 0 do return
				p.shape = shape
				p.token = strings.clone(token, allocator)
				p.texture = strings.clone(gp.extras.texture, allocator)
				p.positions = accessor(&root, bin, gp.attributes, "POSITION", "VEC3", V3) or_return
				p.normals = accessor(&root, bin, gp.attributes, "NORMAL", "VEC3", V3) or_return
				p.shade = accessor(&root, bin, gp.attributes, "_SHADE", "SCALAR", f32) or_return
				n := len(p.positions)
				if n == 0 || n % 3 != 0 || len(p.normals) != n || len(p.shade) != n do return
				if "COLOR_0" in gp.attributes {
					p.colors = accessor(&root, bin, gp.attributes, "COLOR_0", "VEC4", [4]f32) or_return
					if len(p.colors) != n do return
				}
				if "TEXCOORD_0" in gp.attributes {
					p.uvs = accessor(&root, bin, gp.attributes, "TEXCOORD_0", "VEC2", V2) or_return
					if len(p.uvs) != n do return
				}
				if len(gp.targets) != len(m.target_names) do return
				p.targets = make([][]V3, len(gp.targets), allocator)
				for t, ti in gp.targets {
					p.targets[ti] = accessor(&root, bin, t, "POSITION", "VEC3", V3) or_return
					if len(p.targets[ti]) != n do return
				}
			}
		}
		sc.parts = make([]Sidecar_Part, len(root.nodes), allocator)
		for &gn, ni in root.nodes {
			part := &sc.parts[ni]
			part.name = strings.clone(gn.name, allocator)
			if len(gn.extras.pivot) != 3 do return
			part.pivot = {gn.extras.pivot[0], gn.extras.pivot[1], gn.extras.pivot[2]}
			part.mesh = -1
			if mesh, has := gn.mesh.?; has {
				if mesh < 0 || mesh >= len(sc.meshes) do return
				part.mesh = mesh
			}
		}
		return sc, true
	}
}

// One accessor of 32-bit floats as a slice over the binary chunk, every bound checked.
@(private = "file")
accessor :: proc(root: ^G_Root, bin: []byte, attributes: map[string]int, name: string, type: string, $T: typeid) -> (out: []T, ok: bool) {
	index, has := attributes[name]
	if !has || index < 0 || index >= len(root.accessors) do return
	acc := root.accessors[index]
	view_index, has_view := acc.buffer_view.?
	if !has_view || view_index < 0 || view_index >= len(root.buffer_views) do return
	view := root.buffer_views[view_index]
	if acc.component_type != 5126 || acc.type != type || acc.count < 0 || view.buffer != 0 do return
	if view.byte_stride != 0 && view.byte_stride != size_of(T) do return
	if view.byte_offset < 0 || view.byte_length < 0 || acc.byte_offset < 0 || view.byte_offset + view.byte_length > len(bin) do return
	at := view.byte_offset + acc.byte_offset
	size := acc.count * size_of(T)
	if at % align_of(f32) != 0 || acc.byte_offset + size > view.byte_length do return
	if acc.count == 0 do return nil, true
	return mem.slice_ptr(cast(^T)raw_data(bin[at:]), acc.count), true
}

// The sidecar of a loaded document, when it may be used: well-formed, its
// `of` the hash of `source` (the .fart's bytes exactly as they are on
// disk), and laid out as this document is (a node per part by name, every
// primitive's shape one the part has). Anything else returns false and
// the game generates as if the sidecar were not there: a stale or broken
// sidecar is never an error. `glb` may be nil (no sidecar on disk).
load_sidecar :: proc(doc: ^Doc3, source: []byte, glb: []byte, allocator := context.allocator) -> (sc: Sidecar, ok: bool) {
	if len(glb) == 0 do return
	sc = read_sidecar(glb, allocator) or_return
	hex := source_hash_hex(source)
	fits := sc.of == string(hex[:]) && len(sc.parts) == len(doc.parts)
	if fits {
		for &part, i in doc.parts {
			sp := sc.parts[i]
			if sp.name != part.name || sp.pivot != part.pivot {
				fits = false
				break
			}
			if sp.mesh < 0 do continue
			shapes := shapes_of_3d(doc, &part)
			for &prim in sc.meshes[sp.mesh].prims do if prim.shape >= len(shapes) do fits = false
		}
	}
	if !fits {
		destroy_sidecar(&sc)
		return {}, false
	}
	return sc, true
}

destroy_sidecar :: proc(sc: ^Sidecar) {
	a := sc.allocator
	if a.procedure == nil do return
	for &m in sc.meshes {
		for &p in m.prims {
			delete(p.token, a)
			delete(p.texture, a)
			delete(p.targets, a)
		}
		delete(m.prims, a)
		for name in m.target_names do delete(name, a)
		delete(m.target_names, a)
		delete(m.name, a)
	}
	delete(sc.meshes, a)
	for &p in sc.parts do delete(p.name, a)
	delete(sc.parts, a)
	delete(sc.format, a)
	delete(sc.generator, a)
	delete(sc.of, a)
	delete(sc.aligned, a)
	sc^ = {}
}

// The mesh a part wears in the sidecar (its source's, for a part drawn `like` another); nil when it draws nothing.
sidecar_mesh_of :: proc(sc: ^Sidecar, doc: ^Doc3, part: ^Part3) -> ^Sidecar_Mesh {
	for &p, i in doc.parts {
		if &p != part do continue
		if i >= len(sc.parts) || sc.parts[i].mesh < 0 do return nil
		return &sc.meshes[sc.parts[i].mesh]
	}
	return nil
}

// A sidecar position (y-up, relative to a pivot) in the document's own frame and the part's rest space.
sidecar_point :: proc(pivot: V3, p: V3) -> V3 {
	return pivot + V3{p.x, -p.y, -p.z}
}

// Which of a mesh's morph targets a pose is: a state's name, or `clip#key`. -1 when it has none by that name.
sidecar_target :: proc(m: ^Sidecar_Mesh, name: string) -> int {
	for n, i in m.target_names do if n == name do return i
	return -1
}

// flatten_part from a sidecar: every shape of the part (through `like`),
// one Tri_Mesh each, appended to `out`, in the document's frame and the
// part's rest space, as flatten_part gives them. What differs: a shape's
// triangles come grouped by token (so `tokens` is filled whenever the
// shape paints more than one), `shades` is always filled and already
// holds the shape's own `shade` (so `shade` is left 0, which reads as 1),
// and the normals are the builder's (true corner normals on a smooth
// shape). False, with nothing appended, when the part is not in the
// sidecar: generate it with flatten_part instead.
flatten_part_sidecar :: proc(sc: ^Sidecar, doc: ^Doc3, part: ^Part3, out: ^[dynamic]Tri_Mesh) -> bool {
	index := -1
	for &p, i in doc.parts do if &p == part do index = i
	if index < 0 || index >= len(sc.parts) do return false
	shapes := shapes_of_3d(doc, part)
	pivot := source_of_3d(doc, part).pivot
	prims: []Sidecar_Prim
	if mi := sc.parts[index].mesh; mi >= 0 do prims = sc.meshes[mi].prims
	for &prim in prims do if prim.shape >= len(shapes) do return false
	for &sh, si in shapes {
		m: Tri_Mesh
		m.color = sh.color
		groups, total := 0, 0
		for &prim in prims do if prim.shape == si {
			groups += 1
			total += len(prim.positions)
			if groups == 1 do m.color = prim.token
		}
		if total > 0 {
			reserve(&m.positions, total)
			reserve(&m.normals, total)
			reserve(&m.shades, total)
		}
		for &prim in prims {
			if prim.shape != si do continue
			for p in prim.positions do append(&m.positions, sidecar_point(pivot, p))
			for n in prim.normals do append(&m.normals, V3{n.x, -n.y, -n.z})
			append(&m.shades, ..prim.shade)
			if groups > 1 do for _ in 0 ..< len(prim.positions) / 3 do append(&m.tokens, prim.token)
			if len(prim.uvs) > 0 {
				cell := V2{1, 1}
				if t := texture_of_3d(doc, prim.texture); t != nil && t.cell.x != 0 && t.cell.y != 0 do cell = t.cell
				m.texture = prim.texture
				for uv in prim.uvs do append(&m.uvs, uv * cell)
			}
		}
		append(out, m)
	}
	return true
}
