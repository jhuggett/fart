// @fastart/core: the Fast Art Format (.fart) as a library. Types, parsing
// and validation, palette resolution, posing, extents, triangulation. No
// rendering: that is fifty lines in whatever you draw with, and
// drawList() + colorOf() + posePoint() are those fifty lines' inputs.

export * from "./types.ts";
export * from "./validate.ts";
export * from "./parse.ts";
export * from "./palette.ts";
export * from "./geometry.ts";
