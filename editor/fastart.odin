package main

// fastart: the Fast Art Format editor. It edits .fart files; that is all it
// does, and all it will ever do.
//
//   fastart                   browse every .fart under the current dir
//   fastart thing.fart        edit one file (created if missing)
//
// Mouse-first: toolbar for tools, panels for palette/parts/states, drag
// handles on selected shapes. Keyboard accelerators: 1-4 tools, X delete,
// Cmd+S save, Cmd+Z undo, Cmd+O browse, Esc deselect/cancel.

import "core:encoding/json"
import "core:fmt"
import "core:math"
import "core:strings"
import rl "vendor:raylib"
import "vendor:raylib/rlgl"
import fart "../loaders/odin"

// Platform seam (plat_native.odin / plat_js.odin): file IO, args, fonts,
// window fitting. The web build routes IO through the serving machine.

V2 :: fart.V2

Tool :: enum {
	Select,
	Circle,
	Line,
	Poly,
	Rect, // an editor kindness: saved as a four-cornered poly
}

Mode :: enum {
	Browse,
	Edit,
}

Pending :: enum {
	None,
	Pivot,
	Anchor,
}

// A copied shape remembers the part it came from by name, so a paste can
// land it in the right part -- even in a different file.
Clip :: struct {
	part: string,
	sh:   fart.Shape,
}

Ed :: struct {
	mode:      Mode,
	scroll:    f32, // browse-gallery scroll
	bdrag:     bool, // browse touch: a drag scrolls, only a tap opens
	bmoved:    bool,
	bstart:    rl.Vector2,
	blast:     rl.Vector2,
	found:     [dynamic]string,
	thumbs:    [dynamic]fart.Doc,
	thumb_ok:  [dynamic]bool,
	path:      string,
	doc:       fart.Doc,
	tool:      Tool,
	add_open:  bool, // the + Add dropdown
	collide:   bool, // the collision lens: edit doc.collision, art dimmed
	col_sel:   int, // selected collision shape, -1 none
	pending:   Pending,
	pan:       V2,
	zoom:      f32,
	cur_part:  int,
	cur_tok:   int,
	cur_state: int, // -1 = all
	sel_part:  int, // primary selection (the last one picked)
	sel_shape: int,
	sel_set:   [dynamic][2]int, // every selected {part, shape}
	marquee:   bool,
	mq_a:      V2,
	hov_part:  int,
	hov_shape: int,
	dragging:  bool, // body drag
	drag_off:  V2,
	lscroll, rscroll:   f32, // the side panels scroll too
	lcontent, rcontent: f32, // measured content heights (last frame)
	pdrag:     int, // 0 none, 1 left panel, 2 right panel
	plast:     rl.Vector2,
	touch2:    bool, // two fingers down (pan/pinch on touch screens)
	tmid:      rl.Vector2,
	tdist:     f32,
	handle:    int, // >0: dragging that handle of the selection
	scaling:   bool, // dragging a corner of the selection's box
	scale_anchor: V2,
	scale_d:   f32,
	pose_drag: bool, // pose mode: moving a part's offset
	pose_rot:  bool, // pose mode: turning the rotate lever
	pose_grab: V2,
	pose_rot0: f32,
	pose_ang0: f32,
	drawing:   bool,
	draw_a:    V2,
	poly_pts:  [dynamic]V2,
	clip:      [dynamic]Clip,
	paste_n:   int, // pastes since the copy, for the stacking nudge
	undo:      [dynamic]string,
	redo:      [dynamic]string,
	undo_open: bool, // merge slider drags into one undo step
	drag_pushed: bool, // body-drag snapshots on first movement, not on click
	base:       string, // the doc as of the last real save (the rollback point)
	last_flush: string, // the doc as last written to disk (live scratch)
	flush_t:    f32,
	prompt_on: bool,
	prompt:    strings.Builder,
	prompt_what: string,
	rename_idx: int, // which part/state/token a rename prompt is aimed at
	click_t:    f64, // double-click tracking on list rows
	click_id:   int,
	dirty:     bool,
	slider_id: int, // active slider, 0 none
	anchor_at: V2,
}

ed: Ed
g_mouse: rl.Vector2
g_click: bool
g_down: bool
g_released: bool
g_shot: string // --shot out.png: render a few frames, save, exit (dev)
// Web retina: the canvas backs at devicePixelRatio and the UI scales up by
// the same factor, so layout stays in logical pixels and text stays sharp.
// Native keeps 1 -- the HIGHDPI window flag already handles density there.
g_ui_scale: f32 = 1
g_press: rl.Vector2 // where the press began; a tap is a release near it
g_tap: bool
g_ui_min_y: f32 // widgets above this line are clipped away (panel scroll)
g_shot_t: int

// ------------------------------------------------------------- helpers

dirname :: proc(path: string) -> string {
	for i := len(path) - 1; i >= 0; i -= 1 {
		if path[i] == '/' do return path[:i]
	}
	return "."
}

disk_resolver :: proc(path: string, user: rawptr) -> ([]byte, bool) {
	base := (^string)(user)^
	return plat_read(fmt.tprintf("%s/%s", base, path))
}

resolve_for :: proc(doc: ^fart.Doc, file_path: string) {
	dir := dirname(file_path)
	fart.resolve_palettes(doc, disk_resolver, &dir)
}

// Logical (UI-scale-independent) screen size; all layout speaks this.
scr :: proc() -> (w, h: f32) {
	return f32(rl.GetScreenWidth()) / g_ui_scale, f32(rl.GetScreenHeight()) / g_ui_scale
}

to_screen :: proc(p: V2) -> rl.Vector2 {
	w, h := scr()
	return {(p.x - ed.pan.x) * ed.zoom + w / 2, (p.y - ed.pan.y) * ed.zoom + h / 2}
}

to_world :: proc(s: rl.Vector2) -> V2 {
	w, h := scr()
	return {(s.x - w / 2) / ed.zoom + ed.pan.x, (s.y - h / 2) / ed.zoom + ed.pan.y}
}

col_of :: proc(doc: ^fart.Doc, tok: string) -> rl.Color {
	c := fart.color_of(doc, tok)
	return {c[0], c[1], c[2], c[3]}
}

cur_part :: proc() -> ^fart.Part {
	if ed.cur_part < 0 || ed.cur_part >= len(ed.doc.parts) do return nil
	return &ed.doc.parts[ed.cur_part]
}

sel :: proc() -> ^fart.Shape {
	if ed.sel_part < 0 || ed.sel_part >= len(ed.doc.parts) do return nil
	if ed.sel_shape < 0 || ed.sel_shape >= len(ed.doc.parts[ed.sel_part].shapes) do return nil
	return &ed.doc.parts[ed.sel_part].shapes[ed.sel_shape]
}

// ------------------------------------------------- the selection set

sel_clear :: proc() {
	clear(&ed.sel_set)
	ed.sel_part, ed.sel_shape = -1, -1
}

sel_has :: proc(p, s: int) -> bool {
	for e in ed.sel_set do if e[0] == p && e[1] == s do return true
	return false
}

sel_only :: proc(p, s: int) {
	clear(&ed.sel_set)
	append(&ed.sel_set, [2]int{p, s})
	ed.sel_part, ed.sel_shape = p, s
}

sel_primary_fix :: proc() {
	if len(ed.sel_set) > 0 {
		last := ed.sel_set[len(ed.sel_set) - 1]
		ed.sel_part, ed.sel_shape = last[0], last[1]
	} else {
		ed.sel_part, ed.sel_shape = -1, -1
	}
}

sel_toggle :: proc(p, s: int) {
	for e, i in ed.sel_set do if e[0] == p && e[1] == s {
		unordered_remove(&ed.sel_set, i)
		sel_primary_fix()
		return
	}
	append(&ed.sel_set, [2]int{p, s})
	ed.sel_part, ed.sel_shape = p, s
}

sel_delete :: proc() {
	if len(ed.sel_set) == 0 do return
	push_undo()
	// highest shape index first, so the rest stay valid
	for len(ed.sel_set) > 0 {
		bi := 0
		for e, i in ed.sel_set do if e[1] > ed.sel_set[bi][1] do bi = i
		e := ed.sel_set[bi]
		if e[0] >= 0 && e[0] < len(ed.doc.parts) && e[1] >= 0 && e[1] < len(ed.doc.parts[e[0]].shapes) {
			ordered_remove(&ed.doc.parts[e[0]].shapes, e[1])
		}
		unordered_remove(&ed.sel_set, bi)
	}
	ed.sel_part, ed.sel_shape = -1, -1
}

// Move everything selected into the current part (in one bunch, on top).
sel_to_part :: proc() {
	p := cur_part()
	if p == nil || len(ed.sel_set) == 0 do return
	push_undo()
	moved := make([dynamic]fart.Shape, context.temp_allocator)
	for len(ed.sel_set) > 0 {
		bi := 0
		for e, i in ed.sel_set do if e[1] > ed.sel_set[bi][1] do bi = i
		e := ed.sel_set[bi]
		if e[0] != ed.cur_part && e[0] >= 0 && e[0] < len(ed.doc.parts) && e[1] >= 0 && e[1] < len(ed.doc.parts[e[0]].shapes) {
			append(&moved, ed.doc.parts[e[0]].shapes[e[1]])
			ordered_remove(&ed.doc.parts[e[0]].shapes, e[1])
		}
		unordered_remove(&ed.sel_set, bi)
	}
	for k := len(moved) - 1; k >= 0; k -= 1 do append(&p.shapes, moved[k])
	base := len(p.shapes) - len(moved)
	for k in 0 ..< len(moved) do append(&ed.sel_set, [2]int{ed.cur_part, base + k})
	sel_primary_fix()
}

// One step up or down the stack: later in the list draws on top. A crowd
// steps together -- each shape moves one slot within its own part, walked
// from the leading edge, so the crowd keeps its internal order and drifts
// through the unselected shapes (pressing together at the ends).
@(private = "file")
sel_order_walk :: proc(up: bool) {
	if len(ed.sel_set) == 0 do return
	dir := up ? 1 : -1
	ok :: proc(e: [2]int, dir: int) -> bool {
		if e[0] < 0 || e[0] >= len(ed.doc.parts) do return false
		n := e[1] + dir
		return n >= 0 && n < len(ed.doc.parts[e[0]].shapes) && !sel_has(e[0], n)
	}
	movable := false
	for e in ed.sel_set do if ok(e, dir) {
		movable = true
		break
	}
	if !movable do return
	push_undo()
	// leading edge first: topmost when raising, bottom-most when lowering
	order := make([dynamic]int, context.temp_allocator)
	for _, i in ed.sel_set do append(&order, i)
	for i in 1 ..< len(order) {
		j := i
		for j > 0 &&
		    (up ?
				    ed.sel_set[order[j - 1]][1] < ed.sel_set[order[j]][1] :
				    ed.sel_set[order[j - 1]][1] > ed.sel_set[order[j]][1]) {
			order[j - 1], order[j] = order[j], order[j - 1]
			j -= 1
		}
	}
	for oi in order {
		e := &ed.sel_set[oi]
		if !ok(e^, dir) do continue
		part := &ed.doc.parts[e[0]]
		part.shapes[e[1]], part.shapes[e[1] + dir] = part.shapes[e[1] + dir], part.shapes[e[1]]
		e[1] += dir
	}
	sel_primary_fix()
}

sel_raise :: proc() {
	sel_order_walk(true)
}

sel_lower :: proc() {
	sel_order_walk(false)
}

// Deleting a part takes its shapes with it; states drop the name.
part_delete :: proc(k: int) {
	if k < 0 || k >= len(ed.doc.parts) do return
	push_undo()
	name := ed.doc.parts[k].name
	for &st in ed.doc.states {
		for i := len(st.parts) - 1; i >= 0; i -= 1 {
			if st.parts[i].part == name do ordered_remove(&st.parts, i)
		}
	}
	for i := len(ed.sel_set) - 1; i >= 0; i -= 1 {
		if ed.sel_set[i][0] == k do unordered_remove(&ed.sel_set, i)
		else if ed.sel_set[i][0] > k do ed.sel_set[i][0] -= 1
	}
	sel_primary_fix()
	ordered_remove(&ed.doc.parts, k)
	if ed.cur_part > k do ed.cur_part -= 1
	ensure_defaults()
	ed.cur_part = clamp(ed.cur_part, 0, len(ed.doc.parts) - 1)
}

state_delete :: proc(k: int) {
	if k < 0 || k >= len(ed.doc.states) do return
	push_undo()
	ordered_remove(&ed.doc.states, k)
	if ed.cur_state == k do ed.cur_state = -1
	else if ed.cur_state > k do ed.cur_state -= 1
}

// Shapes still wearing a deleted token keep the name; shared palettes may
// still answer for it, otherwise the loader's fallback does.
token_delete :: proc(k: int) {
	if k < 0 || k >= len(ed.doc.palette) do return
	push_undo()
	ordered_remove(&ed.doc.palette, k)
	if ed.cur_tok > k do ed.cur_tok -= 1
	ensure_defaults()
	ed.cur_tok = clamp(ed.cur_tok, 0, len(ed.doc.palette) - 1)
}

// Swap two parts in the draw order (states name parts, so names keep working).
part_swap :: proc(a, b: int) {
	if a < 0 || b < 0 || a >= len(ed.doc.parts) || b >= len(ed.doc.parts) do return
	push_undo()
	ed.doc.parts[a], ed.doc.parts[b] = ed.doc.parts[b], ed.doc.parts[a]
	for &e in ed.sel_set {
		if e[0] == a do e[0] = b
		else if e[0] == b do e[0] = a
	}
	if ed.sel_part == a do ed.sel_part = b
	else if ed.sel_part == b do ed.sel_part = a
	if ed.cur_part == a do ed.cur_part = b
	else if ed.cur_part == b do ed.cur_part = a
}

// ------------------------------------------------- copy, paste, duplicate

