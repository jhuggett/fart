// What kind of asset a file is, for its glyph and its tag: the kinds the
// asset browser filters by. The shell sniffs every file's kind when the
// project is listed, so this never waits for a file to be read.

import { isPaletteFile } from "@fastart/core";
import { project, type Thumb } from "../state/project.ts";
import type { AssetKind, IconName } from "./ur.tsx";
import { KIND_ICON } from "./ur.tsx";

const KINDS: readonly string[] = ["2D", "3D", "palette", "scene", "3D scene"];

export function kindOf(rel: string, t: Thumb | undefined): AssetKind {
	const known = project.kinds.value[rel];
	if (known && KINDS.includes(known)) return known as AssetKind;
	if (rel.endsWith(".shart")) return t?.space3d ? "3D scene" : "scene";
	if (t?.space3d) return "3D";
	if (t && !t.scene && isPaletteFile(t.doc)) return "palette";
	return "2D";
}

export const kindIcon = (rel: string, t: Thumb | undefined): IconName => KIND_ICON[kindOf(rel, t)];

/** The kind filter's buckets: a 3D scene is a scene. */
export const kindBucket = (k: AssetKind): "2D" | "3D" | "scene" | "palette" => (k === "3D scene" ? "scene" : k === "texture" ? "2D" : k);
