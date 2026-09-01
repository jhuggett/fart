#!/bin/sh
# Build the web editor into web_out/ (the native binary embeds and serves it).
set -e
cd "$(dirname "$0")"
OUT=web_out
mkdir -p $OUT

odin build editor -target:js_wasm32 -build-mode:obj \
  -define:RAYLIB_WASM_LIB=env.o \
  -vet -strict-style -o:speed -out:$OUT/ed.wasm.obj

cp "$(odin root)/core/sys/wasm/js/odin.js" $OUT/

emcc -o $OUT/index.html \
  $OUT/ed.wasm.obj web/lib/libraylib.web.a \
  -sUSE_GLFW=3 -sWASM_BIGINT -sWARN_ON_UNDEFINED_SYMBOLS=0 \
  -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=1mb \
  --shell-file web/index_template.html

rm $OUT/ed.wasm.obj
echo "web editor in $OUT/"