shape_copy :: proc(sh: ^fart.Shape) -> fart.Shape {
	c: fart.Shape
	c.kind = strings.clone(sh.kind)
	c.color = strings.clone(sh.color)
	c.at, c.r = sh.at, sh.r
	c.a, c.b, c.w = sh.a, sh.b, sh.w
	for q in sh.points do append(&c.points, q)
	// tris rebake on the next write
	return c
}

clip_clear :: proc() {
	for &c in ed.clip {
		delete(c.part)
		delete(c.sh.kind)
		delete(c.sh.color)
		delete(c.sh.points)
		delete(c.sh.tris)
	}
	clear(&ed.clip)
}

// Copy in draw order, so a paste rebuilds the same stacking.
copy_sel :: proc() {
	if len(ed.sel_set) == 0 do return
	clip_clear()
	for pk in 0 ..< len(ed.doc.parts) {
		for sk in 0 ..< len(ed.doc.parts[pk].shapes) {
			if sel_has(pk, sk) {
				append(&ed.clip, Clip {
					part = strings.clone(ed.doc.parts[pk].name),
					sh   = shape_copy(&ed.doc.parts[pk].shapes[sk]),
				})
			}
		}
	}
	ed.paste_n = 0
}

// Each shape lands in its same-named part if one exists, else the current
// part; every paste nudges a little further so they don't stack invisibly.
paste_clip :: proc() {
	if len(ed.clip) == 0 do return
	push_undo()
	ed.paste_n += 1
	off := V2{f32(ed.paste_n) * 2, f32(ed.paste_n) * 2}
	sel_clear()
	for &c in ed.clip {
		target := -1
		for &p, k in ed.doc.parts do if p.name == c.part {
			target = k
			break
		}
		if target < 0 do target = ed.cur_part
		if target < 0 || target >= len(ed.doc.parts) do continue
		sh := shape_copy(&c.sh)
		shape_move(&sh, off)
		append(&ed.doc.parts[target].shapes, sh)
		append(&ed.sel_set, [2]int{target, len(ed.doc.parts[target].shapes) - 1})
	}
	sel_primary_fix()
}

// Duplicate in place (a small nudge), without touching the clipboard.
dup_sel :: proc() {
	if len(ed.sel_set) == 0 do return
	push_undo()
	refs := make([dynamic][2]int, context.temp_allocator)
	for pk in 0 ..< len(ed.doc.parts) {
		for sk in 0 ..< len(ed.doc.parts[pk].shapes) {
			if sel_has(pk, sk) do append(&refs, [2]int{pk, sk})
		}
	}
	sel_clear()
	for e in refs {
		sh := shape_copy(&ed.doc.parts[e[0]].shapes[e[1]])
		shape_move(&sh, {2, 2})
		append(&ed.doc.parts[e[0]].shapes, sh)
		append(&ed.sel_set, [2]int{e[0], len(ed.doc.parts[e[0]].shapes) - 1})
	}
	sel_primary_fix()
}

// ------------------------------------------------- pose mode
// Selecting a state turns the canvas into pose mode: parts draw with the
// state's transforms applied, dragging a part moves its offset, a lever at
// the pivot turns it. Geometry is locked; only the state changes.
// Convention (matches the game's art_draw): offset is where the part's
// pivot LANDS -- identity is offset == pivot, not offset == zero.

state_cur :: proc() -> ^fart.State {
	if ed.cur_state < 0 || ed.cur_state >= len(ed.doc.states) do return nil
	return &ed.doc.states[ed.cur_state]
}

pose_of :: proc(st: ^fart.State, part_name: string) -> ^fart.State_Part {
	for &sp in st.parts do if sp.part == part_name do return &sp
	return nil
}

cur_pose :: proc(st: ^fart.State) -> ^fart.State_Part {
	p := cur_part()
	if p == nil do return nil
	return pose_of(st, p.name)
}

pose_pt :: proc(p: V2, part: ^fart.Part, sp: ^fart.State_Part) -> V2 {
	s := sp.scale == 0 ? f32(1) : sp.scale
	ca, sa := math.cos(sp.rotate), math.sin(sp.rotate)
	l := (p - part.pivot) * s
	return sp.offset + V2{l.x * ca - l.y * sa, l.x * sa + l.y * ca}
}

pose_unpt :: proc(m: V2, part: ^fart.Part, sp: ^fart.State_Part) -> V2 {
	s := sp.scale == 0 ? f32(1) : sp.scale
	ca, sa := math.cos(-sp.rotate), math.sin(-sp.rotate)
	l := m - sp.offset
	l = {l.x * ca - l.y * sa, l.x * sa + l.y * ca}
	return part.pivot + l / s
}

pose_rot_handle :: proc(sp: ^fart.State_Part) -> V2 {
	l := 40 / ed.zoom
	return sp.offset + V2{math.cos(sp.rotate), math.sin(sp.rotate)} * l
}

// Which state part is under the cursor (topmost wins, like pick).
pose_pick :: proc(st: ^fart.State, at: V2) -> int {
	best := -1
	bd := 10 / ed.zoom + 2
	for &sp, i in st.parts {
		part := fart.part_of(&ed.doc, sp.part)
		if part == nil do continue
		l := pose_unpt(at, part, &sp)
		for &sh in part.shapes {
			d := shape_dist(&sh, l)
			if d <= bd {
				bd = d
				best = i
			}
		}
	}
	return best
}

pose_interact :: proc(st: ^fart.State, wm: V2) {
	if g_click {
		grabbed := false
		if sp := cur_pose(st); sp != nil {
			if vlen(pose_rot_handle(sp), wm) * ed.zoom < 10 {
				push_undo()
				ed.pose_rot = true
				ed.pose_rot0 = sp.rotate
				ed.pose_ang0 = math.atan2(wm.y - sp.offset.y, wm.x - sp.offset.x)
				grabbed = true
			}
		}
		if !grabbed {
			if pi := pose_pick(st, wm); pi >= 0 {
				name := st.parts[pi].part
				for &p, k in ed.doc.parts do if p.name == name do ed.cur_part = k
				push_undo()
				ed.pose_drag = true
				ed.pose_grab = wm - st.parts[pi].offset
			}
		}
	}
	if g_down && ed.pose_rot {
		if sp := cur_pose(st); sp != nil {
			a := math.atan2(wm.y - sp.offset.y, wm.x - sp.offset.x)
			sp.rotate = ed.pose_rot0 + (a - ed.pose_ang0)
			ed.dirty = true
		}
	} else if g_down && ed.pose_drag {
		if sp := cur_pose(st); sp != nil {
			sp.offset = wm - ed.pose_grab
			ed.dirty = true
		}
	}
	if g_released {
		ed.pose_drag = false
		ed.pose_rot = false
	}
}

draw_part_posed :: proc(doc: ^fart.Doc, part: ^fart.Part, sp: ^fart.State_Part, outline: rl.Color) {
	s := sp.scale == 0 ? f32(1) : sp.scale
	for &sh in part.shapes {
		c := col_of(doc, sh.color)
		switch sh.kind {
		case "circle":
			ctr := to_screen(pose_pt(sh.at, part, sp))
			rl.DrawCircleV(ctr, sh.r * s * ed.zoom, c)
			if outline.a > 0 do rl.DrawCircleLinesV(ctr, sh.r * s * ed.zoom + 1, outline)
		case "line":
			a := to_screen(pose_pt(sh.a, part, sp))
			b := to_screen(pose_pt(sh.b, part, sp))
			w_ := sh.w * s * ed.zoom
			rl.DrawLineEx(a, b, w_, c)
			rl.DrawCircleV(a, w_ * 0.5, c)
			rl.DrawCircleV(b, w_ * 0.5, c)
			if outline.a > 0 do rl.DrawLineEx(a, b, max(w_ * 0.2, 1.5), outline)
		case "poly":
			n := len(sh.points)
			if n < 3 do continue
			tri := make([dynamic]u16, context.temp_allocator)
			fart.triangulate(sh.points[:], &tri)
			posed := make([dynamic]rl.Vector2, 0, n, context.temp_allocator)
			for q in sh.points do append(&posed, to_screen(pose_pt(q, part, sp)))
			k := 0
			for k + 2 < len(tri) {
				rl.DrawTriangle(posed[tri[k]], posed[tri[k + 1]], posed[tri[k + 2]], c)
				rl.DrawTriangle(posed[tri[k]], posed[tri[k + 2]], posed[tri[k + 1]], c)
				k += 3
			}
			if outline.a > 0 {
				for q, qi in posed do rl.DrawLineV(q, posed[(qi + 1) % n], outline)
			}
		}
	}
}

// ------------------------------------------------- the collision lens
// doc.collision holds ordinary shapes the game may treat as solid (a line
// is a capsule). The lens dims the art and edits that list with the same
// tools; nothing here is ever drawn by the game.

col_shape :: proc() -> ^fart.Shape {
	if ed.col_sel < 0 || ed.col_sel >= len(ed.doc.collision) do return nil
	return &ed.doc.collision[ed.col_sel]
}

col_handles :: proc(sh: ^fart.Shape, out: ^[dynamic]V2) {
	clear(out)
	switch sh.kind {
	case "circle":
		append(out, sh.at + {sh.r, 0})
	case "line":
		append(out, sh.a)
		append(out, sh.b)
	case "poly":
		for q in sh.points do append(out, q)
	}
}

collide_interact :: proc(wm: V2) {
	switch ed.tool {
	case .Select:
		if g_click {
			ed.handle = 0
			if sh := col_shape(); sh != nil {
				hs := make([dynamic]V2, context.temp_allocator)
				col_handles(sh, &hs)
				for hp, hk in hs do if vlen(hp, wm) * ed.zoom < 8 {
					ed.handle = hk + 1
					push_undo()
					break
				}
			}
			if ed.handle == 0 {
				pi := -1
				best := 10 / ed.zoom + 2
				for &sh, i in ed.doc.collision {
					d := shape_dist(&sh, wm)
					if d <= best {
						best = d
						pi = i
					}
				}
				ed.col_sel = pi
				if pi >= 0 {
					ed.dragging = true
					ed.drag_pushed = false
					ed.drag_off = wm
				}
			}
		}
		if g_down && ed.handle > 0 {
			if sh := col_shape(); sh != nil {
				switch sh.kind {
				case "circle":
					sh.r = max(vlen(sh.at, wm), 0.2)
				case "line":
					if ed.handle == 1 do sh.a = wm
					else do sh.b = wm
				case "poly":
					if i := ed.handle - 1; i < len(sh.points) {
						alt := rl.IsKeyDown(.LEFT_ALT) || rl.IsKeyDown(.RIGHT_ALT)
						if !alt && poly_is_rect(sh.points[:]) {
							old := sh.points[i]
							prev := &sh.points[(i + 3) % 4]
							next := &sh.points[(i + 1) % 4]
							if abs(prev.x - old.x) < 0.001 do prev.x = wm.x
							if abs(prev.y - old.y) < 0.001 do prev.y = wm.y
							if abs(next.x - old.x) < 0.001 do next.x = wm.x
							if abs(next.y - old.y) < 0.001 do next.y = wm.y
						}
						sh.points[i] = wm
					}
				}
				ed.dirty = true
			}
		} else if g_down && ed.dragging {
			if sh := col_shape(); sh != nil {
				d := wm - ed.drag_off
				if d != {} {
					if !ed.drag_pushed {
						push_undo()
						ed.drag_pushed = true
					}
					shape_move(sh, d)
					ed.drag_off = wm
				}
			}
		}
		if g_released {
			ed.dragging = false
			ed.handle = 0
		}
	case .Circle, .Line, .Rect:
		if g_click {
			ed.drawing = true
			ed.draw_a = wm
		}
		if ed.drawing && g_released {
			ed.drawing = false
			push_undo()
			sh: fart.Shape
			if ed.tool == .Circle {
				sh.kind = strings.clone("circle")
				sh.at = ed.draw_a
				sh.r = max(vlen(ed.draw_a, wm), 0.4)
			} else if ed.tool == .Rect {
				sh.kind = strings.clone("poly")
				lo := V2{min(ed.draw_a.x, wm.x), min(ed.draw_a.y, wm.y)}
				hi := V2{max(ed.draw_a.x, wm.x), max(ed.draw_a.y, wm.y)}
				if hi.x - lo.x < 0.3 do hi.x = lo.x + 0.3
				if hi.y - lo.y < 0.3 do hi.y = lo.y + 0.3
				append(&sh.points, lo)
				append(&sh.points, V2{hi.x, lo.y})
				append(&sh.points, hi)
				append(&sh.points, V2{lo.x, hi.y})
			} else {
				sh.kind = strings.clone("line")
				sh.a = ed.draw_a
				sh.b = wm
				sh.w = 6
			}
			append(&ed.doc.collision, sh)
			ed.col_sel = len(ed.doc.collision) - 1
		}
	case .Poly:
		if g_click {
			close_it := len(ed.poly_pts) >= 3 && vlen(ed.poly_pts[0], wm) * ed.zoom < 10
			if close_it {
				push_undo()
				sh: fart.Shape
				sh.kind = strings.clone("poly")
				for q in ed.poly_pts do append(&sh.points, q)
				append(&ed.doc.collision, sh)
				ed.col_sel = len(ed.doc.collision) - 1
				clear(&ed.poly_pts)
			} else do append(&ed.poly_pts, wm)
		}
	}
}

col_delete :: proc() {
	if ed.col_sel < 0 || ed.col_sel >= len(ed.doc.collision) do return
	push_undo()
	ordered_remove(&ed.doc.collision, ed.col_sel)
	ed.col_sel = -1
}

COL_FILL :: rl.Color{90, 200, 235, 55}
COL_LINE :: rl.Color{90, 200, 235, 215}

