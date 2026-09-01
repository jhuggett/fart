#+build js
package main

// Web platform: files live on the serving machine. The page's boot script
// fetches every .fart into a JS map before the wasm starts; writes update
// the map and stream back over the wire (PUT /api/file), where the server
// puts them on disk -- and a game watching that disk hot-reloads.

import "core:strings"

WEB :: true

foreign import fart_env "fart_env"

@(default_calling_convention = "contextless")
foreign fart_env {
	jf_count :: proc() -> i32 ---
	jf_path :: proc(i: i32, buf: [^]u8, cap: i32) -> i32 ---
	jf_size :: proc(p: [^]u8, n: i32) -> i32 ---
	jf_read :: proc(p: [^]u8, n: i32, out: [^]u8) ---
	jf_write :: proc(p: [^]u8, n: i32, d: [^]u8, dn: i32) ---
}

plat_args :: proc() -> []string {
	return {}
}

plat_read :: proc(path: string) -> ([]byte, bool) {
	sz := jf_size(raw_data(path), i32(len(path)))
	if sz < 0 do return nil, false
	buf := make([]byte, int(sz), context.temp_allocator)
	if sz > 0 do jf_read(raw_data(path), i32(len(path)), raw_data(buf))
	return buf, true
}

plat_write :: proc(path: string, data: []byte) -> bool {
	jf_write(raw_data(path), i32(len(path)), raw_data(data), i32(len(data)))
	return true
}

plat_font_path :: proc() -> cstring {
	return nil // always the embedded face
}

plat_list :: proc(out: ^[dynamic]string) {
	buf: [512]u8
	for i in 0 ..< jf_count() {
		l := jf_path(i, &buf[0], 512)
		if l > 0 do append(out, strings.clone(string(buf[:l])))
	}
}

plat_window_fit :: proc() {
	// the canvas is the window; the page tells us its size via web_resize
}
