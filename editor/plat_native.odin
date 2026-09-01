#+build !js
package main

// Native platform: real disk, real argv, system fonts, a window manager
// to negotiate with. The web build gets plat_js.odin instead.

import "core:fmt"
import "core:os"
import "core:strings"
import rl "vendor:raylib"

WEB :: false

main :: proc() {
	ed_init()
	for ed_frame() {}
	ed_shutdown()
}

plat_args :: proc() -> []string {
	return os.args[1:]
}

plat_read :: proc(path: string) -> ([]byte, bool) {
	data, err := os.read_entire_file(path, context.temp_allocator)
	return data, err == nil
}

plat_write :: proc(path: string, data: []byte) -> bool {
	return os.write_entire_file(path, data) == nil
}

plat_font_path :: proc() -> cstring {
	candidates := [?]cstring {
		"/System/Library/Fonts/Supplemental/Verdana.ttf",
		"/System/Library/Fonts/Supplemental/Tahoma.ttf",
		"/System/Library/Fonts/Supplemental/Arial.ttf",
		"/System/Library/Fonts/Monaco.ttf",
	}
	for c in candidates do if os.exists(string(c)) do return c
	return nil // the embedded face steps in
}

@(private = "file")
scan_files :: proc(dir: string, out: ^[dynamic]string) {
	infos, err := os.read_all_directory_by_path(dir, context.temp_allocator)
	if err != nil do return
	for fi in infos {
		name := fi.name
		if len(name) > 0 && name[0] == '.' do continue
		full := dir == "." ? strings.clone(name) : fmt.aprintf("%s/%s", dir, name)
		if fi.type == .Directory {
			scan_files(full, out)
			delete(full)
		} else if strings.has_suffix(name, ".fart") {
			append(out, full)
		} else {
			delete(full)
		}
	}
}

plat_list :: proc(out: ^[dynamic]string) {
	scan_files(".", out)
}

// Fit the window to the monitor. macOS quietly clamps a too-tall window
// while the GL viewport keeps the asked-for size, and the top of the UI
// vanishes under the title bar. Ask for something that actually fits.
plat_window_fit :: proc() {
	mon := rl.GetCurrentMonitor()
	mw, mh := rl.GetMonitorWidth(mon), rl.GetMonitorHeight(mon)
	if mw > 0 && mh > 0 {
		w := min(i32(1360), mw - 80)
		h := min(i32(860), mh - 140)
		rl.SetWindowSize(w, h)
		rl.SetWindowPosition((mw - w) / 2, (mh - h) / 2 + 14)
	}
}
