#+build js
package main

// The browser entry: the page's script calls these (see web/index_template.html).

import "base:runtime"
import "core:c"
import "core:mem"

@(private = "file")
web_ctx: runtime.Context

@(export)
main_start :: proc "c" () {
	context = runtime.default_context()
	context.allocator = emscripten_allocator()
	runtime.init_global_temporary_allocator(8 * mem.Megabyte)
	web_ctx = context
	ed_init()
}

@(export)
main_update :: proc "c" () -> bool {
	context = web_ctx
	return ed_frame()
}

@(export)
main_end :: proc "c" () {
	context = web_ctx
	ed_shutdown()
}

@(export)
web_window_size_changed :: proc "c" (w: c.int, h: c.int, dpr: f32) {
	context = web_ctx
	web_resize(int(w), int(h), dpr)
}
