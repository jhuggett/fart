package main

// Projects: a directory is a project, the way an IDE opens a folder. Every
// path the editor holds is relative to the project root -- the shelf lists
// what is under it, files open and save under it, serve mode serves it.
// Recent projects persist between launches and the welcome screen offers
// them back; a folder can also be picked with a dialog, dropped on the
// window, double-clicked in the Finder (a .fart opens its folder), or
// named on the command line.

import "core:fmt"
import "core:strings"
import rl "vendor:raylib"

g_root: string // absolute path of the open project; "" = none (welcome / web)
g_recent: [dynamic]string // most recent first
g_open_queue: [dynamic]string // paths the OS asked us to open (Finder, drops)
RECENT_MAX :: 12

basename :: proc(path: string) -> string {
	p := path
	for len(p) > 1 && p[len(p) - 1] == '/' do p = p[:len(p) - 1]
	for i := len(p) - 1; i >= 0; i -= 1 do if p[i] == '/' do return p[i + 1:]
	return p
}

project_name :: proc() -> string {
	return g_root == "" ? "" : basename(g_root)
}

// "~/..." for display (temp allocated).
pretty_path :: proc(path: string) -> string {
	home := plat_home()
	if home != "" && strings.has_prefix(path, home) {
		rest := path[len(home):]
		if rest == "" || rest[0] == '/' do return fmt.tprintf("~%s", rest)
	}
	return path
}

// Open a directory as the project and land on its shelf.
project_open :: proc(root: string) {
	r := root
	for len(r) > 1 && r[len(r) - 1] == '/' do r = r[:len(r) - 1]
	if ed.mode == .Edit do leave_revert()
	if g_root != "" do delete(g_root)
	g_root = strings.clone(r)
	recents_push(g_root)
	go_browse()
}

// A path from argv, a drop, or the Finder: a directory becomes the
// project. A .fart opens inside the project it already belongs to -- the
// open one, else the terminal's directory -- and failing both, its own
// folder becomes the project.
project_open_path :: proc(arg: string) -> bool {
	abs := plat_abs(arg)
	if plat_is_dir(abs) {
		project_open(abs)
		return true
	}
	if !strings.has_suffix(abs, ".fart") do return false
	root := dirname(abs)
	if root == "" do root = "/"
	if g_root != "" && under(abs, g_root) do root = g_root
	else if cwd, ok := plat_default_root(); ok && under(abs, cwd) do root = cwd
	rel := root == "/" ? abs[1:] : abs[len(root) + 1:]
	if root != g_root do project_open(root)
	open_file(rel)
	return true
}

under :: proc(path, dir: string) -> bool {
	return len(path) > len(dir) + 1 && strings.has_prefix(path, dir) && path[len(dir)] == '/'
}

// The folder dialog. It blocks (a modal, as the platform's would).
project_pick :: proc() {
	if p, ok := plat_pick_folder(); ok {
		project_open(p)
		delete(p)
	}
}

// Anything the OS handed us since the last frame: the first opens.
open_queue_drain :: proc() -> bool {
	if len(g_open_queue) == 0 do return false
	opened := project_open_path(g_open_queue[0])
	for p in g_open_queue do delete(p)
	clear(&g_open_queue)
	return opened
}

go_browse :: proc() {
	if ed.mode == .Edit do leave_revert()
	ed.mode = .Browse
	ed.scroll = 0
	browse_refresh()
	title_refresh()
}

go_welcome :: proc() {
	if ed.mode == .Edit do leave_revert()
	ed.mode = .Welcome
	title_refresh()
}

title_refresh :: proc() {
	name := project_name()
	switch ed.mode {
	case .Welcome:
		rl.SetWindowTitle("fastart")
	case .Browse:
		rl.SetWindowTitle(name == "" ? "fastart" : fmt.ctprintf("%s — fastart", name))
	case .Edit:
		if name == "" do rl.SetWindowTitle(fmt.ctprintf("%s — fastart", ed.path))
		else do rl.SetWindowTitle(fmt.ctprintf("%s — %s — fastart", ed.path, name))
	}
}

