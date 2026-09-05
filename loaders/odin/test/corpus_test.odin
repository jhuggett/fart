package fastart_test

// The conformance corpus (spec/examples) against the reference loader.
// A game loader is allowed to be lenient: past `json` and `version` it
// need not refuse anything, so only those two codes must fail here.

import "core:encoding/json"
import "core:fmt"
import "core:math"
import "core:os"
import "core:testing"
import fart ".."

EXAMPLES :: #directory + "/../../../spec/examples/"

Case :: struct {
	file:  string,
	valid: bool,
	code:  string,
}
Manifest :: struct {
	cases: []Case,
}

// The loader's strings live wherever unmarshal put them; a game drops the
// whole arena. Here, the temp allocator plays that arena.
@(private = "file")
arena_load :: proc(data: []byte) -> (fart.Doc, bool) {
	context.allocator = context.temp_allocator
	return fart.load_bytes(data)
}

@(test)
corpus :: proc(t: ^testing.T) {
	mdata, merr := os.read_entire_file(EXAMPLES + "manifest.json", context.temp_allocator)
	if !testing.expect(t, merr == nil, "manifest.json should be readable") do return
	m: Manifest
	if !testing.expect(t, json.unmarshal(mdata, &m, allocator = context.temp_allocator) == nil, "manifest.json should parse") do return
	testing.expect(t, len(m.cases) > 20, "the corpus has cases")
	for c in m.cases {
		data, err := os.read_entire_file(fmt.tprintf("%s%s", EXAMPLES, c.file), context.temp_allocator)
		if !testing.expectf(t, err == nil, "%s should be readable", c.file) do continue
		doc, ok := arena_load(data)
		if c.valid {
			testing.expectf(t, ok, "%s should load", c.file)
		} else if c.code == "json" || c.code == "version" {
			testing.expectf(t, !ok, "%s should be refused (%s)", c.file, c.code)
		}
		_ = doc
	}
}

