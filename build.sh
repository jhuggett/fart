#!/bin/sh
set -e
cd "$(dirname "$0")"
# the native binary embeds the web editor, so that builds first
./build_web.sh
SDK="-extra-linker-flags:-isysroot $(xcrun --show-sdk-path)"
odin build editor -debug -out:fastart "$SDK"
echo "built ./fastart"
