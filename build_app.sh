#!/bin/sh
# Wrap ./fastart in a macOS app bundle: fastart.app, double-clickable, with
# an icon (the editor draws its own) and the .fart document type declared,
# so a .fart in the Finder wears the icon and opens here.
set -e
cd "$(dirname "$0")"
APP=fastart.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp fastart "$APP/Contents/MacOS/fastart"

TMP=$(mktemp -d)
./fastart --icon "$TMP/icon.png" >/dev/null 2>&1
mkdir "$TMP/fastart.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/icon.png" --out "$TMP/fastart.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$TMP/icon.png" --out "$TMP/fastart.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/fastart.iconset" -o "$APP/Contents/Resources/fastart.icns"
rm -rf "$TMP"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>fastart</string>
	<key>CFBundleDisplayName</key><string>fastart</string>
	<key>CFBundleIdentifier</key><string>com.fastart.editor</string>
	<key>CFBundleVersion</key><string>1</string>
	<key>CFBundleShortVersionString</key><string>0.1</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleExecutable</key><string>fastart</string>
	<key>CFBundleIconFile</key><string>fastart</string>
	<key>LSMinimumSystemVersion</key><string>11.0</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
	<key>NSLocalNetworkUsageDescription</key>
	<string>Serve mode hands the editor to a tablet on your network.</string>
	<key>CFBundleDocumentTypes</key>
	<array>
		<dict>
			<key>CFBundleTypeName</key><string>Fast Art document</string>
			<key>CFBundleTypeRole</key><string>Editor</string>
			<key>LSHandlerRank</key><string>Owner</string>
			<key>LSItemContentTypes</key><array><string>com.fastart.fart</string></array>
		</dict>
	</array>
	<key>UTExportedTypeDeclarations</key>
	<array>
		<dict>
			<key>UTTypeIdentifier</key><string>com.fastart.fart</string>
			<key>UTTypeDescription</key><string>Fast Art document</string>
			<key>UTTypeConformsTo</key><array><string>public.json</string></array>
			<key>UTTypeTagSpecification</key>
			<dict>
				<key>public.filename-extension</key><array><string>fart</string></array>
			</dict>
		</dict>
	</array>
</dict>
</plist>
PLIST

# ad-hoc signature, so Gatekeeper lets a local build run
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "built ./$APP"
