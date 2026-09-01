#+build !js
package main

// Server mode: hand the editor to another screen. Serves the wasm build of
// this same editor over the LAN, plus a tiny file API the web editor reads
// and writes through. A game hot-reloading the same directory sees every
// stroke. No cloud, no dependency: one thread, one port, plain HTTP.

import "core:encoding/json"
import "core:fmt"
import "core:net"
import "core:strconv"
import "core:strings"
import "core:thread"
import rl "vendor:raylib"

SRV_PORT :: 4747

// The web editor rides inside the native binary (built by build_web.sh).
SRV_INDEX := #load("../web_out/index.html")
SRV_JS := #load("../web_out/index.js")
SRV_WASM := #load("../web_out/index.wasm")
SRV_ODINJS := #load("../web_out/odin.js")

Serve_State :: struct {
	on:     bool,
	url:    string,
	qr:     rl.Texture2D,
	qr_ok:  bool,
	failed: bool,
}
g_srv: Serve_State

serve_start :: proc() {
	if g_srv.on || g_srv.failed do return
	sock, err := net.listen_tcp(net.Endpoint{address = net.IP4_Any, port = SRV_PORT})
	if err != nil {
		g_srv.failed = true
		return
	}
	g_srv.url = fmt.aprintf("http://%s:%d", lan_ip(), SRV_PORT)
	if img, ok := qr_image(g_srv.url, 6); ok {
		g_srv.qr = rl.LoadTextureFromImage(img)
		rl.UnloadImage(img)
		g_srv.qr_ok = true
	}
	g_srv.on = true
	t := thread.create_and_start_with_poly_data(sock, serve_loop)
	_ = t
}

@(private = "file")
lan_ip :: proc() -> string {
	ifaces, err := net.enumerate_interfaces(context.temp_allocator)
	if err == nil {
		for i in ifaces {
			for lease in i.unicast {
				if a4, ok := lease.address.(net.IP4_Address); ok {
					if a4[0] == 127 do continue // loopback
					if a4[0] == 169 && a4[1] == 254 do continue // link-local
					return fmt.aprintf("%d.%d.%d.%d", a4[0], a4[1], a4[2], a4[3])
				}
			}
		}
	}
	return "127.0.0.1"
}

@(private = "file")
serve_loop :: proc(sock: net.TCP_Socket) {
	for {
		client, _, aerr := net.accept_tcp(sock)
		if aerr != nil do continue
		handle(client)
		net.close(client)
		free_all(context.temp_allocator)
	}
}

@(private = "file")
send_all :: proc(client: net.TCP_Socket, data: []byte) {
	sent := 0
	for sent < len(data) {
		n, err := net.send_tcp(client, data[sent:])
		if err != nil || n <= 0 do return
		sent += n
	}
}

@(private = "file")
respond :: proc(client: net.TCP_Socket, status: string, ctype: string, body: []byte) {
	head := fmt.tprintf(
		"HTTP/1.1 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
		status, ctype, len(body))
	send_all(client, transmute([]byte)head)
	send_all(client, body)
}

// Only tame relative paths get through: the server owns one directory.
@(private = "file")
path_ok :: proc(p: string) -> bool {
	if len(p) == 0 || len(p) > 300 do return false
	if p[0] == '/' || p[0] == '.' do return false
	if strings.contains(p, "..") do return false
	for c in p {
		switch c {
		case 'a' ..= 'z', 'A' ..= 'Z', '0' ..= '9', '/', '.', '_', '-', '~':
		case:
			return false
		}
	}
	return true
}

@(private = "file")
url_decode :: proc(s: string) -> string {
	if !strings.contains(s, "%") do return s
	b := strings.builder_make(context.temp_allocator)
	i := 0
	for i < len(s) {
		if s[i] == '%' && i + 2 < len(s) {
			if v, ok := strconv.parse_int(s[i + 1:i + 3], 16); ok {
				strings.write_byte(&b, u8(v))
				i += 3
				continue
			}
		}
		strings.write_byte(&b, s[i])
		i += 1
	}
	return strings.to_string(b)
}

@(private = "file")
handle :: proc(client: net.TCP_Socket) {
	buf := make([dynamic]u8, context.temp_allocator)
	tmp: [4096]u8
	hdr_end := -1
	for hdr_end < 0 && len(buf) < 1 << 20 {
		n, err := net.recv_tcp(client, tmp[:])
		if err != nil || n <= 0 do break
		append(&buf, ..tmp[:n])
		if idx := strings.index(string(buf[:]), "\r\n\r\n"); idx >= 0 do hdr_end = idx
	}
	if hdr_end < 0 do return
	head := string(buf[:hdr_end])
	line0 := head
	if nl := strings.index(line0, "\r\n"); nl >= 0 do line0 = line0[:nl]
	parts := strings.split(line0, " ", context.temp_allocator)
	if len(parts) < 2 do return
	method, target := parts[0], parts[1]

	// body (PUT): read Content-Length worth past the header
	clen := 0
	for line in strings.split_lines_iterator(&head) {
		if strings.has_prefix(strings.to_lower(line, context.temp_allocator), "content-length:") {
			v := strings.trim_space(line[15:])
			clen, _ = strconv.parse_int(v)
		}
	}
	body_start := hdr_end + 4
	for len(buf) - body_start < clen && len(buf) < 16 << 20 {
		n, err := net.recv_tcp(client, tmp[:])
		if err != nil || n <= 0 do break
		append(&buf, ..tmp[:n])
	}
	body := buf[body_start:]

	route, query := target, ""
	if q := strings.index(target, "?"); q >= 0 {
		route, query = target[:q], target[q + 1:]
	}
	qpath := ""
	if strings.has_prefix(query, "path=") do qpath = url_decode(query[5:])

	switch {
	case method == "GET" && (route == "/" || route == "/index.html"):
		respond(client, "200 OK", "text/html; charset=utf-8", SRV_INDEX)
	case method == "GET" && route == "/index.js":
		respond(client, "200 OK", "application/javascript", SRV_JS)
	case method == "GET" && route == "/index.wasm":
		respond(client, "200 OK", "application/wasm", SRV_WASM)
	case method == "GET" && route == "/odin.js":
		respond(client, "200 OK", "application/javascript", SRV_ODINJS)
	case method == "GET" && route == "/api/list":
		found := make([dynamic]string, context.temp_allocator)
		plat_list(&found)
		data, jerr := json.marshal(found[:], {}, context.temp_allocator)
		if jerr != nil do respond(client, "500 No", "text/plain", {})
		else do respond(client, "200 OK", "application/json", data)
	case method == "GET" && route == "/api/file" && path_ok(qpath):
		if data, ok := plat_read(qpath); ok {
			respond(client, "200 OK", "application/octet-stream", data)
		} else do respond(client, "404 Not Found", "text/plain", {})
	case method == "PUT" && route == "/api/file" && path_ok(qpath):
		if len(body) >= clen && plat_write(qpath, body[:clen]) {
			respond(client, "200 OK", "text/plain", {})
		} else do respond(client, "500 No", "text/plain", {})
	case:
		respond(client, "404 Not Found", "text/plain", {})
	}
}
