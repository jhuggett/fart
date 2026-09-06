#!/bin/sh
# A studio release, end to end: make release V=0.4.0
#   1. the version into the build config (and the generated assets)
#   2. a commit and the tag studio-vX.Y.Z, pushed (the tag starts the CI
#      release, which adds Windows and Linux builds when it succeeds)
#   3. the universal macOS bundle built here and published with notes,
#      so the release exists the moment this finishes
#   4. the same build installed into ~/Applications
set -e
V="$1"
case "$V" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "usage: make release V=X.Y.Z"; exit 2 ;;
esac
TAG="studio-v$V"
cd "$(dirname "$0")/.."

[ -z "$(git status --porcelain)" ] || { echo "the tree is not clean; commit first"; exit 1; }
[ "$(git branch --show-current)" = "main" ] || { echo "release from main"; exit 1; }
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "$TAG already exists"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not signed in: run gh auth login"; exit 1; }
command -v wails3 >/dev/null || { echo "wails3 is not on the PATH (make setup)"; exit 1; }

echo "== version $V"
sed -i '' "s/^  version: \".*\"/  version: \"$V\"/" studio/build/config.yml
grep -q "version: \"$V\"" studio/build/config.yml || { echo "could not set the version in studio/build/config.yml"; exit 1; }
(cd studio && wails3 task common:update:build-assets >/dev/null 2>&1)
# no asset catalog ships: the .icns is the icon
for f in studio/build/darwin/Info.plist studio/build/darwin/Info.dev.plist; do
  plutil -remove CFBundleIconName "$f" >/dev/null 2>&1 || true
done
git add studio/build
git commit -q -m "Uranus $V"
git tag -a "$TAG" -m "Uranus $V"
git push -q origin main "$TAG"
echo "== pushed $TAG (the CI release starts from it)"

echo "== building the universal bundle"
rm -f studio/bin/Uranus
rm -rf studio/bin/Uranus.app
(cd studio && wails3 task darwin:package:universal 2>&1 | grep -v "ld: warning\|sysroot\|sponsor\|documentation\|^\[" | tail -1)
lipo -info studio/bin/Uranus.app/Contents/MacOS/Uranus | grep -q "x86_64 arm64" || { echo "not a universal binary"; exit 1; }
# the same name the workflow uses, so its build replaces this one rather than clashing
ZIP="uranus-$TAG-macos-universal.zip"
rm -f "/tmp/$ZIP"
ditto -c -k --keepParent studio/bin/Uranus.app "/tmp/$ZIP"

echo "== publishing"
PREV=$(git describe --tags --match 'studio-v*' --abbrev=0 "$TAG^" 2>/dev/null || true)
NOTES=$(mktemp)
{
  echo "Uranus, the fastart studio. It emits farts."
  echo
  echo "**macOS (universal, Apple silicon and Intel).** The bundle is ad-hoc signed: on first launch, right-click → Open (or run \`xattr -d com.apple.quarantine Uranus.app\`). Windows and Linux builds are added by the release workflow when it finishes."
  echo
  if [ -n "$PREV" ]; then
    echo "## Since $PREV"
    echo
    git log --no-merges --format='- %s' "$PREV..$TAG^" | grep -v "^- Uranus " | head -60
  fi
} > "$NOTES"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release upload "$TAG" "/tmp/$ZIP" --clobber
else
  gh release create "$TAG" "/tmp/$ZIP#Uranus $V for macOS (universal)" --title "Uranus $V" --notes-file "$NOTES"
fi
rm -f "$NOTES"
gh release view "$TAG" --json url --jq .url

echo "== installing"
mkdir -p "$HOME/Applications"
pkill -x Uranus 2>/dev/null || true
rsync -a --delete studio/bin/Uranus.app/ "$HOME/Applications/Uranus.app/"
touch "$HOME/Applications/Uranus.app"
echo "installed $HOME/Applications/Uranus.app at $V"
