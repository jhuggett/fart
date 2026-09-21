package fastart

// Scenes: a .shart is a Scene Hierarchy of Art, a tree of placed
// instances of .fart files and other scenes (spec/SHART.md). load_scene
// reads one; flatten_scene reads everything it names through the
// resolver and appends every instance with its document, its tokens
// (the file's, the scenes' palettes, the node's), its pose list and its
// world map: what the game draws with the art's own loop, the world map
// in front. 2D and 3D scenes both come through; a Placed says which.

import "core:encoding/json"
import "core:math"
import "core:math/linalg"
import "core:strings"

Scene_Node :: struct {
	name:     string,
	ref:      string, // a .fart or a .shart; "" for a group
	at:       V3, // x, y (2D) or x, y, z
	rotate:   f32 `json:"-"`, // 2D: radians (from the raw tree: the key holds a number or a triple)
	rotate3:  V3 `json:"-"`, // 3D: [x, y, z]
	scale:    f32, // 0 = 1
	mirror:   bool,
	state:    string,
	clip:     string,
	t:        f32,
	palette:  string,
	attach:   Attach,
	children: [dynamic]Scene_Node,
}

Attach :: struct {
	to: string, // an anchor on the parent's art
	by: string, // an anchor on this art; "" for its origin
}

Scene :: struct {
	version:      int,
	space:        string,
	name:         string,
	palette_refs: [dynamic]string,
	nodes:        [dynamic]Scene_Node,
}

load_scene :: proc(data: []byte) -> (scene: Scene, ok: bool) {
	tree, terr := json.parse(data, allocator = context.temp_allocator)
	if terr != nil do return {}, false
	root, is_obj := tree.(json.Object)
	if !is_obj || !version_ok(root["version"]) do return {}, false
	if json.unmarshal(data, &scene) != nil do return {}, false
	if scene.space == "" do scene.space = "2d"
	// a turn is a number (2D) or [x, y, z] (3D): one key, two shapes, so it comes from the raw tree
	fill :: proc(raw: json.Array, nodes: []Scene_Node) {
		num :: proc(v: json.Value) -> f32 {
			#partial switch x in v {
			case json.Float:
				return f32(x)
			case json.Integer:
				return f32(x)
			}
			return 0
		}
		for v, i in raw {
			if i >= len(nodes) do break
			n := v.(json.Object) or_continue
			if r, has := n["rotate"].(json.Array); has && len(r) == 3 {
				for k in 0 ..< 3 do nodes[i].rotate3[k] = num(r[k])
			} else if r, hr := n["rotate"]; hr do nodes[i].rotate = num(r)
			if kids, hk := n["children"].(json.Array); hk do fill(kids, nodes[i].children[:])
		}
	}
	if raw, has := root["nodes"].(json.Array); has do fill(raw, scene.nodes[:])
	return scene, true
}

destroy_scene :: proc(scene: ^Scene) {
	free_nodes :: proc(nodes: ^[dynamic]Scene_Node) {
		for &n in nodes do free_nodes(&n.children)
		delete(nodes^)
	}
	free_nodes(&scene.nodes)
	delete(scene.palette_refs)
}

// An instance, placed: the art (2D or 3D, by `space`), tokens with the
// scene's and the node's palettes laid over, the pose, the world map.
Placed :: struct {
	path:   string, // node names from the root, joined with "/"
	node:   ^Scene_Node,
	space:  string, // "2d" | "3d"
	doc:    ^Doc, // 2D
	doc3:   ^Doc3, // 3D
	tokens: [dynamic]Tok, // resolved, swapped: look colours up here (token_color)
	poses:  [dynamic]State_Part, // 2D
	poses3: [dynamic]State_Part3, // 3D
	xf:     Xf, // 2D world map
	xf3:    Xf3, // 3D world map
}

// A colour from a Placed's own tokens (back to front, like color_of).
token_color :: proc(p: ^Placed, token: string) -> [4]u8 {
	for i := len(p.tokens) - 1; i >= 0; i -= 1 do if p.tokens[i].name == token do return p.tokens[i].rgb
	return {255, 0, 255, 255}
}

// The loaded files a flatten reads, by path relative to the root scene's
// folder: kept by the caller and freed with destroy_scene_cache.
Scene_Cache :: struct {
	docs:     map[string]^Doc,
	docs3:    map[string]^Doc3,
	scenes:   map[string]^Scene,
	palettes: map[string][dynamic]Tok,
}

destroy_scene_cache :: proc(c: ^Scene_Cache) {
	for _, d in c.docs {
		destroy(d)
		free(d)
	}
	for _, d in c.docs3 {
		destroy_3d(d)
		free(d)
	}
	for _, s in c.scenes {
		destroy_scene(s)
		free(s)
	}
	for _, p in c.palettes do delete(p)
	delete(c.docs)
	delete(c.docs3)
	delete(c.scenes)
	delete(c.palettes)
}

