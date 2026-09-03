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
