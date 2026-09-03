#+build !js
package main

// Native platform: real disk, real argv, system fonts, a window manager
// to negotiate with. The web build gets plat_js.odin instead.
//
// Paths the editor holds are relative to the project root (g_root); the
// seam joins them here, so browse, open, save, the scratch flush and the
// serve-mode file API all live inside the one directory. Absolute paths
// pass through untouched (the recents file, argv).

import "core:fmt"
import "core:os"
import "core:slice"
import "core:strings"
import rl "vendor:raylib"

WEB :: false

main :: proc() {
	// `fastart --icon out.png` draws the app icon, no window (build_app.sh)
	if len(os.args) >= 3 && os.args[1] == "--icon" {
		icon_write(os.args[2])
		return
	}
	app_hook_init()
	ed_init()
	for ed_frame() {}
	ed_shutdown()
}

plat_args :: proc() -> []string {
	args := os.args[1:]
	// the Finder used to tag launches with a process serial number
	if len(args) >= 1 && strings.has_prefix(args[0], "-psn") do args = args[1:]
	return args
}

@(private = "file")
rooted :: proc(path: string) -> string {
	if g_root == "" || (len(path) > 0 && path[0] == '/') do return path
	return fmt.tprintf("%s/%s", g_root, path)
}

plat_read :: proc(path: string) -> ([]byte, bool) {
	data, err := os.read_entire_file(rooted(path), context.temp_allocator)
	return data, err == nil
}

plat_write :: proc(path: string, data: []byte) -> bool {
	full := rooted(path)
	// a new file may name a folder that is not there yet ("enemies/bat")
	if d := dirname(full); d != "" && d != "." && !os.exists(d) {
		_ = os.make_directory_all(d)
	}
	return os.write_entire_file(full, data) == nil
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
scan_files :: proc(dir, rel: string, out: ^[dynamic]string) {
	infos, err := os.read_all_directory_by_path(dir, context.temp_allocator)
	if err != nil do return
	for fi in infos {
		name := fi.name
		if len(name) > 0 && name[0] == '.' do continue
		full := fmt.tprintf("%s/%s", dir, name)
		relp := rel == "" ? name : fmt.tprintf("%s/%s", rel, name)
		if fi.type == .Directory do scan_files(full, relp, out)
		else if strings.has_suffix(name, ".fart") do append(out, strings.clone(relp))
	}
}

plat_list :: proc(out: ^[dynamic]string) {
	if g_root == "" do return
	start := len(out)
	scan_files(g_root, "", out)
	slice.sort(out[start:])
}

plat_abs :: proc(path: string) -> string {
	p, err := os.get_absolute_path(path, context.temp_allocator)
	return err == nil ? p : path
}

plat_is_dir :: proc(path: string) -> bool {
	return os.is_directory(path)
}

@(private = "file")
g_home: string

plat_home :: proc() -> string {
	if g_home == "" {
		if h, err := os.user_home_dir(context.allocator); err == nil do g_home = h
	}
	return g_home
}

// No folder named: the terminal's directory is the project -- unless we
// were launched from the Finder (cwd is / or the home folder), when a
// scan of everything below would be no gift. Then the welcome screen.
plat_default_root :: proc() -> (string, bool) {
	cwd, err := os.get_working_directory(context.temp_allocator)
	if err != nil || cwd == "/" || cwd == "" || cwd == plat_home() do return "", false
	return cwd, true
}

plat_recents_path :: proc() -> string {
	dir, err := os.user_config_dir(context.temp_allocator)
	if err != nil do return ""
	return fmt.tprintf("%s/fastart/recent.txt", dir)
}

// The platform's folder dialog, via its scripting tool: modal, blocking.
// The result is caller-owned.
plat_pick_folder :: proc() -> (string, bool) {
	when ODIN_OS == .Darwin {
		cmd := []string{"osascript", "-e", "POSIX path of (choose folder with prompt \"Open a project folder\")"}
	} else {
		cmd := []string{"zenity", "--file-selection", "--directory", "--title=Open a project folder"}
	}
	state, out, _, err := os.process_exec({command = cmd}, context.temp_allocator)
	if err != nil || !state.success || state.exit_code != 0 do return "", false
	p := strings.trim_space(string(out))
	for len(p) > 1 && p[len(p) - 1] == '/' do p = p[:len(p) - 1]
	if p == "" do return "", false
	return strings.clone(p), true
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

// The app icon, drawn by the editor itself: the three primitives on the
// panel's graphite, in the palette's voice. 1024px, transparent margin.
icon_write :: proc(path: string) {
	S :: 1024
	img := rl.GenImageColor(S, S, rl.BLANK)
	defer rl.UnloadImage(img)
	plate := rl.Color{29, 29, 31, 255}
	m, rad := f32(96), f32(210)
	rl.ImageDrawRectangleRec(&img, {m + rad, m, S - 2 * (m + rad), S - 2 * m}, plate)
	rl.ImageDrawRectangleRec(&img, {m, m + rad, S - 2 * m, S - 2 * (m + rad)}, plate)
	corners := [4]rl.Vector2{{m + rad, m + rad}, {S - m - rad, m + rad}, {m + rad, S - m - rad}, {S - m - rad, S - m - rad}}
	for c in corners do rl.ImageDrawCircleV(&img, c, i32(rad), plate)
	rl.ImageDrawTriangle(&img, {500, 760}, {830, 760}, {665, 300}, {228, 118, 100, 255})
	rl.ImageDrawCircleV(&img, {400, 420}, 165, UI_ACCENT)
	rl.ImageDrawLineEx(&img, {230, 790}, {600, 250}, 44, {222, 222, 219, 255})
	rl.ExportImage(img, fmt.ctprintf("%s", path))
}