@(private)
join_ref :: proc(dir, rel: string) -> string {
	parts := strings.split(strings.concatenate({dir, rel}, context.temp_allocator), "/", context.temp_allocator)
	out := make([dynamic]string, context.temp_allocator)
	for p in parts {
		if p == "" || p == "." do continue
		if p == ".." && len(out) > 0 && out[len(out) - 1] != ".." do pop(&out)
		else do append(&out, p)
	}
	return strings.join(out[:], "/")
}

@(private)
dir_of :: proc(p: string) -> string {
	for i := len(p) - 1; i >= 0; i -= 1 do if p[i] == '/' do return p[:i + 1]
	return ""
}

@(private)
scene_local_xf :: proc(n: ^Scene_Node) -> Xf {
	s := n.scale == 0 ? f32(1) : n.scale
	c, sn := math.cos(n.rotate) * s, math.sin(n.rotate) * s
	mx: f32 = n.mirror ? -1 : 1
	return {c * mx, sn * mx, -sn, c, n.at.x, n.at.y}
}

@(private)
scene_local_xf3 :: proc(n: ^Scene_Node) -> Xf3 {
	s := n.scale == 0 ? f32(1) : n.scale
	R := linalg.matrix4_from_quaternion_f32(quat_from_euler(n.rotate3))
	S := linalg.matrix4_scale_f32({n.mirror ? -s : s, s, s})
	return linalg.matrix4_translate_f32(n.at) * R * S
}

@(private)
find_anchor :: proc(doc: ^Doc, name: string) -> (part: ^Part, a: ^Anchor) {
	for &p in doc.parts do if x := anchor_of(doc, &p, name); x != nil do return &p, x
	return nil, nil
}
@(private)
find_anchor_3d :: proc(doc: ^Doc3, name: string) -> (part: ^Part3, a: ^Anchor3) {
	for &p in doc.parts do if x := anchor_of_3d(doc, &p, name); x != nil do return &p, x
	return nil, nil
}

// Read everything the scene names (relative to the root scene's folder,
// through the resolver) and append every instance, placed, in paint
// order. `time` is added to every clip's t. Scenes nest; a scene that
// reaches itself is skipped.
flatten_scene :: proc(scene: ^Scene, resolver: Resolver, user: rawptr, cache: ^Scene_Cache, out: ^[dynamic]Placed, time: f32 = 0) {
	outer := make([dynamic][]Tok, context.temp_allocator)
	flatten_into(scene, "", resolver, user, cache, out, time, outer[:], "", nil, nil, make([dynamic]string, context.temp_allocator))
}

@(private)
palette_tokens :: proc(path: string, resolver: Resolver, user: rawptr, cache: ^Scene_Cache) -> ([]Tok, bool) {
	if p, has := cache.palettes[path]; has do return p[:], true
	data, ok := resolver(path, user)
	if !ok do return nil, false
	d, dok := load_bytes(data)
	if !dok do return nil, false
	toks := make([dynamic]Tok)
	append(&toks, ..d.palette[:])
	cache.palettes[path] = toks
	return toks[:], true
}

@(private)
flatten_into :: proc(scene: ^Scene, dir: string, resolver: Resolver, user: rawptr, cache: ^Scene_Cache, out: ^[dynamic]Placed, time: f32, outer: [][]Tok, prefix: string, parent2: ^Xf, parent3: ^Xf3, stack: [dynamic]string) {
	is3 := scene.space == "3d"
	// this scene's palettes, then the outer scenes'
	pals := make([dynamic][]Tok, context.temp_allocator)
	for ref in scene.palette_refs do if p, ok := palette_tokens(join_ref(dir, ref), resolver, user, cache); ok do append(&pals, p)
	append(&pals, ..outer)
	root2 := parent2 == nil ? XF_ID : parent2^
	root3 := parent3 == nil ? XF3_ID : parent3^
	walk(scene, scene.nodes[:], "", dir, resolver, user, cache, out, time, pals[:], prefix, root2, root3, nil, is3, stack)
}

