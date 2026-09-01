package main

// A small QR encoder: version 3, error correction L, byte mode, mask 0 --
// enough to carry a LAN URL to a phone camera. Returns the 29x29 grid.

import "core:fmt"
import rl "vendor:raylib"

QR_N :: 29 // version 3

qr_matrix :: proc(text: string, m: ^[QR_N][QR_N]bool) -> bool {
	if len(text) > 53 do return false // v3-L byte-mode capacity

	// ---------------------------------------------- data bits -> 55 codewords
	cw: [70]u8
	bits := 0
	put :: proc(cw: []u8, bits: ^int, v: u32, n: int) {
		for i := n - 1; i >= 0; i -= 1 {
			if v >> u32(i) & 1 == 1 do cw[bits^ / 8] |= 1 << u32(7 - bits^ % 8)
			bits^ += 1
		}
	}
	put(cw[:], &bits, 0b0100, 4) // byte mode
	put(cw[:], &bits, u32(len(text)), 8)
	for c in transmute([]u8)text do put(cw[:], &bits, u32(c), 8)
	bits += min(4, 55 * 8 - bits) // terminator (zeros already there)
	nb := (bits + 7) / 8
	pads := [2]u8{0xEC, 0x11}
	for pi := 0; nb < 55; nb += 1 {
		cw[nb] = pads[pi]
		pi = 1 - pi
	}

	// ---------------------------------------------- Reed-Solomon, 15 ec bytes
	exp: [512]u8
	lg: [256]u8
	{
		x := 1
		for i in 0 ..< 255 {
			exp[i] = u8(x)
			lg[x] = u8(i)
			x <<= 1
			if x >= 256 do x ~= 0x11D
		}
		for i in 255 ..< 512 do exp[i] = exp[i - 255]
	}
	gmul :: proc(a, b: u8, exp: []u8, lg: []u8) -> u8 {
		if a == 0 || b == 0 do return 0
		return exp[int(lg[a]) + int(lg[b])]
	}
	// generator g(x) = prod (x - a^i), coefficients highest degree first
	gen: [16]u8
	gen[0] = 1
	glen := 1
	for i in 0 ..< 15 {
		next: [16]u8
		for j in 0 ..< glen {
			next[j] ~= gen[j] // * x
			next[j + 1] ~= gmul(gen[j], exp[i], exp[:], lg[:])
		}
		glen += 1
		gen = next
	}
	// remainder of data * x^15 mod g
	res: [70]u8
	copy(res[:55], cw[:55])
	for i in 0 ..< 55 {
		f := res[i]
		if f == 0 do continue
		for j in 0 ..< glen {
			res[i + j] ~= gmul(gen[j], f, exp[:], lg[:])
		}
	}
	copy(cw[55:70], res[55:70])

	// ---------------------------------------------- function modules
	fnc: [QR_N][QR_N]bool
	m^ = {}
	finder :: proc(m, fnc: ^[QR_N][QR_N]bool, r0, c0: int) {
		for r in -1 ..= 7 do for c in -1 ..= 7 {
			rr, cc := r0 + r, c0 + c
			if rr < 0 || rr >= QR_N || cc < 0 || cc >= QR_N do continue
			fnc[rr][cc] = true
			on := false
			if r >= 0 && r <= 6 && c >= 0 && c <= 6 {
				on = r == 0 || r == 6 || c == 0 || c == 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
			}
			m[rr][cc] = on
		}
	}
	finder(m, &fnc, 0, 0)
	finder(m, &fnc, 0, QR_N - 7)
	finder(m, &fnc, QR_N - 7, 0)
	for i in 8 ..< QR_N - 8 { // timing
		m[6][i] = i % 2 == 0
		fnc[6][i] = true
		m[i][6] = i % 2 == 0
		fnc[i][6] = true
	}
	for r in -2 ..= 2 do for c in -2 ..= 2 { // alignment at (22,22)
		rr, cc := 22 + r, 22 + c
		fnc[rr][cc] = true
		m[rr][cc] = max(abs(r), abs(c)) != 1
	}
	m[QR_N - 8][8] = true // the dark module
	fnc[QR_N - 8][8] = true

	// format info: EC level L (01), mask 000, BCH-protected, then XOR mask
	fdata := u32(0b01000)
	{
		v := fdata << 10
		for i := 14; i >= 10; i -= 1 {
			if v >> u32(i) & 1 == 1 do v ~= 0b10100110111 << u32(i - 10)
		}
		format := ((fdata << 10) | v) ~ 0b101010000010010
		// walked MSB-first: b14 lands at (8,0) and at (N-1,8)
		fpos1 := [15][2]int {
			{8, 0}, {8, 1}, {8, 2}, {8, 3}, {8, 4}, {8, 5}, {8, 7}, {8, 8},
			{7, 8}, {5, 8}, {4, 8}, {3, 8}, {2, 8}, {1, 8}, {0, 8},
		}
		for j in 0 ..< 15 {
			bit := format >> u32(14 - j) & 1 == 1
			p := fpos1[j]
			m[p[0]][p[1]] = bit
			fnc[p[0]][p[1]] = true
			if j < 7 {
				m[QR_N - 1 - j][8] = bit
				fnc[QR_N - 1 - j][8] = true
			} else {
				m[8][QR_N - 8 + (j - 7)] = bit
				fnc[8][QR_N - 8 + (j - 7)] = true
			}
		}
	}

	// ---------------------------------------------- zigzag data, mask 0
	bi := 0
	up := true
	col := QR_N - 1
	for col > 0 {
		if col == 6 do col -= 1
		for k in 0 ..< QR_N {
			row := up ? QR_N - 1 - k : k
			for cc in 0 ..< 2 {
				c := col - cc
				if fnc[row][c] do continue
				bit := false
				if bi < 70 * 8 {
					bit = cw[bi / 8] >> u32(7 - bi % 8) & 1 == 1
				}
				bi += 1
				if (row + c) % 2 == 0 do bit = !bit // mask 0
				m[row][c] = bit
			}
		}
		up = !up
		col -= 2
	}
	return true
}

// Render the grid into an Image (scaled, quiet zone included).
qr_image :: proc(text: string, module_px: int) -> (rl.Image, bool) {
	m: [QR_N][QR_N]bool
	if !qr_matrix(text, &m) do return {}, false
	q := 4 // quiet modules
	side := (QR_N + 2 * q) * module_px
	img := rl.GenImageColor(i32(side), i32(side), rl.WHITE)
	for r in 0 ..< QR_N do for c in 0 ..< QR_N do if m[r][c] {
		rl.ImageDrawRectangle(&img, i32((c + q) * module_px), i32((r + q) * module_px),
			i32(module_px), i32(module_px), rl.BLACK)
	}
	return img, true
}

// --qr <text>: write qr_test.png beside us (a dev self-test hook).
qr_selftest :: proc(text: string) {
	if img, ok := qr_image(text, 8); ok {
		rl.ExportImage(img, "qr_test.png")
		rl.UnloadImage(img)
		fmt.println("qr -> qr_test.png")
	}
}
