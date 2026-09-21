package main

import "testing"

func TestVersionFromConfig(t *testing.T) {
	v := appVersion()
	if v == "0.0.0" || v == "" {
		t.Fatalf("no version read from build/config.yml: %q", v)
	}
	if p := parseVersion(v); p[0] == 0 && p[1] == 0 && p[2] == 0 {
		t.Fatalf("version %q does not parse", v)
	}
}

func TestPickUpdate(t *testing.T) {
	rel := []ghRelease{
		{TagName: "format-v1.5.0", HTMLURL: "f"},
		{TagName: "studio-v0.4.0", HTMLURL: "a", Assets: []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
			Size int64  `json:"size"`
		}{{Name: "Uranus-studio-v0.4.0-macos-universal.zip", URL: "mac4", Size: 10}, {Name: "uranus-studio-v0.4.0-windows-amd64.zip", URL: "win4"}, {Name: "uranus-studio-v0.4.0-linux-amd64.tar.gz", URL: "lin4"}}},
		{TagName: "studio-v0.10.0", HTMLURL: "b", Assets: []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
			Size int64  `json:"size"`
		}{{Name: "uranus-studio-v0.10.0-macos-universal.zip", URL: "mac10"}, {Name: "uranus-studio-v0.10.0-windows-amd64.zip", URL: "win10"}, {Name: "uranus-studio-v0.10.0-linux-amd64.tar.gz", URL: "lin10"}}},
		{TagName: "studio-v0.11.0", Draft: true},
	}
	info := pickUpdate("0.4.0", rel)
	if !info.Available || info.Latest != "0.10.0" {
		t.Fatalf("0.10.0 should be newer than 0.4.0: %+v", info)
	}
	if info.AssetURL == "" || info.Asset == "" {
		t.Fatalf("no asset picked for this platform: %+v", info)
	}
	if got := pickUpdate("0.10.0", rel); got.Available {
		t.Fatalf("0.10.0 is current; nothing newer: %+v", got)
	}
	if got := pickUpdate("0.10.1", rel); got.Available {
		t.Fatalf("a newer local build sees no update: %+v", got)
	}
	if tags := sortedTags(rel); tags[0] != "studio-v0.11.0" || len(tags) != 3 {
		t.Fatalf("tags: %v", tags)
	}
	if !newer(parseVersion("1.0.0"), parseVersion("0.99.99")) || newer(parseVersion("0.4.0"), parseVersion("0.4.0")) {
		t.Fatal("version compare")
	}
}

func TestSafeJoin(t *testing.T) {
	if _, err := safeJoin("/tmp/x", "../evil"); err == nil {
		t.Fatal("an entry that escapes must be refused")
	}
	if _, err := safeJoin("/tmp/x", "Uranus.app/Contents/MacOS/Uranus"); err != nil {
		t.Fatal(err)
	}
}