draw_col_shape :: proc(sh: ^fart.Shape, selected: bool) {
	outline := selected ? UI_ACCENT : COL_LINE
	switch sh.kind {
	case "circle":
		c := to_screen(sh.at)
		rl.DrawCircleV(c, sh.r * ed.zoom, COL_FILL)
		rl.DrawCircleLinesV(c, sh.r * ed.zoom, outline)
	case "line":
		a, b := to_screen(sh.a), to_screen(sh.b)
		w_ := sh.w * ed.zoom
		rl.DrawLineEx(a, b, w_, COL_FILL)
		rl.DrawCircleV(a, w_ * 0.5, COL_FILL)
		rl.DrawCircleV(b, w_ * 0.5, COL_FILL)
		rl.DrawLineEx(a, b, 1.5, outline)
	case "poly":
		n := len(sh.points)
		if n < 3 do return
		tri := make([dynamic]u16, context.temp_allocator)
		fart.triangulate(sh.points[:], &tri)
		pts := make([dynamic]rl.Vector2, 0, n, context.temp_allocator)
		for q in sh.points do append(&pts, to_screen(q))
		k := 0
		for k + 2 < len(tri) {
			rl.DrawTriangle(pts[tri[k]], pts[tri[k + 1]], pts[tri[k + 2]], COL_FILL)
			rl.DrawTriangle(pts[tri[k]], pts[tri[k + 2]], pts[tri[k + 1]], COL_FILL)
			k += 3
		}
		for q, qi in pts do rl.DrawLineV(q, pts[(qi + 1) % n], outline)
	}
}

// ------------------------------------------------- scaling a selection

sel_bounds :: proc() -> (lo, hi: V2, ok: bool) {
	lo, hi = {1e9, 1e9}, {-1e9, -1e9}
	for e in ed.sel_set {
		if e[0] < 0 || e[0] >= len(ed.doc.parts) || e[1] < 0 || e[1] >= len(ed.doc.parts[e[0]].shapes) do continue
		slo, shi := shape_bounds(&ed.doc.parts[e[0]].shapes[e[1]])
		lo.x = min(lo.x, slo.x)
		lo.y = min(lo.y, slo.y)
		hi.x = max(hi.x, shi.x)
		hi.y = max(hi.y, shi.y)
		ok = true
	}
	return
}

scale_sel :: proc(f: f32, anchor: V2) {
	for e in ed.sel_set {
		if e[0] < 0 || e[0] >= len(ed.doc.parts) || e[1] < 0 || e[1] >= len(ed.doc.parts[e[0]].shapes) do continue
		sh := &ed.doc.parts[e[0]].shapes[e[1]]
		switch sh.kind {
		case "circle":
			sh.at = anchor + (sh.at - anchor) * f
			sh.r *= f
		case "line":
			sh.a = anchor + (sh.a - anchor) * f
			sh.b = anchor + (sh.b - anchor) * f
			sh.w *= f
		case "poly":
			for &q in sh.points do q = anchor + (q - anchor) * f
		}
	}
	ed.dirty = true
}

// A four-point poly that is still axis-aligned-rectangular: each corner
// shares an x with one neighbor and a y with the other.
poly_is_rect :: proc(pts: []V2) -> bool {
	if len(pts) != 4 do return false
	eq :: proc(a, b: f32) -> bool {
		return abs(a - b) < 0.001
	}
	c1 := eq(pts[0].x, pts[3].x) && eq(pts[0].y, pts[1].y) && eq(pts[2].x, pts[1].x) && eq(pts[2].y, pts[3].y)
	c2 := eq(pts[0].x, pts[1].x) && eq(pts[0].y, pts[3].y) && eq(pts[2].x, pts[3].x) && eq(pts[2].y, pts[1].y)
	return c1 || c2
}

shape_bounds :: proc(sh: ^fart.Shape) -> (lo, hi: V2) {
	switch sh.kind {
	case "circle":
		lo = sh.at - {sh.r, sh.r}
		hi = sh.at + {sh.r, sh.r}
	case "line":
		h := sh.w * 0.5
		lo = {min(sh.a.x, sh.b.x) - h, min(sh.a.y, sh.b.y) - h}
		hi = {max(sh.a.x, sh.b.x) + h, max(sh.a.y, sh.b.y) + h}
	case "poly":
		lo, hi = {1e9, 1e9}, {-1e9, -1e9}
		for q in sh.points {
			lo.x = min(lo.x, q.x)
			lo.y = min(lo.y, q.y)
			hi.x = max(hi.x, q.x)
			hi.y = max(hi.y, q.y)
		}
	}
	return
}

cur_tok_name :: proc() -> string {
	if ed.cur_tok < 0 || ed.cur_tok >= len(ed.doc.palette) do return "?"
	return ed.doc.palette[ed.cur_tok].name
}

// A real change is coming: remember the state before it, and the redo
// branch you were on is no more.
push_undo :: proc() {
	if ed.undo_open do return
	data, err := json.marshal(ed.doc, {})
	if err == nil {
		s := string(data)
		if len(ed.undo) > 0 && ed.undo[len(ed.undo) - 1] == s {
			delete(s)
		} else {
			append(&ed.undo, s)
			if len(ed.undo) > 64 {
				delete(ed.undo[0])
				ordered_remove(&ed.undo, 0)
			}
			for r in ed.redo do delete(r)
			clear(&ed.redo)
		}
	}
	ed.dirty = true
}

restore_snap :: proc(snap: string) {
	if doc, ok := fart.load_bytes(transmute([]byte)snap); ok {
		fart.destroy(&ed.doc)
		ed.doc = doc
		resolve_for(&ed.doc, ed.path)
		ed.cur_part = clamp(ed.cur_part, 0, max(len(ed.doc.parts) - 1, 0))
		ed.cur_tok = clamp(ed.cur_tok, 0, max(len(ed.doc.palette) - 1, 0))
		ed.cur_state = clamp(ed.cur_state, -1, len(ed.doc.states) - 1)
		sel_clear()
	}
}

do_undo :: proc() {
	if len(ed.undo) == 0 do return
	if cur, err := json.marshal(ed.doc, {}); err == nil do append(&ed.redo, string(cur))
	snap := pop(&ed.undo)
	restore_snap(snap)
	delete(snap)
}

do_redo :: proc() {
	if len(ed.redo) == 0 do return
	if cur, err := json.marshal(ed.doc, {}); err == nil do append(&ed.undo, string(cur))
	snap := pop(&ed.redo)
	restore_snap(snap)
	delete(snap)
}

ensure_defaults :: proc() {
	if len(ed.doc.parts) == 0 {
		p: fart.Part
		p.name = strings.clone("body")
		append(&ed.doc.parts, p)
	}
	if len(ed.doc.palette) == 0 {
		append(&ed.doc.palette, fart.Tok{name = strings.clone("ink"), rgb = {200, 195, 185, 255}})
	}
}

// Saving is two different acts now. The file on disk always mirrors the
// current experiment (written a beat after every change, so the game's hot
// reload shows it live). The Save button is the checkpoint: leaving the file
// any way but Save rolls the disk back to the last checkpoint.

write_disk :: proc() -> bool {
	for &p in ed.doc.parts do for &sh in p.shapes do if sh.kind == "poly" {
		fart.triangulate(sh.points[:], &sh.tris)
	}
	for &sh in ed.doc.collision do if sh.kind == "poly" {
		fart.triangulate(sh.points[:], &sh.tris)
	}
	ed.doc.version = 1
	res := ed.doc.resolved
	ed.doc.resolved = nil // never serialize the resolution cache
	data, err := json.marshal(ed.doc, {pretty = true})
	ed.doc.resolved = res
	if err != nil do return false
	defer delete(data)
	return plat_write(ed.path, data)
}

doc_snapshot :: proc() -> (string, bool) {
	res := ed.doc.resolved
	ed.doc.resolved = nil // the resolution cache is not the document
	data, err := json.marshal(ed.doc, {})
	ed.doc.resolved = res
	return string(data), err == nil
}

// The checkpoint also lives beside the file as <name>.fart~ -- so a crash
// or force-quit (which skips the revert) can never orphan the last good
// state. Browse ignores it; it is overwritten at every open and save.
backup_write :: proc() {
	if ed.path == "" || len(ed.base) == 0 do return
	_ = plat_write(fmt.tprintf("%s~", ed.path), transmute([]byte)ed.base)
}

save :: proc() {
	if !write_disk() do return
	ed.dirty = false
	if snap, ok := doc_snapshot(); ok {
		delete(ed.base)
		delete(ed.last_flush)
		ed.base = snap
		ed.last_flush = strings.clone(snap)
		backup_write()
	}
}

// The live scratch: a beat after the last change, mirror the doc to disk.
flush_scratch :: proc() {
	ed.flush_t += rl.GetFrameTime()
	if ed.flush_t < 0.35 do return
	ed.flush_t = 0
	snap, ok := doc_snapshot()
	if !ok do return
	if snap == ed.last_flush {
		delete(snap)
		return
	}
	delete(ed.last_flush)
	ed.last_flush = snap
	write_disk()
	ed.dirty = snap != ed.base
}

// Leaving without Save: put the file back the way the last checkpoint left it.
leave_revert :: proc() {
	if ed.path == "" do return
	if snap, ok := doc_snapshot(); ok {
		same := snap == ed.base
		delete(snap)
		if same do return
	}
	if doc, ok := fart.load_bytes(transmute([]byte)ed.base); ok {
		fart.destroy(&ed.doc)
		ed.doc = doc
		write_disk()
	} else if len(ed.base) > 0 {
		// the checkpoint would not parse (should never happen): write its
		// bytes back verbatim rather than leave the experiment on disk
		_ = plat_write(ed.path, transmute([]byte)ed.base)
	}
	ed.dirty = false
}

browse_refresh :: proc() {
	for &d, k in ed.thumbs do if ed.thumb_ok[k] do fart.destroy(&d)
	clear(&ed.thumbs)
	clear(&ed.thumb_ok)
	for f in ed.found do delete(f)
	clear(&ed.found)
	plat_list(&ed.found)
	for path in ed.found {
		doc: fart.Doc
		ok := false
		if data, rok := plat_read(path); rok do doc, ok = fart.load_bytes(data)
		if ok do resolve_for(&doc, path)
		append(&ed.thumbs, doc)
		append(&ed.thumb_ok, ok)
	}
}

open_file :: proc(path: string) {
	if ed.mode == .Edit do leave_revert()
	if ed.path != "" do delete(ed.path)
	fart.destroy(&ed.doc)
	ed.doc = {}
	ed.path = strings.clone(path)
	if data, rok := plat_read(ed.path); rok {
		if doc, ok := fart.load_bytes(data); ok do ed.doc = doc
	}
	ensure_defaults()
	resolve_for(&ed.doc, ed.path)
	for u in ed.undo do delete(u)
	clear(&ed.undo)
	for r in ed.redo do delete(r)
	clear(&ed.redo)
	delete(ed.base)
	delete(ed.last_flush)
	ed.base, ed.last_flush = "", ""
	if snap, ok := doc_snapshot(); ok {
		ed.base = snap
		ed.last_flush = strings.clone(snap)
		backup_write()
	}
	ed.flush_t = 0
	ed.cur_part, ed.cur_tok, ed.cur_state = 0, 0, -1
	sel_clear()
	ed.pending = .None
	ed.dirty = false
	ed.mode = .Edit
}

// ------------------------------------------------------------- ui kit

// Neutral graphite; the amber speaks only when something is chosen or armed.
UI_BG :: rl.Color{18, 18, 19, 255}
UI_PANEL :: rl.Color{29, 29, 31, 255}
UI_INSET :: rl.Color{13, 13, 14, 255}
UI_EDGE :: rl.Color{255, 255, 255, 14}
UI_BTN :: rl.Color{45, 45, 48, 255}
UI_BTN_HOV :: rl.Color{60, 60, 64, 255}
UI_ACCENT :: rl.Color{255, 200, 92, 255}
UI_ACCENT_DIM :: rl.Color{255, 200, 92, 30}
UI_TEXT :: rl.Color{222, 222, 219, 255}
UI_DIM :: rl.Color{141, 141, 139, 255}
UI_FAINT :: rl.Color{99, 99, 97, 255}
UI_DANGER :: rl.Color{228, 118, 100, 255}

FS_SMALL :: 11
FS_BODY :: 13
FS_BIG :: 18

TB_H :: 48
PANEL_L :: 232
PANEL_R :: 240
PAD :: 12
ROW_H :: 26

// A real face, crisp on retina: atlases baked at DPI scale, drawn at point size.
Fonts :: struct {
	small, body, big: rl.Font,
	loaded:           bool,
}
fonts: Fonts

// JetBrains Mono rides in the binary (OFL licensed) so the web build has a
// face; native prefers the system fonts it always used, falling back to it.
FONT_TTF := #load("assets/font.ttf")

fonts_init :: proc() {
	if fonts.loaded {
		rl.UnloadFont(fonts.small)
		rl.UnloadFont(fonts.body)
		rl.UnloadFont(fonts.big)
	}
	path := plat_font_path()
	dpi := max(rl.GetWindowScaleDPI().y, g_ui_scale)
	if dpi < 1 do dpi = 1
	load :: proc(path: cstring, pt: f32, dpi: f32) -> rl.Font {
		f: rl.Font
		if path != nil do f = rl.LoadFontEx(path, i32(pt * dpi + 0.5), nil, 0)
		else do f = rl.LoadFontFromMemory(".ttf", raw_data(FONT_TTF), i32(len(FONT_TTF)), i32(pt * dpi + 0.5), nil, 0)
		rl.SetTextureFilter(f.texture, .BILINEAR)
		return f
	}
	fonts.small = load(path, FS_SMALL, dpi)
	fonts.body = load(path, FS_BODY, dpi)
	fonts.big = load(path, FS_BIG, dpi)
	fonts.loaded = true
}

pick_font :: proc(fs: f32) -> rl.Font {
	if !fonts.loaded do return rl.GetFontDefault()
	if fs <= FS_SMALL do return fonts.small
	if fs <= FS_BODY do return fonts.body
	return fonts.big
}

txt :: proc(s: cstring, x, y: f32, fs: f32, col: rl.Color, track: f32 = 0) {
	rl.DrawTextEx(pick_font(fs), s, {x, y}, fs, track, col)
}

txt_w :: proc(s: cstring, fs: f32, track: f32 = 0) -> f32 {
	return rl.MeasureTextEx(pick_font(fs), s, fs, track).x
}

header :: proc(s: cstring, x, y: f32) {
	txt(s, x, y, FS_SMALL, UI_FAINT, 1.6)
}