@(private)
walk :: proc(scene: ^Scene, nodes: []Scene_Node, path, dir: string, resolver: Resolver, user: rawptr, cache: ^Scene_Cache, out: ^[dynamic]Placed, time: f32, pals: [][]Tok, prefix: string, parent2: Xf, parent3: Xf3, host: ^Placed, is3: bool, stack: [dynamic]string) {
	for &n in nodes {
		np := path == "" ? n.name : strings.concatenate({path, "/", n.name})
		// the attach map: the host's posed anchor, and this art's own
		A2 := XF_ID
		A3 := XF3_ID
		full := join_ref(dir, n.ref)
		if n.attach.to != "" && host != nil {
			if is3 && host.doc3 != nil {
				hp, ha := find_anchor_3d(host.doc3, n.attach.to)
				if hp != nil {
					item := Anchor3{}
					if n.ref != "" && n.attach.by != "" {
						if d3, has := cache.docs3[full]; has {
							if _, ia := find_anchor_3d(d3, n.attach.by); ia != nil do item = ia^
						}
					}
					A3 = attach_xf_3d(world_xf_3d(host.doc3, host.poses3[:], hp.name), ha, &item)
				}
			} else if !is3 && host.doc != nil {
				hp, ha := find_anchor(host.doc, n.attach.to)
				if hp != nil {
					item := Anchor{}
					if n.ref != "" && n.attach.by != "" {
						if d, has := cache.docs[full]; has {
							if _, ia := find_anchor(d, n.attach.by); ia != nil do item = ia^
						}
					}
					A2 = attach_xf(world_xf(host.doc, host.poses[:], hp.name), ha, &item)
				}
			}
		}
		W2 := parent2 * 1
		W3 := parent3
		if !is3 do W2 = xf_mul(xf_mul(parent2, A2), scene_local_xf(&n))
		else do W3 = parent3 * A3 * scene_local_xf3(&n)
		placed: ^Placed
		if n.ref != "" && strings.has_suffix(n.ref, ".shart") {
			inner, has := cache.scenes[full]
			cyc := false
			for s in stack do if s == full do cyc = true
			if !has && !cyc {
				if data, ok := resolver(full, user); ok {
					if sc, sok := load_scene(data); sok {
						inner = new(Scene)
						inner^ = sc
						cache.scenes[full] = inner
						has = true
					}
				}
			}
			if has && !cyc {
				st2 := make([dynamic]string, context.temp_allocator)
				append(&st2, ..stack[:])
				append(&st2, full)
				w2, w3 := W2, W3
				flatten_into(inner, dir_of(full), resolver, user, cache, out, time, pals, strings.concatenate({prefix, np, "/"}), &w2, &w3, st2)
			}
		} else if n.ref != "" {
			// the art, read once per path
			if is3 {
				d3, has := cache.docs3[full]
				if !has {
					if data, ok := resolver(full, user); ok {
						if d, dok := load_bytes_3d(data); dok {
							d3 = new(Doc3)
							d3^ = d
							sub := dir_of(full)
							resolve_palettes_3d(d3, resolver, user) // refs as written: the game's resolver roots them
							cache.docs3[full] = d3
							has = true
							_ = sub
						}
					}
				}
				if has {
					append(out, Placed{path = strings.concatenate({prefix, np}), node = &n, space = "3d", doc3 = d3, xf3 = W3})
					placed = &out[len(out) - 1]
					if len(d3.resolved) > 0 do append(&placed.tokens, ..d3.resolved[:])
					else do append(&placed.tokens, ..d3.palette[:])
					if n.clip != "" {
						if c := clip_of_3d(d3, n.clip); c != nil {
							sample_clip_3d(d3, c, n.t + time, &placed.poses3)
							tg := make([dynamic]Target3, context.temp_allocator)
							sample_targets_3d(d3, c, n.t + time, &tg)
							if len(tg) > 0 do solve_targets_3d(d3, &placed.poses3, tg[:])
						}
					} else {
						st := n.state != "" ? state_of_3d(d3, n.state) : nil
						if st == nil && len(d3.states) > 0 do st = &d3.states[0]
						if st != nil do append(&placed.poses3, ..st.parts[:])
					}
				}
			} else {
				d, has := cache.docs[full]
				if !has {
					if data, ok := resolver(full, user); ok {
						if dd, dok := load_bytes(data); dok {
							d = new(Doc)
							d^ = dd
							resolve_palettes(d, resolver, user)
							cache.docs[full] = d
							has = true
						}
					}
				}
				if has {
					append(out, Placed{path = strings.concatenate({prefix, np}), node = &n, space = "2d", doc = d, xf = W2})
					placed = &out[len(out) - 1]
					if len(d.resolved) > 0 do append(&placed.tokens, ..d.resolved[:])
					else do append(&placed.tokens, ..d.palette[:])
					if n.clip != "" {
						if c := clip_of(d, n.clip); c != nil {
							sample_clip(d, c, n.t + time, &placed.poses)
							tg := make([dynamic]Target, context.temp_allocator)
							sample_targets(d, c, n.t + time, &tg)
							if len(tg) > 0 do solve_targets(d, &placed.poses, tg[:])
						}
					} else {
						st := n.state != "" ? state_of(d, n.state) : nil
						if st == nil && len(d.states) > 0 do st = &d.states[0]
						if st != nil do append(&placed.poses, ..st.parts[:])
					}
				}
			}
			if placed != nil {
				// the scenes' palettes, then the node's, laid over the instance's tokens
				lay :: proc(toks: ^[dynamic]Tok, pal: []Tok) {
					for p in pal {
						hit := false
						for i := len(toks) - 1; i >= 0; i -= 1 do if toks[i].name == p.name {
							toks[i].rgb = p.rgb
							hit = true
							break
						}
						if !hit do append(toks, p)
					}
				}
				for p in pals do lay(&placed.tokens, p)
				if n.palette != "" {
					if p, ok := palette_tokens(join_ref(dir, n.palette), resolver, user, cache); ok do lay(&placed.tokens, p)
				}
			}
		}
		if len(n.children) > 0 do walk(scene, n.children[:], np, dir, resolver, user, cache, out, time, pals, prefix, W2, W3, placed, is3, stack)
	}
}

destroy_placed :: proc(ps: ^[dynamic]Placed) {
	for &p in ps {
		delete(p.tokens)
		delete(p.poses)
		delete(p.poses3)
	}
	delete(ps^)
}