@(test)
absent_offset_is_rest :: proc(t: ^testing.T) {
	data, err := os.read_entire_file(EXAMPLES + "valid/chest.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := arena_load(data)
	if !testing.expect(t, ok) do return
	closed := fart.state_of(&doc, "closed")
	open := fart.state_of(&doc, "open")
	if !testing.expect(t, closed != nil && open != nil) do return
	lid := fart.part_of(&doc, "lid")
	// closed leaves offset out: the lid's pivot lands on itself
	testing.expect_value(t, closed.parts[1].offset, lid.pivot)
	testing.expect_value(t, closed.parts[1].offset, fart.V2{-8, -5})
	// open says where explicitly; untouched
	testing.expect_value(t, open.parts[0].offset, fart.V2{-8, -5})
	testing.expect_value(t, open.parts[0].rotate, f32(-2.4))
}

@(test)
version_gate :: proc(t: ^testing.T) {
	_, ok0 := arena_load(transmute([]byte)string(`{"name": "no version"}`))
	testing.expect(t, !ok0, "a document without a version is refused")
	_, ok2 := arena_load(transmute([]byte)string(`{"version": 2}`))
	testing.expect(t, !ok2, "a newer major is refused")
	doc, ok1 := arena_load(transmute([]byte)string(`{"version": 1}`))
	testing.expect(t, ok1, "the smallest legal document loads")
	_ = doc
}

@(test)
parents_compose :: proc(t: ^testing.T) {
	data, err := os.read_entire_file(EXAMPLES + "valid/hero.fart", context.temp_allocator)
	if !testing.expect(t, err == nil) do return
	doc, ok := arena_load(data)
	if !testing.expect(t, ok) do return
	// a quarter turn of the torso carries the head's pivot from (0,-8) to (8,0)
	poses := [?]fart.State_Part{{part = "torso", rotate = math.PI / 2}, {part = "head", offset = {0, -8}}}
	W := fart.world_xf(&doc, poses[:], "head")
	p := fart.xf_apply(W, {0, -8})
	testing.expect(t, abs(p.x - 8) < 1e-4 && abs(p.y) < 1e-4, "the head rides the torso")
	// the wave clip tweens the upper arm halfway at t = 0.15 (in-out is symmetric)
	frame := make([dynamic]fart.State_Part, context.temp_allocator)
	wave: ^fart.Clip
	for &c in doc.clips do if c.name == "wave" do wave = &c
	if !testing.expect(t, wave != nil) do return
	fart.sample_clip(&doc, wave, 0.15, &frame)
	for sp in frame do if sp.part == "upper_l" {
		testing.expect(t, abs(sp.rotate - (-0.95)) < 1e-4, "halfway to the wave")
	}
	// the loop wraps
	fart.sample_clip(&doc, wave, 0.6, &frame)
	for sp in frame do if sp.part == "upper_l" do testing.expect(t, abs(sp.rotate) < 1e-4, "back at rest")
	testing.expect_value(t, len(doc.constraints), 1)
	testing.expect_value(t, doc.constraints[0].end, "fore_l/hand")
}

// A palette swap lays a palette file over a loaded doc by name.
@(test)
palette_swap :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	art, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"palette":[{"name":"skin","rgb":[1,2,3,255]},{"name":"cloth","rgb":[4,5,6,255]}],"parts":[]}`))
	if !testing.expect(t, ok, "the art loads") do return
	swap, sok := fart.load_bytes(transmute([]byte)string(`{"version":1,"palette":[{"name":"cloth","rgb":[9,9,9,255]},{"name":"trim","rgb":[7,7,7,255]}]}`))
	if !testing.expect(t, sok, "the palette file loads") do return
	fart.apply_palette(&art, swap.palette[:])
	testing.expect(t, fart.color_of(&art, "cloth") == {9, 9, 9, 255}, "same names take the new colour")
	testing.expect(t, fart.color_of(&art, "skin") == {1, 2, 3, 255}, "the rest keep theirs")
	testing.expect(t, fart.color_of(&art, "trim") == {7, 7, 7, 255}, "new names join")
	testing.expect(t, art.palette[1].rgb == {4, 5, 6, 255}, "the file's own palette is untouched")
}

// ---- 1.2

@(test)
v12_mirror_like :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	doc, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"palette":[{"name":"c","rgb":[1,1,1,255]}],
		"parts":[{"name":"body","pivot":[0,0],"shapes":[]},
		{"name":"claw_r","parent":"body","pivot":[5,0],"shapes":[{"kind":"line","color":"c","a":[5,0],"b":[9,-2],"w":1}],"anchors":[{"name":"tip","at":[9,-2],"angle":0.5}]},
		{"name":"claw_l","like":"claw_r","parent":"body","pivot":[5,0]}],
		"states":[{"name":"idle","parts":[{"part":"body"},{"part":"claw_r"},{"part":"claw_l","mirror":true,"offset":[-5,0]}]}]}`))
	if !testing.expect(t, ok, "loads") do return
	l := fart.part_of(&doc, "claw_l")
	testing.expect(t, len(fart.shapes_of(&doc, l)) == 1, "shapes come through like")
	testing.expect(t, fart.anchor_of(&doc, l, "tip") != nil, "anchors come through like")
	testing.expect(t, fart.anchor_of(&doc, l, "tip").angle == 0.5, "the anchor's angle loads")
	st := fart.state_of(&doc, "idle")
	W := fart.world_xf(&doc, st.parts[:], "claw_l")
	p := fart.xf_apply(W, {9, -2})
	testing.expect(t, abs(p.x + 9) < 1e-3 && abs(p.y + 2) < 1e-3, "the mirrored claw lands on the other side")
	testing.expect(t, fart.xf_flipped(W), "a mirrored frame is flipped")
}