hairline :: proc(x, y, w: f32) {
	rl.DrawRectangleRec({x, y, w, 1}, UI_EDGE)
}

// A widget hover: under the pointer, and not hidden under the toolbar by
// a scrolled panel (g_ui_min_y is the clip line while panels draw).
ui_hov :: proc(r: rl.Rectangle) -> bool {
	return rl.CheckCollisionPointRec(g_mouse, r) && g_mouse.y >= g_ui_min_y
}

ui_button :: proc(r: rl.Rectangle, label: cstring, active := false, ghost := false, danger := false) -> bool {
	hov := ui_hov(r)
	if active {
		rl.DrawRectangleRounded(r, 0.3, 5, UI_ACCENT_DIM)
		rl.DrawRectangleRoundedLinesEx(r, 0.3, 5, 1, {255, 200, 92, 150})
	} else if ghost {
		if hov do rl.DrawRectangleRounded(r, 0.3, 5, {255, 255, 255, 10})
		rl.DrawRectangleRoundedLinesEx(r, 0.3, 5, 1, {255, 255, 255, hov ? 60 : 26})
	} else {
		rl.DrawRectangleRounded(r, 0.3, 5, hov ? UI_BTN_HOV : UI_BTN)
	}
	col := active ? UI_ACCENT : danger ? UI_DANGER : ghost && !hov ? UI_DIM : UI_TEXT
	txt(label, r.x + (r.width - txt_w(label, FS_BODY)) / 2, r.y + (r.height - FS_BODY) / 2 - 1, FS_BODY, col)
	return hov && g_tap
}

// A toolbar tool: label at left, its key a quiet chip at right.
ui_tool :: proc(r: rl.Rectangle, label: cstring, key: cstring, active: bool) -> bool {
	hov := ui_hov(r)
	if active {
		rl.DrawRectangleRounded(r, 0.3, 5, UI_ACCENT_DIM)
		rl.DrawRectangleRoundedLinesEx(r, 0.3, 5, 1, {255, 200, 92, 150})
	} else if hov {
		rl.DrawRectangleRounded(r, 0.3, 5, UI_BTN_HOV)
	}
	txt(label, r.x + 10, r.y + (r.height - FS_BODY) / 2 - 1, FS_BODY, active ? UI_ACCENT : UI_TEXT)
	txt(key, r.x + r.width - 8 - txt_w(key, FS_SMALL), r.y + (r.height - FS_SMALL) / 2, FS_SMALL, active ? rl.Color{255, 200, 92, 140} : UI_FAINT)
	return hov && g_tap
}

ui_row :: proc(r: rl.Rectangle, label: cstring, active: bool, dim := false) -> bool {
	hov := ui_hov(r)
	if active do rl.DrawRectangleRounded(r, 0.25, 4, UI_ACCENT_DIM)
	else if hov do rl.DrawRectangleRounded(r, 0.25, 4, {255, 255, 255, 8})
	txt(label, r.x + 9, r.y + (r.height - FS_BODY) / 2 - 1, FS_BODY, active ? UI_ACCENT : dim ? UI_DIM : UI_TEXT)
	return hov && g_tap
}

ui_slider :: proc(r: rl.Rectangle, v: ^f32, lo, hi: f32, id: int) -> bool {
	hov := ui_hov(r)
	if hov && g_down && ed.slider_id == 0 do ed.slider_id = id
	changed := false
	if ed.slider_id == id {
		if g_down {
			t := clamp((g_mouse.x - r.x) / r.width, 0, 1)
			nv := lo + t * (hi - lo)
			if nv != v^ {
				v^ = nv
				changed = true
			}
		} else do ed.slider_id = 0
	}
	cy := r.y + r.height / 2
	rl.DrawRectangleRounded({r.x, cy - 2, r.width, 4}, 1, 4, UI_INSET)
	t := (v^ - lo) / (hi - lo)
	rl.DrawRectangleRounded({r.x, cy - 2, max(r.width * t, 4), 4}, 1, 4, {255, 200, 92, 90})
	rl.DrawCircleV({r.x + r.width * t, cy}, 6, hov || ed.slider_id == id ? UI_ACCENT : rl.Color{200, 160, 80, 255})
	return changed
}

ui_check :: proc(r: rl.Rectangle, on: bool) -> bool {
	hov := ui_hov(r)
	rl.DrawRectangleRounded(r, 0.3, 3, UI_INSET)
	rl.DrawRectangleRoundedLinesEx(r, 0.3, 3, 1, {255, 255, 255, hov ? 60 : 26})
	if on do rl.DrawRectangleRounded({r.x + 4, r.y + 4, r.width - 8, r.height - 8}, 0.4, 3, UI_ACCENT)
	return hov && g_tap
}

// ------------------------------------------------------------- picking

dist_seg :: proc(p, a, b: V2) -> f32 {
	ab := V2{b.x - a.x, b.y - a.y}
	l2 := ab.x * ab.x + ab.y * ab.y
	t := l2 > 0 ? clamp(((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2, 0, 1) : 0
	q := V2{a.x + ab.x * t, a.y + ab.y * t}
	return math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y))
}

vlen :: proc(a, b: V2) -> f32 {
	return math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))
}

shape_dist :: proc(sh: ^fart.Shape, at: V2) -> f32 {
	d := f32(1e9)
	switch sh.kind {
	case "circle":
		dd := vlen(sh.at, at)
		d = dd < sh.r ? 0 : dd - sh.r
	case "line":
		d = max(dist_seg(at, sh.a, sh.b) - sh.w * 0.5, 0)
	case "poly":
		for q, qi in sh.points {
			d = min(d, dist_seg(at, q, sh.points[(qi + 1) % len(sh.points)]))
		}
		// inside test (crossing)
		crossings := 0
		n := len(sh.points)
		for q, qi in sh.points {
			r_ := sh.points[(qi + 1) % n]
			if (q.y > at.y) != (r_.y > at.y) {
				xx := q.x + (at.y - q.y) / (r_.y - q.y) * (r_.x - q.x)
				if xx > at.x do crossings += 1
			}
		}
		if crossings % 2 == 1 do d = 0
	}
	return d
}

pick :: proc(at: V2, only_visible: bool) -> (pi, si: int) {
	pi, si = -1, -1
	best := 10 / ed.zoom + 2
	vis := visible_parts()
	for pk in vis {
		p := &ed.doc.parts[pk]
		for &sh, sk in p.shapes {
			d := shape_dist(&sh, at)
			// ties go to the later shape: it draws on top, it is what you see
			if d <= best {
				best = d
				pi, si = pk, sk
			}
		}
	}
	return
}

visible_parts :: proc() -> [dynamic]int {
	out := make([dynamic]int, context.temp_allocator)
	if ed.cur_state >= 0 && ed.cur_state < len(ed.doc.states) {
		st := &ed.doc.states[ed.cur_state]
		for sp in st.parts {
			for &p, k in ed.doc.parts do if p.name == sp.part do append(&out, k)
		}
	} else {
		for k in 0 ..< len(ed.doc.parts) do append(&out, k)
	}
	return out
}

shape_move :: proc(sh: ^fart.Shape, d: V2) {
	sh.at += d
	sh.a += d
	sh.b += d
	for &q in sh.points do q += d
}

// handles of the selected shape: world positions, 1-based ids.
// Only a lone selection gets handles; a crowd only moves together.
sel_handles :: proc(out: ^[dynamic]V2) {
	clear(out)
	if len(ed.sel_set) != 1 do return
	sh := sel()
	if sh == nil do return
	switch sh.kind {
	case "circle":
		append(out, sh.at + {sh.r, 0})
	case "line":
		append(out, sh.a)
		append(out, sh.b)
	case "poly":
		for q in sh.points do append(out, q)
	}
}

// ------------------------------------------------------------- drawing

draw_shape_world :: proc(doc: ^fart.Doc, sh: ^fart.Shape, outline: rl.Color) {
	c := col_of(doc, sh.color)
	switch sh.kind {
	case "circle":
		rl.DrawCircleV(to_screen(sh.at), sh.r * ed.zoom, c)
		if outline.a > 0 do rl.DrawCircleLinesV(to_screen(sh.at), sh.r * ed.zoom + 1, outline)
	case "line":
		a, b := to_screen(sh.a), to_screen(sh.b)
		w_ := sh.w * ed.zoom
		rl.DrawLineEx(a, b, w_, c)
		rl.DrawCircleV(a, w_ * 0.5, c)
		rl.DrawCircleV(b, w_ * 0.5, c)
		if outline.a > 0 do rl.DrawLineEx(a, b, max(w_ * 0.2, 1.5), outline)
	case "poly":
		n := len(sh.points)
		if n < 3 do return
		tri := make([dynamic]u16, context.temp_allocator)
		fart.triangulate(sh.points[:], &tri)
		k := 0
		for k + 2 < len(tri) {
			a := to_screen(sh.points[tri[k]])
			b := to_screen(sh.points[tri[k + 1]])
			cc := to_screen(sh.points[tri[k + 2]])
			rl.DrawTriangle(a, b, cc, c)
			rl.DrawTriangle(a, cc, b, c)
			k += 3
		}
		if outline.a > 0 {
			for q, qi in sh.points {
				rl.DrawLineV(to_screen(q), to_screen(sh.points[(qi + 1) % n]), outline)
			}
		}
	}
}

doc_bounds :: proc(doc: ^fart.Doc) -> (lo, hi: V2) {
	lo, hi = {1e9, 1e9}, {-1e9, -1e9}
	take :: proc(p: V2, lo, hi: ^V2) {
		lo.x = min(lo.x, p.x)
		lo.y = min(lo.y, p.y)
		hi.x = max(hi.x, p.x)
		hi.y = max(hi.y, p.y)
	}
	for &part in doc.parts do for &sh in part.shapes {
		switch sh.kind {
		case "circle":
			take(sh.at - {sh.r, sh.r}, &lo, &hi)
			take(sh.at + {sh.r, sh.r}, &lo, &hi)
		case "line":
			// the stroke bulges half its width past the endpoints (caps too)
			hw := sh.w * 0.5
			take(sh.a - {hw, hw}, &lo, &hi)
			take(sh.a + {hw, hw}, &lo, &hi)
			take(sh.b - {hw, hw}, &lo, &hi)
			take(sh.b + {hw, hw}, &lo, &hi)
		case "poly":
			for q in sh.points do take(q, &lo, &hi)
		}
	}
	if lo.x > hi.x do lo, hi = {-5, -5}, {5, 5}
	return
}

draw_doc_thumb :: proc(doc: ^fart.Doc, r: rl.Rectangle) {
	lo, hi := doc_bounds(doc)
	w_, h_ := max(hi.x - lo.x, 0.001), max(hi.y - lo.y, 0.001)
	s := min((r.width - 16) / w_, (r.height - 16) / h_)
	mid := V2{(lo.x + hi.x) / 2, (lo.y + hi.y) / 2}
	cx, cy := r.x + r.width / 2, r.y + r.height / 2
	tp :: proc(p: V2, mid: V2, s, cx, cy: f32) -> rl.Vector2 {
		return {(p.x - mid.x) * s + cx, (p.y - mid.y) * s + cy}
	}
	// with states, the first one is the face the thumbnail wears --
	// all-parts overlays lit-and-out, item-and-prop at once
	shown :: proc(doc: ^fart.Doc, name: string) -> bool {
		if len(doc.states) == 0 do return true
		for sp in doc.states[0].parts do if sp.part == name do return true
		return false
	}
	for &part in doc.parts do for &sh in part.shapes {
		if !shown(doc, part.name) do continue
		c := col_of(doc, sh.color)
		switch sh.kind {
		case "circle":
			rl.DrawCircleV(tp(sh.at, mid, s, cx, cy), sh.r * s, c)
		case "line":
			la := tp(sh.a, mid, s, cx, cy)
			lb := tp(sh.b, mid, s, cx, cy)
			lw := max(sh.w * s, 1)
			rl.DrawLineEx(la, lb, lw, c)
			// round caps, like the canvas and the game draw them
			rl.DrawCircleV(la, lw * 0.5, c)
			rl.DrawCircleV(lb, lw * 0.5, c)
		case "poly":
			n := len(sh.points)
			if n < 3 do continue
			tri := make([dynamic]u16, context.temp_allocator)
			fart.triangulate(sh.points[:], &tri)
			k := 0
			for k + 2 < len(tri) {
				a := tp(sh.points[tri[k]], mid, s, cx, cy)
				b := tp(sh.points[tri[k + 1]], mid, s, cx, cy)
				cc := tp(sh.points[tri[k + 2]], mid, s, cx, cy)
				rl.DrawTriangle(a, b, cc, c)
				rl.DrawTriangle(a, cc, b, c)
				k += 3
			}
		}
	}
	total := 0
	for &part in doc.parts do total += len(part.shapes)
	if total == 0 {
		if len(doc.parts) > 0 {
			// a rig awaiting art: name the parts it wants drawn
			y := r.y + 12
			txt("awaiting art:", r.x + 10, y, FS_SMALL, UI_FAINT)
			y += 17
			for p in doc.parts {
				if y > r.y + r.height - 14 do break
				txt(fmt.ctprintf("%s", p.name), r.x + 18, y, FS_SMALL, UI_DIM)
				y += 15
			}
		} else {
			// a palette: its tokens are the picture
			x := r.x + 10
			y := r.y + r.height / 2 - 9
			for tk in doc.palette {
				if x + 20 > r.x + r.width - 8 do break
				rl.DrawRectangleRounded({x, y, 18, 18}, 0.3, 3, {tk.rgb[0], tk.rgb[1], tk.rgb[2], tk.rgb[3]})
				x += 22
			}
		}
	}
}

// ------------------------------------------------------------- prompts

start_prompt :: proc(what: string, prefill := "") {
	ed.prompt_on = true
	ed.prompt_what = what
	strings.builder_reset(&ed.prompt)
	strings.write_string(&ed.prompt, prefill)
}

