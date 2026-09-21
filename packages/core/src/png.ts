// A PNG writer with no dependencies: stored (uncompressed) deflate blocks
// inside a zlib stream, one IDAT. Big for what it holds, right everywhere;
// a build that cares pipes it through an optimiser.

import type { Raster } from "./textures.ts";

const CRC = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (const x of bytes) {
		a = (a + x) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	out.set([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)], 4);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** The raster as PNG bytes (RGBA, 8 bits). */
export function toPng(r: Raster): Uint8Array {
	const stride = r.width * 4 + 1;
	const raw = new Uint8Array(stride * r.height);
	for (let y = 0; y < r.height; y++) {
		raw[y * stride] = 0; // filter: none
		raw.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), y * stride + 1);
	}
	// zlib: header, stored blocks of up to 65535 bytes, adler
	const blocks = Math.max(1, Math.ceil(raw.length / 65535));
	const z = new Uint8Array(2 + raw.length + blocks * 5 + 4);
	z[0] = 0x78;
	z[1] = 0x01;
	let o = 2;
	for (let i = 0; i < blocks; i++) {
		const start = i * 65535;
		const len = Math.min(65535, raw.length - start);
		z[o++] = i === blocks - 1 ? 1 : 0;
		z[o++] = len & 0xff;
		z[o++] = len >> 8;
		z[o++] = ~len & 0xff;
		z[o++] = (~len >> 8) & 0xff;
		z.set(raw.subarray(start, start + len), o);
		o += len;
	}
	new DataView(z.buffer).setUint32(o, adler32(raw));
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, r.width);
	dv.setUint32(4, r.height);
	ihdr.set([8, 6, 0, 0, 0], 8);
	const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", z), chunk("IEND", new Uint8Array(0))];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