@(test)
v12_curves_events :: proc(t: ^testing.T) {
	testing.expect(t, abs(fart.bezier({0, 0, 1, 1}, 0.3) - 0.3) < 1e-3, "a straight curve is linear")
	testing.expect(t, fart.bezier({0.42, 0, 0.58, 1}, 0.25) < 0.25, "ease-in-out starts slow")
	testing.expect(t, fart.bezier({0.34, 1.56, 0.64, 1}, 0.7) > 1, "a back-out overshoots")
	context.allocator = context.temp_allocator
	doc, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"parts":[{"name":"a","shapes":[]}],
		"states":[{"name":"s","parts":[{"part":"a"}]}],
		"clips":[{"name":"walk","loop":true,"keys":[{"t":0,"state":"s","events":["plant_l"]},{"t":0.5,"state":"s","events":["plant_r"],"curve":[0.42,0,0.58,1]},{"t":1,"state":"s","events":["never"]}]}]}`))
	if !testing.expect(t, ok, "loads") do return
	c := fart.clip_of(&doc, "walk")
	testing.expect(t, len(c.keys[1].curve) == 4, "the curve loads")
	ev := make([dynamic]string)
	fart.clip_events(c, 0.1, 0.6, &ev)
	testing.expect(t, len(ev) == 1 && ev[0] == "plant_r", "an event fires when crossed")
	fart.clip_events(c, 0.6, 1.1, &ev)
	testing.expect(t, len(ev) == 2 && ev[1] == "plant_l", "the wrap fires the first key, never the last")
}

@(test)
v12_blend_layer_solve :: proc(t: ^testing.T) {
	context.allocator = context.temp_allocator
	doc, ok := fart.load_bytes(transmute([]byte)string(`{"version":1,"parts":[
		{"name":"torso","pivot":[0,0],"shapes":[]},
		{"name":"upper","parent":"torso","pivot":[0,0],"shapes":[]},
		{"name":"fore","parent":"upper","pivot":[5,0],"shapes":[],"anchors":[{"name":"hand","at":[10,0]}]}],
		"constraints":[{"name":"arm","chain":["upper","fore"],"end":"fore/hand","bend":1}],
		"states":[{"name":"a","parts":[{"part":"torso"},{"part":"upper"},{"part":"fore"}]},
		{"name":"b","parts":[{"part":"torso","rotate":1},{"part":"fore","rotate":0.5}]}]}`))
	if !testing.expect(t, ok, "loads") do return
	a, b := fart.state_of(&doc, "a"), fart.state_of(&doc, "b")
	out := make([dynamic]fart.State_Part)
	fart.blend_poses(&doc, a.parts[:], b.parts[:], 0.25, &out)
	testing.expect(t, len(out) == 3 && abs(out[0].rotate - 0.25) < 1e-4, "a blend below half keeps a's parts and tweens")
	fart.blend_poses(&doc, a.parts[:], b.parts[:], 0.75, &out)
	testing.expect(t, len(out) == 2 && abs(out[0].rotate - 0.75) < 1e-4, "above half, b's parts")
	fart.layer_poses(&doc, a.parts[:], b.parts[:], 0.5, &out)
	testing.expect(t, len(out) == 3 && abs(out[2].rotate - 0.25) < 1e-4 && out[1].rotate == 0, "a layer moves only what it names")
	poses := make([dynamic]fart.State_Part)
	append(&poses, ..a.parts[:])
	left := fart.solve_chain(&doc, &poses, &doc.constraints[0], {0, 8})
	testing.expect(t, left < 0.05, "the chain reaches")
	e, _ := fart.chain_end_world(&doc, poses[:], &doc.constraints[0])
	testing.expect(t, abs(e.x) < 0.1 && abs(e.y - 8) < 0.1, "the hand is on the target")
	host := fart.Anchor{name = "hand", at = {10, 0}, angle = math.PI / 2}
	item := fart.Anchor{name = "grip", at = {0, 3}, angle = 0}
	A := fart.attach_xf(fart.XF_ID, &host, &item)
	g := fart.xf_apply(A, {0, 3})
	testing.expect(t, abs(g.x - 10) < 1e-3 && abs(g.y) < 1e-3, "attach lands the grip on the hand")
}