commit_prompt :: proc() {
	name := strings.clone(strings.to_string(ed.prompt))
	ed.prompt_on = false
	if len(name) == 0 do return
	switch ed.prompt_what {
	case "token":
		push_undo()
		append(&ed.doc.palette, fart.Tok{name = name, rgb = {180, 180, 180, 255}})
		ed.cur_tok = len(ed.doc.palette) - 1
	case "part":
		push_undo()
		p: fart.Part
		p.name = name
		append(&ed.doc.parts, p)
		ed.cur_part = len(ed.doc.parts) - 1
	case "state":
		push_undo()
		st: fart.State
		st.name = name
		// identity pose: the offset is where the pivot lands
		for part in ed.doc.parts do append(&st.parts, fart.State_Part{part = strings.clone(part.name), offset = part.pivot})
		append(&ed.doc.states, st)
		ed.cur_state = len(ed.doc.states) - 1
	case "anchor":
		push_undo()
		if p := cur_part(); p != nil {
			append(&p.anchors, fart.Anchor{name = name, at = ed.anchor_at})
		}
	case "file":
		path := strings.has_suffix(name, ".fart") ? name : fmt.aprintf("%s.fart", name)
		open_file(path)
		save()
	case "rename part":
		if ed.rename_idx >= 0 && ed.rename_idx < len(ed.doc.parts) {
			push_undo()
			p := &ed.doc.parts[ed.rename_idx]
			for &st in ed.doc.states do for &sp in st.parts {
				if sp.part == p.name do sp.part = strings.clone(name)
			}
			p.name = name
		}
	case "rename state":
		if ed.rename_idx >= 0 && ed.rename_idx < len(ed.doc.states) {
			push_undo()
			ed.doc.states[ed.rename_idx].name = name
		}
	case "rename token":
		if ed.rename_idx >= 0 && ed.rename_idx < len(ed.doc.palette) {
			push_undo()
			tk := &ed.doc.palette[ed.rename_idx]
			for &part in ed.doc.parts do for &sh in part.shapes {
				if sh.color == tk.name do sh.color = strings.clone(name)
			}
			tk.name = name
		}
	}
}

// ------------------------------------------------------------- main

g_handles: [dynamic]V2

// Init / frame / shutdown, so both the native loop and the browser's
// animation frames can drive the same editor.
ed_init :: proc() {
	ed.zoom = 10
	ed.cur_state = -1
	ed.sel_part, ed.sel_shape = -1, -1
	strings.builder_init(&ed.prompt)

	flags: rl.ConfigFlags = {.WINDOW_RESIZABLE, .VSYNC_HINT, .MSAA_4X_HINT}
	when !WEB do flags += {.WINDOW_HIGHDPI} // misaligns input on web
	rl.SetConfigFlags(flags)
	rl.InitWindow(1360, 860, "fastart")
	rl.SetTargetFPS(120)
	rl.SetExitKey(.KEY_NULL)
	plat_window_fit()
	fonts_init()

	args := plat_args()
	when !WEB {
		if len(args) >= 1 && args[0] == "--serve" {
			serve_start()
			args = args[1:]
		}
	}
	if len(args) >= 2 && args[0] == "--qr" {
		qr_selftest(args[1])
		args = args[2:]
	}
	if len(args) >= 2 && args[0] == "--shot" {
		g_shot = args[1]
		args = args[2:]
	}
	if len(args) >= 1 {
		open_file(args[0])
	} else {
		ed.mode = .Browse
		browse_refresh()
	}
}

web_resize :: proc(w, h: int, dpr: f32) {
	d := max(dpr, 1)
	rl.SetWindowSize(i32(f32(w) * d), i32(f32(h) * d))
	if d != g_ui_scale {
		g_ui_scale = d
		fonts_init() // rebake the atlases now that the density is known
	}
}

scale_begin :: proc() {
	if g_ui_scale != 1 do rlgl.Scalef(g_ui_scale, g_ui_scale, 1)
}

scissor_begin :: proc(x, y, w, h: f32) {
	s := g_ui_scale
	rl.BeginScissorMode(i32(x * s), i32(y * s), i32(w * s), i32(h * s))
}

ed_shutdown :: proc() {
	if ed.mode == .Edit do leave_revert() // quitting is leaving too
	rl.CloseWindow()
}