// ------------------------------------------------------------- recents

recents_load :: proc() {
	p := plat_recents_path()
	if p == "" do return
	data, ok := plat_read(p)
	if !ok do return
	it := string(data)
	for line in strings.split_lines_iterator(&it) {
		l := strings.trim_space(line)
		if l == "" do continue
		if len(g_recent) >= RECENT_MAX do break
		append(&g_recent, strings.clone(l))
	}
}

recents_save :: proc() {
	p := plat_recents_path()
	if p == "" do return
	b := strings.builder_make(context.temp_allocator)
	for r in g_recent {
		strings.write_string(&b, r)
		strings.write_byte(&b, '\n')
	}
	_ = plat_write(p, transmute([]byte)strings.to_string(b))
}

recents_forget :: proc(root: string) {
	for r, k in g_recent do if r == root {
		delete(r)
		ordered_remove(&g_recent, k)
		break
	}
}

recents_push :: proc(root: string) {
	recents_forget(root)
	inject_at(&g_recent, 0, strings.clone(root))
	for len(g_recent) > RECENT_MAX do delete(pop(&g_recent))
	recents_save()
}

// ------------------------------------------------------------- welcome

welcome_frame :: proc(W, H: f32) {
	rl.BeginDrawing()
	scale_begin()
	rl.ClearBackground(UI_BG)
	rl.DrawRectangleRec({0, 0, W, TB_H}, UI_PANEL)
	hairline(0, TB_H - 1, W)
	txt("fastart", 16, (TB_H - FS_BIG) / 2 - 1, FS_BIG, UI_ACCENT)
	txt("the Fast Art Format editor", 16 + txt_w("fastart", FS_BIG) + 16, (TB_H - FS_BODY) / 2, FS_BODY, UI_DIM)

	// left: start
	x, y := f32(64), f32(TB_H + 64)
	header("START", x, y)
	y += 30
	if ui_button({x, y, 168, 34}, "Open Folder...") do project_pick()
	txt("Cmd+O", x + 180, y + (34 - FS_SMALL) / 2, FS_SMALL, UI_FAINT)
	y += 54
	txt("A folder is a project: every .fart inside it, one shelf.", x, y, FS_BODY, UI_DIM)
	y += 20
	txt("Drop a folder or a .fart file on this window to open it.", x, y, FS_BODY, UI_DIM)
	y += 20
	txt("From a terminal: fastart <folder>  or  fastart thing.fart", x, y, FS_BODY, UI_DIM)

	// right: recent projects
	rx := max(W * 0.48, x + 480)
	ry := f32(TB_H + 64)
	header("RECENT", rx, ry)
	ry += 30
	rw := W - rx - 64
	forget, open := -1, -1
	if len(g_recent) == 0 {
		txt("Projects you open will show up here.", rx, ry + 4, FS_BODY, UI_FAINT)
	}
	for r, k in g_recent {
		row := rl.Rectangle{rx - 10, ry, rw, 44}
		if row.y + row.height > H do break
		hov := ui_hov(row)
		if hov do rl.DrawRectangleRounded(row, 0.2, 4, {255, 255, 255, 8})
		txt(fmt.ctprintf("%s", basename(r)), rx, ry + 6, FS_BODY, hov ? UI_ACCENT : UI_TEXT)
		txt(fmt.ctprintf("%s", pretty_path(r)), rx, ry + 25, FS_SMALL, UI_FAINT)
		if hov {
			if ui_button({row.x + row.width - 34, ry + 10, 24, 24}, "x", ghost = true) do forget = k
			else if g_tap do open = k
		}
		ry += 48
	}
	if forget >= 0 {
		delete(g_recent[forget])
		ordered_remove(&g_recent, forget)
		recents_save()
	} else if open >= 0 {
		p := g_recent[open]
		if plat_is_dir(p) do project_open(p)
		else {
			// gone from disk: stop offering it
			delete(p)
			ordered_remove(&g_recent, open)
			recents_save()
		}
	}
	if ed.prompt_on do prompt_frame(W, H)
	rl.EndDrawing()
}
