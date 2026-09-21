package main

import (
	"os"
	"strings"
	"testing"
)

// Against GitHub itself: run with FASTART_LIVE=1. Checks the latest studio
// release is seen, and that the download and unpack path works up to the
// install, which a bare test binary rightly refuses.
func TestUpdateLive(t *testing.T) {
	if os.Getenv("FASTART_LIVE") == "" {
		t.Skip("FASTART_LIVE=1 to talk to GitHub")
	}
	s := &ProjectService{}
	info, err := s.UpdateCheck()
	if err != nil {
		t.Fatal(err)
	}
	if info.Latest == "" || info.Current == "" {
		t.Fatalf("no versions: %+v", info)
	}
	t.Logf("current %s latest %s available %v asset %s (%d bytes)", info.Current, info.Latest, info.Available, info.Asset, info.Size)
	os.Setenv("FASTART_VERSION", "0.1.0")
	defer os.Unsetenv("FASTART_VERSION")
	old, err := s.UpdateCheck()
	if err != nil {
		t.Fatal(err)
	}
	if !old.Available || old.AssetURL == "" {
		t.Fatalf("0.1.0 should see an update with an asset: %+v", old)
	}
	err = s.UpdateApply(old.AssetURL)
	if err == nil || !strings.Contains(err.Error(), "not an app bundle") {
		t.Fatalf("expected the install to refuse a bare binary after a good download and unpack, got %v", err)
	}
}