ed_frame :: proc() -> bool {
	when !WEB {
		if rl.WindowShouldClose() do return false
	}
	if true { // the old main loop's body, indentation kept
		g_mouse = rl.GetMousePosition() / g_ui_scale
		g_click = rl.IsMouseButtonPressed(.LEFT)
		g_down = rl.IsMouseButtonDown(.LEFT)
		g_released = rl.IsMouseButtonReleased(.LEFT)
		if g_click do g_press = g_mouse
		tdx, tdy := g_mouse.x - g_press.x, g_mouse.y - g_press.y
		g_tap = g_released && tdx * tdx + tdy * tdy < 81
		// two fingers pan and pinch (the iPad); they never draw
		if tc := rl.GetTouchPointCount(); tc >= 2 {
			a := rl.GetTouchPosition(0) / g_ui_scale
			b := rl.GetTouchPosition(1) / g_ui_scale
			mid := rl.Vector2{(a.x + b.x) / 2, (a.y + b.y) / 2}
			dx, dy := a.x - b.x, a.y - b.y
			d := math.sqrt(dx * dx + dy * dy)
			if ed.touch2 && d > 1 && ed.tdist > 1 && ed.mode == .Edit {
				ed.pan -= {(mid.x - ed.tmid.x) / ed.zoom, (mid.y - ed.tmid.y) / ed.zoom}
				ed.zoom = clamp(ed.zoom * (d / ed.tdist), 0.5, 120)
			}
			ed.touch2 = true
			ed.tmid, ed.tdist = mid, d
			g_click, g_down, g_released = false, false, false
			ed.dragging = false
			ed.drawing = false
			ed.marquee = false
		} else do ed.touch2 = false
		cmd := rl.IsKeyDown(.LEFT_SUPER) || rl.IsKeyDown(.RIGHT_SUPER) || rl.IsKeyDown(.LEFT_CONTROL)
		W, H := scr()

		// ------------------------------------------------ browse mode
		if ed.mode == .Browse {
			rl.BeginDrawing()
			scale_begin()
			rl.ClearBackground(UI_BG)
			rl.DrawRectangleRec({0, 0, W, TB_H}, UI_PANEL)
			hairline(0, TB_H - 1, W)
			txt("fastart", 16, (TB_H - FS_BIG) / 2 - 1, FS_BIG, UI_ACCENT)
			sub := fmt.ctprintf("%d file%s under this directory", len(ed.found), len(ed.found) == 1 ? "" : "s")
			txt(sub, 16 + txt_w("fastart", FS_BIG) + 16, (TB_H - FS_BODY) / 2, FS_BODY, UI_DIM)
			if ui_button({W - 104, (TB_H - 28) / 2, 92, 28}, "new file", ghost = true) do start_prompt("file")
			when !WEB {
				// hand the editor to another screen (the iPad workflow)
				if g_srv.on {
					su := fmt.ctprintf("%s", g_srv.url)
					txt(su, W - 116 - txt_w(su, FS_BODY), (TB_H - FS_BODY) / 2, FS_BODY, UI_ACCENT)
				} else if !g_srv.failed {
					if ui_button({W - 196, (TB_H - 28) / 2, 80, 28}, "Serve", ghost = true) do serve_start()
				}
			}
			// a drag scrolls the shelf; only a tap (short, unmoved) opens
			if g_click && g_mouse.y > TB_H && !ed.prompt_on {
				ed.bdrag = true
				ed.bmoved = false
				ed.bstart = g_mouse
				ed.blast = g_mouse
			}
			if g_down && ed.bdrag {
				ed.scroll -= g_mouse.y - ed.blast.y
				ed.blast = g_mouse
				ddx := g_mouse.x - ed.bstart.x
				ddy := g_mouse.y - ed.bstart.y
				if ddx * ddx + ddy * ddy > 64 do ed.bmoved = true
			}
			cw, chh := f32(200), f32(170)
			perrow := max(int((W - 16) / (cw + 12)), 1)
			nrows := (len(ed.found) + perrow - 1) / perrow
			maxs := max(f32(nrows) * (chh + 12) + 22 - (H - TB_H), 0)
			ed.scroll = clamp(ed.scroll - rl.GetMouseWheelMove() * 60, 0, maxs)
			scissor_begin(0, TB_H, W, H - TB_H)
			for path, k in ed.found {
				col := k % perrow
				row := k / perrow
				r := rl.Rectangle{16 + f32(col) * (cw + 12), TB_H + 14 + f32(row) * (chh + 12) - ed.scroll, cw, chh}
				if r.y > H || r.y + r.height < TB_H do continue
				hov := rl.CheckCollisionPointRec(g_mouse, r) && g_mouse.y > TB_H
				rl.DrawRectangleRounded(r, 0.06, 4, hov ? rl.Color{36, 36, 39, 255} : UI_PANEL)
				rl.DrawRectangleRoundedLinesEx(r, 0.06, 4, 1, hov ? rl.Color{255, 200, 92, 90} : UI_EDGE)
				if ed.thumb_ok[k] {
					// clip to the card (and never above the gallery itself)
					ty := max(r.y, TB_H)
					scissor_begin(r.x, ty, r.width, max(r.y + r.height - 36 - ty, 0))
					draw_doc_thumb(&ed.thumbs[k], {r.x, r.y, r.width, r.height - 36})
					scissor_begin(0, TB_H, W, H - TB_H) // back to the shelf's clip
				}
				name, dir := path, ""
				for i := len(path) - 1; i >= 0; i -= 1 do if path[i] == '/' {
					name = path[i + 1:]
					dir = path[:i + 1]
					break
				}
				if strings.has_suffix(name, ".fart") do name = name[:len(name) - 5]
				txt(fmt.ctprintf("%s", name), r.x + 10, r.y + r.height - 34, FS_BODY, hov ? UI_ACCENT : UI_TEXT)
				if dir != "" do txt(fmt.ctprintf("%s", dir), r.x + 10, r.y + r.height - 17, FS_SMALL, UI_FAINT)
				if hov && g_released && ed.bdrag && !ed.bmoved do open_file(path)
			}
			if g_released do ed.bdrag = false
			rl.EndScissorMode()
			if maxs > 0 {
				vh := H - TB_H
				th := max(vh * vh / (vh + maxs), 30)
				ty := TB_H + (vh - th) * (ed.scroll / maxs)
				rl.DrawRectangleRounded({W - 7, ty, 4, th}, 1, 3, {255, 255, 255, 45})
			}
			when !WEB {
				if g_srv.on && g_srv.qr_ok {
					qx := W - f32(g_srv.qr.width) - 16
					qy := H - f32(g_srv.qr.height) - 40
					rl.DrawTexture(g_srv.qr, i32(qx), i32(qy), rl.WHITE)
					hint: cstring = "scan to open the editor on a tablet"
					txt(hint, qx + (f32(g_srv.qr.width) - txt_w(hint, FS_SMALL)) / 2, qy + f32(g_srv.qr.height) + 8, FS_SMALL, UI_DIM)
				}
			}
			// prompt modal
			if ed.prompt_on {
				prompt_frame(W, H)
			}
			rl.EndDrawing()
			free_all(context.temp_allocator)
			if shot_tick() do return false
			return true
		}

		// ------------------------------------------------ edit mode
		LEFT := f32(PANEL_L)
		RIGHT := f32(PANEL_R)
		TOP := f32(TB_H)
		canvas := rl.Rectangle{LEFT, TOP, W - LEFT - RIGHT, H - TOP}
		in_canvas := rl.CheckCollisionPointRec(g_mouse, canvas) && !ed.prompt_on && !ed.add_open
		add_r: rl.Rectangle

		// keyboard accelerators
		if !ed.prompt_on {
			if rl.IsKeyPressed(.ONE) do ed.tool = .Select
			if rl.IsKeyPressed(.TWO) do ed.tool = .Circle
			if rl.IsKeyPressed(.THREE) do ed.tool = .Line
			if rl.IsKeyPressed(.FOUR) do ed.tool = .Poly
			if rl.IsKeyPressed(.FIVE) do ed.tool = .Rect
			if rl.IsKeyPressed(.ONE) || rl.IsKeyPressed(.TWO) || rl.IsKeyPressed(.THREE) ||
			   rl.IsKeyPressed(.FOUR) || rl.IsKeyPressed(.FIVE) {
				ed.add_open = false
			}
			if cmd && rl.IsKeyPressed(.S) do save()
			if cmd && rl.IsKeyPressed(.Z) {
				if rl.IsKeyDown(.LEFT_SHIFT) || rl.IsKeyDown(.RIGHT_SHIFT) do do_redo()
				else do do_undo()
			}
			if cmd && rl.IsKeyPressed(.Y) do do_redo()
			if cmd && rl.IsKeyPressed(.O) {
				leave_revert()
				ed.mode = .Browse
				browse_refresh()
				return true
			}
			if !cmd && (rl.IsKeyPressed(.X) || rl.IsKeyPressed(.DELETE) || rl.IsKeyPressed(.BACKSPACE)) {
				if ed.collide do col_delete()
				else do sel_delete()
			}
			if !cmd && rl.IsKeyPressed(.C) {
				ed.collide = !ed.collide
				ed.col_sel = -1
			}
			if cmd && rl.IsKeyPressed(.C) do copy_sel()
			if cmd && rl.IsKeyPressed(.V) do paste_clip()
			if cmd && rl.IsKeyPressed(.X) {
				copy_sel()
				sel_delete()
			}
			if cmd && rl.IsKeyPressed(.D) do dup_sel()
			if rl.IsKeyPressed(.LEFT_BRACKET) do sel_lower()
			if rl.IsKeyPressed(.RIGHT_BRACKET) do sel_raise()
			if rl.IsKeyPressed(.ESCAPE) {
				sel_clear()
				ed.col_sel = -1
				clear(&ed.poly_pts)
				ed.drawing = false
				ed.marquee = false
				ed.pending = .None
				ed.add_open = false
			}
		} else {
			for {
				ch := rl.GetCharPressed()
				if ch <= 0 do break
				if ch >= 32 && ch < 127 do strings.write_rune(&ed.prompt, ch)
			}
			if rl.IsKeyPressed(.BACKSPACE) {
				str := strings.to_string(ed.prompt)
				if len(str) > 0 {
					strings.builder_reset(&ed.prompt)
					strings.write_string(&ed.prompt, str[:len(str) - 1])
				}
			}
			if rl.IsKeyPressed(.ENTER) do commit_prompt()
			if rl.IsKeyPressed(.ESCAPE) do ed.prompt_on = false
		}

		// canvas interaction
		if in_canvas {
			if rl.IsMouseButtonDown(.RIGHT) {
				d := rl.GetMouseDelta()
				ed.pan -= {d.x / ed.zoom, d.y / ed.zoom}
			}
			if wl := rl.GetMouseWheelMove(); wl != 0 {
				ed.zoom = clamp(ed.zoom * (1 + wl * 0.1), 0.5, 120)
			}
			wm := to_world(g_mouse)
			if state_cur() == nil && !ed.collide do ed.hov_part, ed.hov_shape = pick(wm, true)
			else do ed.hov_part, ed.hov_shape = -1, -1

			if ed.pending != .None && g_click {
				if p := cur_part(); p != nil {
					if ed.pending == .Pivot {
						push_undo()
						p.pivot = wm
						ed.pending = .None
					} else {
						ed.anchor_at = wm
						ed.pending = .None
						start_prompt("anchor")
					}
				}
			} else if ed.collide {
				// the collision lens edits doc.collision with the same tools
				collide_interact(wm)
			} else if st := state_cur(); st != nil {
				// pose mode: the state is what you sculpt, not the geometry
				pose_interact(st, wm)
			} else {
				switch ed.tool {
				case .Select:
					shift := rl.IsKeyDown(.LEFT_SHIFT) || rl.IsKeyDown(.RIGHT_SHIFT)
					sel_handles(&g_handles)
					if g_click {
						ed.handle = 0
						// a handle first
						for hp, hk in g_handles {
							if vlen(hp, wm) * ed.zoom < 8 {
								ed.handle = hk + 1
								push_undo()
								break
							}
						}
						// then a corner of the selection's box: scaling
						if ed.handle == 0 && len(ed.sel_set) > 0 {
							if lo, hi, bok := sel_bounds(); bok {
								pad := 6 / ed.zoom
								corners := [4]V2 {
									{lo.x - pad, lo.y - pad}, {hi.x + pad, lo.y - pad},
									{hi.x + pad, hi.y + pad}, {lo.x - pad, hi.y + pad},
								}
								anchors := [4]V2{hi, {lo.x, hi.y}, lo, {hi.x, lo.y}}
								for c, ci in corners do if vlen(c, wm) * ed.zoom < 9 {
									push_undo()
									ed.scaling = true
									ed.scale_anchor = anchors[ci]
									ed.scale_d = max(vlen(ed.scale_anchor, wm), 0.001)
									break
								}
							}
						}
						if ed.handle == 0 && !ed.scaling {
							pi, si := pick(wm, true)
							if pi >= 0 {
								if shift {
									sel_toggle(pi, si)
								} else {
									if !sel_has(pi, si) do sel_only(pi, si)
									else do ed.sel_part, ed.sel_shape = pi, si
									ed.dragging = true
									ed.drag_pushed = false
									ed.drag_off = wm
								}
							} else {
								// empty ground: a rubber band (plain click clears)
								ed.marquee = true
								ed.mq_a = wm
								if !shift do sel_clear()
							}
						}
					}
					if g_down && ed.handle > 0 {
						if sh := sel(); sh != nil {
							switch sh.kind {
							case "circle":
								sh.r = max(vlen(sh.at, wm), 0.2)
							case "line":
								if ed.handle == 1 do sh.a = wm
								else do sh.b = wm
							case "poly":
								if i := ed.handle - 1; i < len(sh.points) {
									alt := rl.IsKeyDown(.LEFT_ALT) || rl.IsKeyDown(.RIGHT_ALT)
									if !alt && poly_is_rect(sh.points[:]) {
										// a rect stays a rect: the neighbors follow
										// on the axis each shared with this corner
										old := sh.points[i]
										prev := &sh.points[(i + 3) % 4]
										next := &sh.points[(i + 1) % 4]
										if abs(prev.x - old.x) < 0.001 do prev.x = wm.x
										if abs(prev.y - old.y) < 0.001 do prev.y = wm.y
										if abs(next.x - old.x) < 0.001 do next.x = wm.x
										if abs(next.y - old.y) < 0.001 do next.y = wm.y
									}
									sh.points[i] = wm
								}
							}
						}
					} else if g_down && ed.scaling {
						d := max(vlen(ed.scale_anchor, wm), 0.001)
						if d != ed.scale_d {
							scale_sel(d / ed.scale_d, ed.scale_anchor)
							ed.scale_d = d
						}
					} else if g_down && ed.dragging && ed.sel_part >= 0 {
						d := wm - ed.drag_off
						if d != {} {
							if !ed.drag_pushed {
								push_undo() // the state before the first nudge
								ed.drag_pushed = true
							}
							for e in ed.sel_set {
								if e[0] >= 0 && e[0] < len(ed.doc.parts) && e[1] >= 0 && e[1] < len(ed.doc.parts[e[0]].shapes) {
									shape_move(&ed.doc.parts[e[0]].shapes[e[1]], d)
								}
							}
							ed.drag_off = wm
						}
					}
					if g_released {
						if ed.marquee {
							ed.marquee = false
							if vlen(ed.mq_a, wm) * ed.zoom > 4 {
								lo := V2{min(ed.mq_a.x, wm.x), min(ed.mq_a.y, wm.y)}
								hi := V2{max(ed.mq_a.x, wm.x), max(ed.mq_a.y, wm.y)}
								vis := visible_parts()
								for pk in vis {
									for &sh, sk in ed.doc.parts[pk].shapes {
										slo, shi := shape_bounds(&sh)
										if slo.x <= hi.x && shi.x >= lo.x && slo.y <= hi.y && shi.y >= lo.y {
											if !sel_has(pk, sk) do append(&ed.sel_set, [2]int{pk, sk})
										}
									}
								}
								sel_primary_fix()
							}
						}
						ed.dragging = false
						ed.handle = 0
						ed.scaling = false
					}
				case .Circle, .Line, .Rect:
					if g_click {
						ed.drawing = true
						ed.draw_a = wm
					}
					if ed.drawing && g_released {
						ed.drawing = false
						if p := cur_part(); p != nil {
							push_undo()
							sh: fart.Shape
							sh.color = strings.clone(cur_tok_name())
							if ed.tool == .Circle {
								sh.kind = "circle"
								sh.at = ed.draw_a
								sh.r = max(vlen(ed.draw_a, wm), 0.4)
							} else if ed.tool == .Rect {
								sh.kind = "poly"
								lo := V2{min(ed.draw_a.x, wm.x), min(ed.draw_a.y, wm.y)}
								hi := V2{max(ed.draw_a.x, wm.x), max(ed.draw_a.y, wm.y)}
								if hi.x - lo.x < 0.3 do hi.x = lo.x + 0.3
								if hi.y - lo.y < 0.3 do hi.y = lo.y + 0.3
								append(&sh.points, lo)
								append(&sh.points, V2{hi.x, lo.y})
								append(&sh.points, hi)
								append(&sh.points, V2{lo.x, hi.y})
							} else {
								sh.kind = "line"
								sh.a = ed.draw_a
								sh.b = wm
								sh.w = 1.4
							}
							append(&p.shapes, sh)
							sel_only(ed.cur_part, len(p.shapes) - 1)
						}
					}
				case .Poly:
					if g_click {
						close_it := len(ed.poly_pts) >= 3 && vlen(ed.poly_pts[0], wm) * ed.zoom < 10
						if close_it {
							if p := cur_part(); p != nil {
								push_undo()
								sh: fart.Shape
								sh.kind = "poly"
								sh.color = strings.clone(cur_tok_name())
								for q in ed.poly_pts do append(&sh.points, q)
								append(&p.shapes, sh)
								sel_only(ed.cur_part, len(p.shapes) - 1)
							}
							clear(&ed.poly_pts)
						} else do append(&ed.poly_pts, wm)
					}
					if rl.IsKeyPressed(.ENTER) && len(ed.poly_pts) >= 3 && !ed.prompt_on {
						if p := cur_part(); p != nil {
							push_undo()
							sh: fart.Shape
							sh.kind = "poly"
							sh.color = strings.clone(cur_tok_name())
							for q in ed.poly_pts do append(&sh.points, q)
							append(&p.shapes, sh)
							sel_only(ed.cur_part, len(p.shapes) - 1)
						}
						clear(&ed.poly_pts)
					}
				}
			}
		} else if g_released {
			ed.dragging = false
			ed.handle = 0
			ed.marquee = false
			ed.scaling = false
			ed.pose_drag = false
			ed.pose_rot = false
		}
		if !g_down && ed.slider_id == 0 do ed.undo_open = false
		flush_scratch()

		// ------------------------------------------------ draw
		rl.BeginDrawing()
		scale_begin()
		rl.ClearBackground(UI_BG)

		// canvas: grid
		{
			scissor_begin(canvas.x, canvas.y, canvas.width, canvas.height)
			step := ed.zoom
			for step < 26 do step *= 4
			o := to_screen({0, 0})
			x := canvas.x + math.mod(o.x - canvas.x, step)
			for ; x < canvas.x + canvas.width; x += step do rl.DrawLineV({x, canvas.y}, {x, canvas.y + canvas.height}, {255, 255, 255, 10})
			y := canvas.y + math.mod(o.y - canvas.y, step)
			for ; y < canvas.y + canvas.height; y += step do rl.DrawLineV({canvas.x, y}, {canvas.x + canvas.width, y}, {255, 255, 255, 10})
			rl.DrawLineV({o.x, canvas.y}, {o.x, canvas.y + canvas.height}, {255, 255, 255, 30})
			rl.DrawLineV({canvas.x, o.y}, {canvas.x + canvas.width, o.y}, {255, 255, 255, 30})

			if ed.collide {
				// the art, dimmed to context; the solids, bright over it
				for &p in ed.doc.parts do for &sh in p.shapes {
					draw_shape_world(&ed.doc, &sh, {0, 0, 0, 0})
				}
				rl.DrawRectangleRec(canvas, {UI_BG.r, UI_BG.g, UI_BG.b, 165})
				for &sh, i in ed.doc.collision do draw_col_shape(&sh, i == ed.col_sel)
				if sh := col_shape(); sh != nil && ed.tool == .Select {
					hs := make([dynamic]V2, context.temp_allocator)
					col_handles(sh, &hs)
					for hp in hs {
						s := to_screen(hp)
						rl.DrawCircleV(s, 4.5, {20, 19, 18, 255})
						rl.DrawCircleV(s, 3, UI_ACCENT)
					}
				}
				txt("collision lens -- these shapes are what the game bumps into; a line is a capsule",
					canvas.x + 12, canvas.y + canvas.height - 24, FS_SMALL, {90, 200, 235, 200})
			} else if st := state_cur(); st != nil {
				// pose mode: the state's own truth, transforms applied
				cp := cur_part()
				for &sp in st.parts {
					part := fart.part_of(&ed.doc, sp.part)
					if part == nil do continue
					outline := rl.Color{0, 0, 0, 0}
					if cp != nil && cp.name == sp.part do outline = UI_ACCENT
					draw_part_posed(&ed.doc, part, &sp, outline)
				}
				// the current part's pivot and its rotate lever
				if sp := cur_pose(st); sp != nil {
					pv := to_screen(sp.offset)
					hp := to_screen(pose_rot_handle(sp))
					rl.DrawLineV(pv, hp, {255, 200, 92, 120})
					rl.DrawCircleLinesV(pv, 6, {255, 190, 110, 220})
					rl.DrawCircleV(hp, 5.5, {20, 19, 18, 255})
					rl.DrawCircleV(hp, 4, UI_ACCENT)
				}
				txt("pose mode -- drag a part to place it, pull the lever to turn it; geometry is locked",
					canvas.x + 12, canvas.y + canvas.height - 24, FS_SMALL, UI_DIM)
			} else {
				vis := visible_parts()
				for pk in vis {
					p := &ed.doc.parts[pk]
					for &sh, sk in p.shapes {
						outline := rl.Color{0, 0, 0, 0}
						if sel_has(pk, sk) do outline = UI_ACCENT
						else if pk == ed.hov_part && sk == ed.hov_shape && ed.tool == .Select && in_canvas do outline = {255, 255, 255, 70}
						draw_shape_world(&ed.doc, &sh, outline)
					}
				}
				// selection handles
				if ed.tool == .Select {
					sel_handles(&g_handles)
					for hp in g_handles {
						s := to_screen(hp)
						rl.DrawCircleV(s, 4.5, {20, 19, 18, 255})
						rl.DrawCircleV(s, 3, UI_ACCENT)
					}
				}
				// the selection's box, its corners the scale grips
				if ed.tool == .Select && len(ed.sel_set) > 0 {
					if lo, hi, bok := sel_bounds(); bok {
						pad := 6 / ed.zoom
						a := to_screen({lo.x - pad, lo.y - pad})
						b := to_screen({hi.x + pad, hi.y + pad})
						rl.DrawRectangleLinesEx({a.x, a.y, b.x - a.x, b.y - a.y}, 1, {255, 200, 92, 55})
						corners := [4]V2 {
							{lo.x - pad, lo.y - pad}, {hi.x + pad, lo.y - pad},
							{hi.x + pad, hi.y + pad}, {lo.x - pad, hi.y + pad},
						}
						for c in corners {
							s := to_screen(c)
							rl.DrawRectangleRec({s.x - 3.5, s.y - 3.5, 7, 7}, {20, 19, 18, 255})
							rl.DrawRectangleRec({s.x - 2.5, s.y - 2.5, 5, 5}, UI_ACCENT)
						}
					}
				}
				// the rubber band
				if ed.marquee {
					a := to_screen(ed.mq_a)
					mr := rl.Rectangle{min(a.x, g_mouse.x), min(a.y, g_mouse.y), abs(g_mouse.x - a.x), abs(g_mouse.y - a.y)}
					rl.DrawRectangleRec(mr, {255, 200, 92, 16})
					rl.DrawRectangleLinesEx(mr, 1, {255, 200, 92, 120})
				}
			}
			// current part pivot + anchors (raw geometry view only)
			if p := cur_part(); p != nil && state_cur() == nil {
				pv := to_screen(p.pivot)
				rl.DrawCircleLinesV(pv, 6, {255, 190, 110, 220})
				rl.DrawLineV(pv - {8, 0}, pv + {8, 0}, {255, 190, 110, 130})
				rl.DrawLineV(pv - {0, 8}, pv + {0, 8}, {255, 190, 110, 130})
				for a in p.anchors {
					av := to_screen(a.at)
					rl.DrawLineV(av - {5, 0}, av + {5, 0}, {130, 220, 160, 220})
					rl.DrawLineV(av - {0, 5}, av + {0, 5}, {130, 220, 160, 220})
					txt(fmt.ctprintf("%s", a.name), av.x + 7, av.y - 7, FS_SMALL, {130, 220, 160, 200})
				}
			}
			// in-progress drawing
			if len(ed.poly_pts) > 0 {
				for k in 0 ..< len(ed.poly_pts) {
					a := to_screen(ed.poly_pts[k])
					rl.DrawCircleV(a, 3, UI_ACCENT)
					if k > 0 do rl.DrawLineV(to_screen(ed.poly_pts[k - 1]), a, {255, 214, 120, 150})
				}
				rl.DrawLineV(to_screen(ed.poly_pts[len(ed.poly_pts) - 1]), g_mouse, {255, 214, 120, 80})
				txt("click near the first point (or Enter) to close", canvas.x + 12, canvas.y + canvas.height - 24, FS_SMALL, UI_DIM)
			}
			if ed.drawing {
				a := to_screen(ed.draw_a)
				if ed.tool == .Circle {
					dx, dy := g_mouse.x - a.x, g_mouse.y - a.y
					rl.DrawCircleLinesV(a, math.sqrt(dx * dx + dy * dy), {255, 214, 120, 160})
				} else if ed.tool == .Rect {
					pr := rl.Rectangle{min(a.x, g_mouse.x), min(a.y, g_mouse.y), abs(g_mouse.x - a.x), abs(g_mouse.y - a.y)}
					rl.DrawRectangleLinesEx(pr, 2, {255, 214, 120, 160})
				} else do rl.DrawLineEx(a, g_mouse, 2, {255, 214, 120, 160})
			}
			if ed.pending != .None {
				s: cstring = ed.pending == .Pivot ? "click to place the pivot  --  Esc cancels" : "click to place the anchor  --  Esc cancels"
				tw := txt_w(s, FS_BODY)
				pr := rl.Rectangle{canvas.x + (canvas.width - tw) / 2 - 16, canvas.y + 12, tw + 32, 30}
				rl.DrawRectangleRounded(pr, 0.5, 6, {13, 13, 14, 235})
				rl.DrawRectangleRoundedLinesEx(pr, 0.5, 6, 1, {255, 200, 92, 120})
				txt(s, pr.x + 16, pr.y + (pr.height - FS_BODY) / 2 - 1, FS_BODY, UI_ACCENT)
			}
			rl.EndScissorMode()
		}

		// ------------------------------------------------ toolbar
		rl.DrawRectangleRec({0, 0, W, TOP}, UI_PANEL)
		hairline(0, TOP - 1, W)
		{
			add_label := [Tool]cstring {
				.Select = "+ Add",
				.Circle = "+ Circle",
				.Line   = "+ Line",
				.Poly   = "+ Poly",
				.Rect   = "+ Rect",
			}
			group := rl.Rectangle{10, (TOP - 32) / 2, 4 + 82 + 4 + 104 + 4, 32}
			rl.DrawRectangleRounded(group, 0.3, 5, UI_INSET)
			x := group.x + 4
			if ui_tool({x, group.y + 3, 82, 26}, "Select", "1", ed.tool == .Select) {
				ed.tool = .Select
				ed.add_open = false
			}
			x += 86
			add_r = rl.Rectangle{x, group.y + 3, 104, 26}
			if ui_tool(add_r, add_label[ed.tool], "v", ed.tool != .Select) do ed.add_open = !ed.add_open
			x = group.x + group.width + 18
			if ui_button({x, (TOP - 28) / 2, 68, 28}, "Save", ghost = !ed.dirty) do save()
			x += 76
			if ui_button({x, (TOP - 28) / 2, 68, 28}, "Undo", ghost = true) do do_undo()
			x += 76
			if ui_button({x, (TOP - 28) / 2, 68, 28}, "Redo", ghost = true) do do_redo()
			x += 76
			if ui_button({x, (TOP - 28) / 2, 80, 28}, "Browse", ghost = true) {
				leave_revert()
				ed.mode = .Browse
				browse_refresh()
			}
			x += 88
			if ui_button({x, (TOP - 28) / 2, 92, 28}, "Collision", ed.collide, ghost = !ed.collide) {
				ed.collide = !ed.collide
				ed.col_sel = -1
			}
			label := fmt.ctprintf("%s", ed.path)
			lw := txt_w(label, FS_BODY)
			txt(label, W - lw - 14, (TOP - FS_BODY) / 2 - 1, FS_BODY, UI_DIM)
			if ed.dirty do rl.DrawCircleV({W - lw - 26, TOP / 2}, 3.5, UI_ACCENT)
		}

		// panels scroll: the wheel over one, or a touch drag along it
		{
			lp := rl.Rectangle{0, TOP, LEFT, H - TOP}
			rp := rl.Rectangle{W - RIGHT, TOP, RIGHT, H - TOP}
			if wl := rl.GetMouseWheelMove(); wl != 0 {
				if rl.CheckCollisionPointRec(g_mouse, lp) do ed.lscroll -= wl * 40
				else if rl.CheckCollisionPointRec(g_mouse, rp) do ed.rscroll -= wl * 40
			}
			if g_click && !ed.prompt_on {
				if rl.CheckCollisionPointRec(g_mouse, lp) do ed.pdrag = 1
				else if rl.CheckCollisionPointRec(g_mouse, rp) do ed.pdrag = 2
				ed.plast = g_mouse
			}
			if g_down && ed.pdrag != 0 && ed.slider_id == 0 {
				dy := g_mouse.y - ed.plast.y
				if ed.pdrag == 1 do ed.lscroll -= dy
				else do ed.rscroll -= dy
				ed.plast = g_mouse
			}
			if g_released || ed.slider_id != 0 do ed.pdrag = 0
			ed.lscroll = clamp(ed.lscroll, 0, max(ed.lcontent - (H - TOP) + 10, 0))
			ed.rscroll = clamp(ed.rscroll, 0, max(ed.rcontent - (H - TOP) + 10, 0))
		}

		// ------------------------------------------------ left: palette + shape
		rl.DrawRectangleRec({0, TOP, LEFT, H - TOP}, UI_PANEL)
		rl.DrawRectangleRec({LEFT - 1, TOP, 1, H - TOP}, UI_EDGE)
		{
			scissor_begin(0, TOP, LEFT, H - TOP)
			g_ui_min_y = TOP
			x := f32(PAD)
			w_ := LEFT - 2 * f32(PAD)
			y := TOP + 14 - ed.lscroll
			if ed.collide {
				header("COLLISION", x, y)
				cn := fmt.ctprintf("%d solid%s", len(ed.doc.collision), len(ed.doc.collision) == 1 ? "" : "s")
				txt(cn, x + w_ - txt_w(cn, FS_SMALL), y, FS_SMALL, UI_DIM)
				y += 20
				if sh := col_shape(); sh != nil {
					txt(fmt.ctprintf("%s%s", sh.kind, sh.kind == "line" ? "  (a capsule)" : ""), x, y, FS_BODY, UI_TEXT)
					y += 20
					if sh.kind == "line" {
						txt("girth", x, y + 1, FS_SMALL, UI_FAINT)
						if ui_slider({x + 40, y, w_ - 76, 14}, &sh.w, 1, 24, 210) {
							if !ed.undo_open {
								push_undo()
								ed.undo_open = true
							}
							ed.dirty = true
						}
						gv := fmt.ctprintf("%.1f", sh.w)
						txt(gv, x + w_ - txt_w(gv, FS_SMALL), y + 1, FS_SMALL, UI_TEXT)
						y += 22
					}
					if ui_button({x, y, w_, 24}, "Delete", ghost = true, danger = true) do col_delete()
					y += 30
				} else {
					txt("draw with the same tools; the art", x, y, FS_SMALL, UI_FAINT)
					y += 15
					txt("is dimmed but still there to trace", x, y, FS_SMALL, UI_FAINT)
					y += 20
				}
				hairline(x, y - 4, w_)
				y += 8
			}
			header("PALETTE", x, y)
			y += 20
			kill_tok := -1
			for &tk, k in ed.doc.palette {
				r := rl.Rectangle{x - 2, y, w_ + 4, ROW_H}
				hov := ui_hov(r)
				if k == ed.cur_tok do rl.DrawRectangleRounded(r, 0.25, 4, UI_ACCENT_DIM)
				else if hov do rl.DrawRectangleRounded(r, 0.25, 4, {255, 255, 255, 8})
				rl.DrawRectangleRounded({r.x + 6, r.y + 5, 16, 16}, 0.35, 3, {tk.rgb[0], tk.rgb[1], tk.rgb[2], tk.rgb[3]})
				rl.DrawRectangleRoundedLinesEx({r.x + 6, r.y + 5, 16, 16}, 0.35, 3, 1, {255, 255, 255, 30})
				txt(fmt.ctprintf("%s", tk.name), r.x + 30, r.y + (ROW_H - FS_BODY) / 2 - 1, FS_BODY, k == ed.cur_tok ? UI_ACCENT : UI_TEXT)
				on_del := false
				if k == ed.cur_tok {
					del := rl.Rectangle{r.x + r.width - 24, r.y + 3, 20, 20}
					on_del = rl.CheckCollisionPointRec(g_mouse, del)
					if ui_button(del, "x", ghost = true, danger = true) do kill_tok = k
				}
				if hov && g_tap && !on_del {
					dbl := ed.cur_tok == k && rl.GetTime() - ed.click_t < 0.4 && ed.click_id == 3000 + k
					ed.click_t = rl.GetTime()
					ed.click_id = 3000 + k
					ed.cur_tok = k
					if dbl {
						ed.rename_idx = k
						start_prompt("rename token", tk.name)
					} else {
						if len(ed.sel_set) > 0 do push_undo()
						for e in ed.sel_set {
							if e[0] >= 0 && e[0] < len(ed.doc.parts) && e[1] >= 0 && e[1] < len(ed.doc.parts[e[0]].shapes) {
								ed.doc.parts[e[0]].shapes[e[1]].color = strings.clone(tk.name)
							}
						}
					}
				}
				y += ROW_H + 2
			}
			if kill_tok >= 0 do token_delete(kill_tok)
			// tokens that only exist in shared palettes, shown read-only
			shown: int
			for tk in ed.doc.resolved {
				local := false
				for lt in ed.doc.palette do if lt.name == tk.name do local = true
				if local do continue
				if shown == 0 {
					y += 8
					header("SHARED", x, y)
					y += 18
				}
				r := rl.Rectangle{x - 2, y, w_ + 4, 22}
				hov := ui_hov(r)
				if hov do rl.DrawRectangleRounded(r, 0.25, 4, {255, 255, 255, 8})
				rl.DrawRectangleRounded({r.x + 6, r.y + 3, 16, 16}, 0.35, 3, {tk.rgb[0], tk.rgb[1], tk.rgb[2], tk.rgb[3]})
				rl.DrawRectangleRoundedLinesEx({r.x + 6, r.y + 3, 16, 16}, 0.35, 3, 1, {255, 255, 255, 30})
				txt(fmt.ctprintf("%s", tk.name), r.x + 30, r.y + 4, FS_BODY, UI_DIM)
				if hov && g_tap {
					if len(ed.sel_set) > 0 do push_undo()
					for e in ed.sel_set {
						if e[0] >= 0 && e[0] < len(ed.doc.parts) && e[1] >= 0 && e[1] < len(ed.doc.parts[e[0]].shapes) {
							ed.doc.parts[e[0]].shapes[e[1]].color = strings.clone(tk.name)
						}
					}
				}
				y += 24
				shown += 1
			}
			y += 8
			if ui_button({x, y, w_, ROW_H}, "+ token", ghost = true) do start_prompt("token")
			y += ROW_H + 18
			// current token sliders
			if ed.cur_tok >= 0 && ed.cur_tok < len(ed.doc.palette) {
				hairline(x, y - 9, w_)
				tk := &ed.doc.palette[ed.cur_tok]
				header("COLOUR", x, y)
				tn := fmt.ctprintf("%s", tk.name)
				txt(tn, x + w_ - txt_w(tn, FS_SMALL), y, FS_SMALL, UI_DIM)
				y += 20
				chan := [4]cstring{"R", "G", "B", "A"}
				for ci in 0 ..< 4 {
					txt(chan[ci], x, y + 1, FS_SMALL, UI_FAINT)
					v := f32(tk.rgb[ci])
					if ui_slider({x + 16, y, w_ - 52, 14}, &v, 0, 255, 100 + ci) {
						if !ed.undo_open {
							push_undo()
							ed.undo_open = true
						}
						tk.rgb[ci] = u8(v)
						ed.dirty = true
					}
					vs := fmt.ctprintf("%d", tk.rgb[ci])
					txt(vs, x + w_ - txt_w(vs, FS_SMALL), y + 1, FS_SMALL, UI_TEXT)
					y += 20
				}
				rl.DrawRectangleRounded({x, y + 4, w_, 14}, 0.6, 5, {tk.rgb[0], tk.rgb[1], tk.rgb[2], tk.rgb[3]})
				rl.DrawRectangleRoundedLinesEx({x, y + 4, w_, 14}, 0.6, 5, 1, {255, 255, 255, 30})
				y += 24
			}
			// the selection: one shape's properties, or the size of the crowd
			if n := len(ed.sel_set); n > 1 {
				y += 12
				hairline(x, y - 6, w_)
				header("SELECTED", x, y)
				y += 20
				txt(fmt.ctprintf("%d shapes", n), x, y, FS_BODY, UI_TEXT)
				y += 22
				txt("order", x, y + 5, FS_SMALL, UI_FAINT)
				ow := (w_ - 44 - 8) / 2
				if ui_button({x + 44, y, ow, 24}, "Lower  [", ghost = true) do sel_lower()
				if ui_button({x + 44 + ow + 8, y, ow, 24}, "Raise  ]", ghost = true) do sel_raise()
				y += 30
				bw2 := (w_ - 8) / 2
				if ui_button({x, y, bw2, ROW_H}, "Delete", ghost = true, danger = true) {
					sel_delete()
				} else if ui_button({x + bw2 + 8, y, bw2, ROW_H}, "To part", ghost = true) {
					sel_to_part()
				}
			} else if sh := sel(); sh != nil {
				y += 12
				hairline(x, y - 6, w_)
				header("SELECTED", x, y)
				y += 20
				txt(fmt.ctprintf("%s", sh.kind), x, y, FS_BODY, UI_TEXT)
				tn2 := fmt.ctprintf("%s", sh.color)
				txt(tn2, x + w_ - txt_w(tn2, FS_SMALL), y + 1, FS_SMALL, UI_DIM)
				y += 22
				if sh.kind == "line" {
					txt("width", x, y + 1, FS_SMALL, UI_FAINT)
					if ui_slider({x + 40, y, w_ - 76, 14}, &sh.w, 0.3, 8, 200) {
						if !ed.undo_open {
							push_undo()
							ed.undo_open = true
						}
						ed.dirty = true
					}
					vs2 := fmt.ctprintf("%.1f", sh.w)
					txt(vs2, x + w_ - txt_w(vs2, FS_SMALL), y + 1, FS_SMALL, UI_TEXT)
					y += 22
				}
				// stacking within the part: later draws on top
				txt("order", x, y + 5, FS_SMALL, UI_FAINT)
				ow := (w_ - 44 - 8) / 2
				if ui_button({x + 44, y, ow, 24}, "Lower  [", ghost = true) do sel_lower()
				if ui_button({x + 44 + ow + 8, y, ow, 24}, "Raise  ]", ghost = true) do sel_raise()
				y += 30
				bw2 := (w_ - 8) / 2
				if ui_button({x, y, bw2, ROW_H}, "Delete", ghost = true, danger = true) {
					sel_delete()
				} else if ed.sel_part != ed.cur_part {
					if ui_button({x + bw2 + 8, y, bw2, ROW_H}, "To part", ghost = true) do sel_to_part()
				}
			}

			ed.lcontent = y + ed.lscroll - TOP + 20
			rl.EndScissorMode()
		}

		// ------------------------------------------------ right: parts + states
		RX := W - RIGHT
		rl.DrawRectangleRec({RX, TOP, RIGHT, H - TOP}, UI_PANEL)
		rl.DrawRectangleRec({RX, TOP, 1, H - TOP}, UI_EDGE)
		{
			scissor_begin(RX, TOP, RIGHT, H - TOP)
			x := RX + f32(PAD)
			w_ := RIGHT - 2 * f32(PAD)
			y := TOP + 14 - ed.rscroll
			header("PARTS", x, y)
			y += 20
			in_state := ed.cur_state >= 0 && ed.cur_state < len(ed.doc.states)
			kill_part := -1
			for &p, k in ed.doc.parts {
				r := rl.Rectangle{x - 2, y, w_ + 4, ROW_H}
				rr := r
				if in_state {
					st := &ed.doc.states[ed.cur_state]
					member := false
					mi := -1
					for sp, si in st.parts do if sp.part == p.name {
						member = true
						mi = si
					}
					if ui_check({r.x + r.width - 24, r.y + 4, 18, 18}, member) {
						push_undo()
						if member do ordered_remove(&st.parts, mi)
						else do append(&st.parts, fart.State_Part{part = strings.clone(p.name), offset = p.pivot})
					}
					rr.width -= 28
				} else if k == ed.cur_part {
					bx := r.x + r.width - 22
					if ui_button({bx, r.y + 3, 20, 20}, "x", ghost = true, danger = true) do kill_part = k
					rr.width -= 26
					if len(ed.doc.parts) > 1 {
						// nudge the current part through the draw order
						if ui_button({bx - 48, r.y + 3, 20, 20}, "^", ghost = true) do part_swap(k, k - 1)
						if ui_button({bx - 24, r.y + 3, 20, 20}, "v", ghost = true) do part_swap(k, k + 1)
						rr.width -= 48
					}
				}
				if ui_row(rr, fmt.ctprintf("%s", p.name), k == ed.cur_part) {
					if ed.cur_part == k && rl.GetTime() - ed.click_t < 0.4 && ed.click_id == 1000 + k {
						ed.rename_idx = k
						start_prompt("rename part", p.name)
					}
					ed.click_t = rl.GetTime()
					ed.click_id = 1000 + k
					ed.cur_part = k
				}
				if !in_state && k != ed.cur_part {
					cnt := fmt.ctprintf("%d", len(p.shapes))
					txt(cnt, r.x + r.width - 9 - txt_w(cnt, FS_SMALL), r.y + (ROW_H - FS_SMALL) / 2, FS_SMALL, UI_FAINT)
				}
				y += ROW_H + 2
			}
			if kill_part >= 0 do part_delete(kill_part)
			if !in_state && len(ed.doc.parts) > 1 {
				txt("parts draw top to bottom; lower lands on top", x, y + 2, FS_SMALL, UI_FAINT)
				y += 18
			}
			// posing the current part within the selected state
			if in_state {
				if sp := cur_pose(&ed.doc.states[ed.cur_state]); sp != nil {
					y += 10
					hairline(x, y - 5, w_)
					header("POSE", x, y)
					pn := fmt.ctprintf("%s", sp.part)
					txt(pn, x + w_ - txt_w(pn, FS_SMALL), y, FS_SMALL, UI_DIM)
					y += 20
					txt("turn", x, y + 1, FS_SMALL, UI_FAINT)
					rv := sp.rotate
					if ui_slider({x + 36, y, w_ - 72, 14}, &rv, -3.1416, 3.1416, 300) {
						if !ed.undo_open {
							push_undo()
							ed.undo_open = true
						}
						sp.rotate = rv
						ed.dirty = true
					}
					dv := fmt.ctprintf("%.0f", sp.rotate * 57.2958)
					txt(dv, x + w_ - txt_w(dv, FS_SMALL), y + 1, FS_SMALL, UI_TEXT)
					y += 20
					txt("size", x, y + 1, FS_SMALL, UI_FAINT)
					sv := sp.scale == 0 ? f32(1) : sp.scale
					if ui_slider({x + 36, y, w_ - 72, 14}, &sv, 0.25, 3, 301) {
						if !ed.undo_open {
							push_undo()
							ed.undo_open = true
						}
						sp.scale = sv
						ed.dirty = true
					}
					sd := fmt.ctprintf("%.2f", sp.scale == 0 ? f32(1) : sp.scale)
					txt(sd, x + w_ - txt_w(sd, FS_SMALL), y + 1, FS_SMALL, UI_TEXT)
					y += 22
					if ui_button({x, y, w_, 24}, "reset pose", ghost = true) {
						push_undo()
						if p := cur_part(); p != nil do sp.offset = p.pivot
						sp.rotate = 0
						sp.scale = 0
						ed.dirty = true
					}
					y += 30
				}
			}
			y += 4
			if ui_button({x, y, w_, ROW_H}, "+ part", ghost = true) do start_prompt("part")
			y += ROW_H + 10
			bw2 := (w_ - 8) / 2
			if ui_button({x, y, bw2, ROW_H}, "Set pivot", ed.pending == .Pivot, ghost = true) do ed.pending = .Pivot
			if ui_button({x + bw2 + 8, y, bw2, ROW_H}, "Add anchor", ed.pending == .Anchor, ghost = true) do ed.pending = .Anchor
			y += ROW_H + 20
			hairline(x, y - 10, w_)
			header("STATES", x, y)
			hint: cstring = "the preview"
			txt(hint, x + w_ - txt_w(hint, FS_SMALL), y, FS_SMALL, UI_FAINT)
			y += 20
			if ui_row({x - 2, y, w_ + 4, ROW_H}, "all parts", ed.cur_state == -1, dim = ed.cur_state != -1) do ed.cur_state = -1
			y += ROW_H + 2
			kill_state := -1
			for &st, k in ed.doc.states {
				r := rl.Rectangle{x - 2, y, w_ + 4, ROW_H}
				rr := r
				if ed.cur_state == k {
					if ui_button({r.x + r.width - 22, r.y + 3, 20, 20}, "x", ghost = true, danger = true) do kill_state = k
					rr.width -= 26
				}
				if ui_row(rr, fmt.ctprintf("%s", st.name), ed.cur_state == k) {
					if ed.cur_state == k && rl.GetTime() - ed.click_t < 0.4 && ed.click_id == 2000 + k {
						ed.rename_idx = k
						start_prompt("rename state", st.name)
					}
					ed.click_t = rl.GetTime()
					ed.click_id = 2000 + k
					ed.cur_state = k
				}
				if ed.cur_state != k {
					cnt := fmt.ctprintf("%d", len(st.parts))
					txt(cnt, r.x + r.width - 9 - txt_w(cnt, FS_SMALL), r.y + (ROW_H - FS_SMALL) / 2, FS_SMALL, UI_FAINT)
				}
				y += ROW_H + 2
			}
			if kill_state >= 0 do state_delete(kill_state)
			y += 4
			if ui_button({x, y, w_, ROW_H}, "+ state", ghost = true) do start_prompt("state")
			y += ROW_H + 12
			if in_state {
				txt("ticks pick which parts this state shows", x, y, FS_SMALL, UI_FAINT)
			}

			ed.rcontent = y + ed.rscroll - TOP + 24
			g_ui_min_y = 0
			rl.EndScissorMode()
		}

		// the + Add dropdown, over everything
		if ed.add_open && !ed.prompt_on {
			kinds := [?]Tool{.Circle, .Line, .Poly, .Rect}
			knames := [?]cstring{"Circle", "Line", "Poly", "Rect"}
			kkeys := [?]cstring{"2", "3", "4", "5"}
			dd := rl.Rectangle{add_r.x, TOP + 2, 140, f32(len(kinds)) * (ROW_H + 2) + 10}
			rl.DrawRectangleRounded(dd, 0.1, 5, UI_PANEL)
			rl.DrawRectangleRoundedLinesEx(dd, 0.1, 5, 1, {255, 255, 255, 45})
			yy := dd.y + 6
			for t, i in kinds {
				rr := rl.Rectangle{dd.x + 5, yy, dd.width - 10, ROW_H}
				if ui_row(rr, knames[i], ed.tool == t) {
					ed.tool = t
					ed.add_open = false
				}
				txt(kkeys[i], rr.x + rr.width - 9 - txt_w(kkeys[i], FS_SMALL), rr.y + (ROW_H - FS_SMALL) / 2, FS_SMALL, UI_FAINT)
				yy += ROW_H + 2
			}
			if g_click && !rl.CheckCollisionPointRec(g_mouse, dd) && !rl.CheckCollisionPointRec(g_mouse, add_r) {
				ed.add_open = false
			}
		}

		if ed.prompt_on do prompt_frame(W, H)

		rl.EndDrawing()
		free_all(context.temp_allocator)
		if shot_tick() do return false
	}
	return true
}

