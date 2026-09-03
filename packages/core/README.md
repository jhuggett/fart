# @fastart/core

The Fast Art Format (`.fart`) as a library. Types, parsing and validation,
palette resolution, posing, extents, triangulation. Zero runtime
dependencies, so it is also the loader for a browser game.

    import { loadDoc, resolvePalettes, colorOf, drawList, posePoint } from "@fastart/core";

    const doc = loadDoc(text);                       // throws a FartError with the report
    const { tokens } = await resolvePalettes(doc, readRelative);
    for (const { part, sp } of drawList(doc, "open")) {
      for (const sh of part.shapes ?? []) {
        const rgba = colorOf(tokens, sh.color!);     // magenta if nobody supplies it
        // posePoint(p, part, sp) takes every point from rest space to the pose
      }
    }

`parseDoc(text)` is the non-throwing form; its report carries the same
error codes `spec/examples/manifest.json` names, so a "why won't this
load" reads the same everywhere.

The command line:

    fart validate spec/examples      # every .fart below, refs resolved, exit 1 on any failure
    fart bake enemies/bat.fart       # write tris into each poly, in place
