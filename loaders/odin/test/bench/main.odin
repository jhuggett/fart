package fastart_bench

// How long a document's meshes take to generate against reading them
// from its compiled sidecar (1.8). Build the sidecar first:
//
//   node packages/core/dist/cli.js build examples/helm
//   odin run loaders/odin/test/bench -o:speed -- examples/helm/helm.fart
//
// Each figure is the best of the runs, everything allocated from an
// arena that is emptied between them (as a game's loader would).

import "core:fmt"
import "core:os"
import "core:time"
import fart "../.."

RUNS :: 200

best :: proc(work: proc(source, glb: []byte) -> int, source, glb: []byte) -> (time.Duration, int) {
	lowest := time.Duration(1 << 62)
	n := 0
	for _ in 0 ..< RUNS {
		free_all(context.temp_allocator)
		start := time.tick_now()
		n = work(source, glb)
		lowest = min(lowest, time.tick_since(start))
	}
	return lowest, n
}

parse_only :: proc(source, glb: []byte) -> int {
	doc, _ := fart.load_bytes_3d(source)
	return len(doc.parts)
}

generate :: proc(source, glb: []byte) -> int {
	doc, _ := fart.load_bytes_3d(source)
	meshes := make([dynamic]fart.Tri_Mesh)
	for &part in doc.parts do fart.flatten_part(&doc, &part, &meshes)
	n := 0
	for &m in meshes do n += len(m.positions) / 3
	return n
}

// the sidecar's arrays as they lie: what a renderer uploads
sidecar_raw :: proc(source, glb: []byte) -> int {
	doc, _ := fart.load_bytes_3d(source)
	sc, ok := fart.load_sidecar(&doc, source, glb)
	if !ok do return -1
	n := 0
	for &m in sc.meshes do for &p in m.prims do n += len(p.positions) / 3
	return n
}

// the sidecar as flatten_part's own Tri_Meshes, in the document's frame
sidecar_flat :: proc(source, glb: []byte) -> int {
	doc, _ := fart.load_bytes_3d(source)
	sc, ok := fart.load_sidecar(&doc, source, glb)
	if !ok do return -1
	meshes := make([dynamic]fart.Tri_Mesh)
	for &part in doc.parts do fart.flatten_part_sidecar(&sc, &doc, &part, &meshes)
	n := 0
	for &m in meshes do n += len(m.positions) / 3
	return n
}

main :: proc() {
	if len(os.args) < 2 {
		fmt.eprintln("usage: bench path/to/name.fart   (with name.fart.glb beside it)")
		os.exit(2)
	}
	path := os.args[1]
	source, err := os.read_entire_file(path, context.allocator)
	if err != nil {
		fmt.eprintfln("cannot read %s", path)
		os.exit(1)
	}
	glb, gerr := os.read_entire_file(fart.sidecar_path(path), context.allocator)
	context.allocator = context.temp_allocator
	fmt.printfln("%s: %d bytes; sidecar %d bytes, %s", path, len(source), len(glb), gerr != nil ? "missing" : fart.sidecar_fresh(source, glb) ? "fresh" : "STALE")
	parse, parts := best(parse_only, source, glb)
	fmt.printfln("  load_bytes_3d alone                          %.3f ms   (%d parts)", time.duration_milliseconds(parse), parts)
	gen, gen_tris := best(generate, source, glb)
	fmt.printfln("  load_bytes_3d + flatten_part (generate)      %.3f ms   (%d triangles)", time.duration_milliseconds(gen), gen_tris)
	if gerr == nil {
		raw, raw_tris := best(sidecar_raw, source, glb)
		fmt.printfln("  load_bytes_3d + load_sidecar (use in place)  %.3f ms   (%d triangles)", time.duration_milliseconds(raw), raw_tris)
		flat, flat_tris := best(sidecar_flat, source, glb)
		fmt.printfln("  load_bytes_3d + flatten_part_sidecar         %.3f ms   (%d triangles)", time.duration_milliseconds(flat), flat_tris)
		fmt.printfln("  meshes alone: generating %.3f ms, sidecar in place %.3f ms, sidecar as Tri_Meshes %.3f ms", time.duration_milliseconds(gen - parse), time.duration_milliseconds(raw - parse), time.duration_milliseconds(flat - parse))
	}
}