// --shot: give the window a few frames to settle, save one, leave.
// (TakeScreenshot doubles the DPI scale on retina; read the pixels ourselves.)
shot_tick :: proc() -> bool {
	if g_shot == "" do return false
	g_shot_t += 1
	if g_shot_t <= 10 do return false
	rw, rh := rl.GetRenderWidth(), rl.GetRenderHeight()
	img := rl.Image {
		data    = rlgl.ReadScreenPixels(rw, rh),
		width   = rw,
		height  = rh,
		mipmaps = 1,
		format  = .UNCOMPRESSED_R8G8B8A8,
	}
	rl.ExportImage(img, fmt.ctprintf("%s", g_shot))
	rl.UnloadImage(img)
	return true
}

prompt_frame :: proc(W, H: f32) {
	rl.DrawRectangleRec({0, 0, W, H}, {0, 0, 0, 150})
	bw, bh := f32(440), f32(118)
	r := rl.Rectangle{W / 2 - bw / 2, H / 2 - bh / 2, bw, bh}
	rl.DrawRectangleRounded(r, 0.1, 6, UI_PANEL)
	rl.DrawRectangleRoundedLinesEx(r, 0.1, 6, 1, {255, 255, 255, 40})
	title: cstring
	if strings.has_prefix(ed.prompt_what, "rename ") do title = fmt.ctprintf("New name for the %s", ed.prompt_what[7:])
	else do title = fmt.ctprintf("Name the new %s", ed.prompt_what)
	txt(title, r.x + 16, r.y + 14, FS_BODY, UI_DIM)
	well := rl.Rectangle{r.x + 16, r.y + 38, bw - 32, 34}
	rl.DrawRectangleRounded(well, 0.25, 4, UI_INSET)
	rl.DrawRectangleRoundedLinesEx(well, 0.25, 4, 1, {255, 200, 92, 90})
	s := fmt.ctprintf("%s", strings.to_string(ed.prompt))
	txt(s, well.x + 10, well.y + (34 - FS_BIG) / 2, FS_BIG, UI_TEXT)
	rl.DrawRectangleRec({well.x + 13 + txt_w(s, FS_BIG), well.y + 7, 2, 20}, UI_ACCENT)
	txt("Enter confirms  -  Esc cancels", r.x + 16, r.y + bh - 24, FS_SMALL, UI_FAINT)
}
