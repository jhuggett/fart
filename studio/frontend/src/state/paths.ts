// Slash paths, the way the format and the shell speak them.

export function basename(p: string): string {
	let s = p;
	while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
	const i = s.lastIndexOf("/");
	return i >= 0 ? s.slice(i + 1) : s;
}

export function dirname(p: string): string {
	const i = p.lastIndexOf("/");
	return i > 0 ? p.slice(0, i) : i === 0 ? "/" : "";
}

/** Resolve a relative reference against a directory, folding "." and "..". */
export function joinRel(dir: string, ref: string): string {
	const parts = dir ? dir.split("/") : [];
	for (const seg of ref.split("/")) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") parts.pop();
		else parts.push(seg);
	}
	return parts.join("/");
}

export function stripExt(name: string): string {
	return name.endsWith(".fart") ? name.slice(0, -5) : name;
}

export function under(path: string, dir: string): boolean {
	return path.length > dir.length + 1 && path.startsWith(dir) && path[dir.length] === "/";
}

export function pretty(path: string, home: string): string {
	if (home && path.startsWith(home) && (path.length === home.length || path[home.length] === "/")) {
		return "~" + path.slice(home.length);
	}
	return path;
}
