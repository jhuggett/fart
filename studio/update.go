package main

// Self-update: the app knows its version (the build config it was made
// from is embedded), asks GitHub for the studio releases, and when a
// newer one has a build for this machine, downloads it, swaps itself
// out and relaunches. The frontend shows a badge and asks; nothing
// happens on its own beyond the check.
//
// Layout of a release (see .github/workflows/release.yml): the tag
// studio-vX.Y.Z carries uranus-<tag>-macos-universal.zip (an .app),
// uranus-<tag>-windows-amd64.zip (Uranus.exe) and
// uranus-<tag>-linux-amd64.tar.gz (Uranus). FASTART_VERSION overrides the
// version the app believes it is, to try the flow against an older tag.

import (
	_ "embed"
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

//go:embed build/config.yml
var buildConfig string

const releasesURL = "https://api.github.com/repos/jhuggett/fart/releases?per_page=30"

// Version: the app's own, from the build config (info.version), or FASTART_VERSION.
func appVersion() string {
	if v := os.Getenv("FASTART_VERSION"); v != "" {
		return v
	}
	inInfo := false
	for _, line := range strings.Split(buildConfig, "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "info:") {
			inInfo = true
			continue
		}
		if inInfo && !strings.HasPrefix(line, " ") && t != "" {
			inInfo = false
		}
		if inInfo && strings.HasPrefix(t, "version:") {
			if m := regexp.MustCompile(`"([^"]+)"`).FindStringSubmatch(t); m != nil {
				return m[1]
			}
		}
	}
	return "0.0.0"
}

func (s *ProjectService) Version() string { return appVersion() }

// semver as three numbers; anything else is 0.0.0
func parseVersion(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimPrefix(v, "studio-v"), "v")
	var out [3]int
	for i, p := range strings.SplitN(v, ".", 3) {
		if i > 2 {
			break
		}
		n, _ := strconv.Atoi(strings.TrimFunc(p, func(r rune) bool { return r < '0' || r > '9' }))
		out[i] = n
	}
	return out
}

func newer(a, b [3]int) bool {
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}

// What this platform's asset is called, by suffix (the prefix's case has varied).
func assetSuffix() string {
	switch runtime.GOOS {
	case "darwin":
		return "-macos-universal.zip"
	case "windows":
		return "-windows-" + runtime.GOARCH + ".zip"
	default:
		return "-linux-" + runtime.GOARCH + ".tar.gz"
	}
}

type ghRelease struct {
	TagName string `json:"tag_name"`
	HTMLURL string `json:"html_url"`
	Body    string `json:"body"`
	Draft   bool   `json:"draft"`
	Assets  []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
		Size int64  `json:"size"`
	} `json:"assets"`
}

type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	// the release page, and the asset for this machine ("" when the release has none)
	URL      string `json:"url"`
	AssetURL string `json:"assetUrl"`
	Asset    string `json:"asset"`
	Size     int64  `json:"size"`
	Notes    string `json:"notes"`
}

// pickUpdate: the newest studio release in the list, against the current version.
func pickUpdate(current string, releases []ghRelease) UpdateInfo {
	info := UpdateInfo{Current: current}
	cur := parseVersion(current)
	best := -1
	for i, r := range releases {
		if r.Draft || !strings.HasPrefix(r.TagName, "studio-v") {
			continue
		}
		if best < 0 || newer(parseVersion(r.TagName), parseVersion(releases[best].TagName)) {
			best = i
		}
	}
	if best < 0 {
		info.Latest = current
		return info
	}
	r := releases[best]
	info.Latest = strings.TrimPrefix(r.TagName, "studio-v")
	info.URL = r.HTMLURL
	info.Notes = r.Body
	info.Available = newer(parseVersion(r.TagName), cur)
	suffix := assetSuffix()
	for _, a := range r.Assets {
		if strings.HasSuffix(strings.ToLower(a.Name), suffix) {
			info.AssetURL = a.URL
			info.Asset = a.Name
			info.Size = a.Size
		}
	}
	return info
}

// UpdateCheck asks GitHub. Available is true when a newer studio release exists;
// AssetURL is empty when it has no build for this machine yet (the workflow may still be running).
func (s *ProjectService) UpdateCheck() (UpdateInfo, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequest("GET", releasesURL, nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "uranus/"+appVersion())
	resp, err := client.Do(req)
	if err != nil {
		return UpdateInfo{Current: appVersion()}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return UpdateInfo{Current: appVersion()}, fmt.Errorf("GitHub answered %s", resp.Status)
	}
	var releases []ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return UpdateInfo{Current: appVersion()}, err
	}
	return pickUpdate(appVersion(), releases), nil
}

// UpdateProgress: what the frontend shows while an update lands.
type UpdateProgress struct {
	Phase   string `json:"phase"` // download | unpack | install | done | error
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
	Message string `json:"message"`
}

func (s *ProjectService) progress(p UpdateProgress) {
	if s.app != nil {
		s.app.Event.Emit("update", p)
	}
}

// UpdateApply downloads the asset and installs it in place of this app.
// On macOS the .app bundle is replaced; on Linux the binary; on Windows
// the binary is swapped by a helper after the app quits. Relaunch with
// UpdateRelaunch when it reports done.
func (s *ProjectService) UpdateApply(assetURL string) error {
	if assetURL == "" {
		return errors.New("no build for this machine in that release yet")
	}
	fail := func(err error) error {
		s.progress(UpdateProgress{Phase: "error", Message: err.Error()})
		return err
	}
	tmp, err := os.MkdirTemp("", "uranus-update-")
	if err != nil {
		return fail(err)
	}
	// download
	client := &http.Client{Timeout: 10 * time.Minute}
	req, _ := http.NewRequest("GET", assetURL, nil)
	req.Header.Set("User-Agent", "uranus/"+appVersion())
	resp, err := client.Do(req)
	if err != nil {
		return fail(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fail(fmt.Errorf("download failed: %s", resp.Status))
	}
	archive := filepath.Join(tmp, filepath.Base(assetURL))
	f, err := os.Create(archive)
	if err != nil {
		return fail(err)
	}
	var done int64
	buf := make([]byte, 256*1024)
	last := time.Now()
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				return fail(werr)
			}
			done += int64(n)
			if time.Since(last) > 100*time.Millisecond {
				s.progress(UpdateProgress{Phase: "download", Done: done, Total: resp.ContentLength})
				last = time.Now()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			return fail(rerr)
		}
	}
	f.Close()
	s.progress(UpdateProgress{Phase: "download", Done: done, Total: done})
	// unpack
	s.progress(UpdateProgress{Phase: "unpack"})
	unpacked := filepath.Join(tmp, "unpacked")
	if err := os.MkdirAll(unpacked, 0o755); err != nil {
		return fail(err)
	}
	if err := unpack(archive, unpacked); err != nil {
		return fail(err)
	}
	// install
	s.progress(UpdateProgress{Phase: "install"})
	if err := installUpdate(unpacked); err != nil {
		return fail(err)
	}
	s.progress(UpdateProgress{Phase: "done", Message: "installed; restart to finish"})
	return nil
}

// unpack: a zip (macOS, Windows) or a tar.gz (Linux) into dir. On macOS
// ditto keeps the bundle's permissions and symlinks exactly.
func unpack(archive, dir string) error {
	if runtime.GOOS == "darwin" && strings.HasSuffix(archive, ".zip") {
		out, err := exec.Command("ditto", "-x", "-k", archive, dir).CombinedOutput()
		if err != nil {
			return fmt.Errorf("ditto: %s", strings.TrimSpace(string(out)))
		}
		return nil
	}
	if strings.HasSuffix(archive, ".zip") {
		r, err := zip.OpenReader(archive)
		if err != nil {
			return err
		}
		defer r.Close()
		for _, zf := range r.File {
			target, err := safeJoin(dir, zf.Name)
			if err != nil {
				return err
			}
			if zf.FileInfo().IsDir() {
				if err := os.MkdirAll(target, 0o755); err != nil {
					return err
				}
				continue
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			rc, err := zf.Open()
			if err != nil {
				return err
			}
			w, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, zf.Mode()|0o600)
			if err != nil {
				rc.Close()
				return err
			}
			_, err = io.Copy(w, rc)
			rc.Close()
			w.Close()
			if err != nil {
				return err
			}
		}
		return nil
	}
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		target, err := safeJoin(dir, h.Name)
		if err != nil {
			return err
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			w, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(h.Mode)|0o600)
			if err != nil {
				return err
			}
			_, err = io.Copy(w, tr)
			w.Close()
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func safeJoin(dir, name string) (string, error) {
	target := filepath.Join(dir, name)
	if !strings.HasPrefix(target, filepath.Clean(dir)+string(os.PathSeparator)) && target != filepath.Clean(dir) {
		return "", fmt.Errorf("archive entry escapes: %s", name)
	}
	return target, nil
}

// bundlePath: the .app this binary runs from (macOS), or "" when it is a bare binary.
func bundlePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	exe, _ = filepath.EvalSymlinks(exe)
	// …/Uranus.app/Contents/MacOS/Uranus
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if strings.HasSuffix(app, ".app") {
		return app
	}
	return ""
}

func findUnpacked(dir string, want func(path string, info os.FileInfo) bool) string {
	found := ""
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if want(path, info) {
			found = path
			if info.IsDir() {
				return filepath.SkipDir
			}
		}
		return nil
	})
	return found
}

// installUpdate puts the unpacked build where this one is.
func installUpdate(unpacked string) error {
	switch runtime.GOOS {
	case "darwin":
		app := bundlePath()
		if app == "" {
			return errors.New("this Uranus is not an app bundle (a development build?); install the release by hand")
		}
		fresh := findUnpacked(unpacked, func(p string, i os.FileInfo) bool { return i.IsDir() && strings.HasSuffix(p, ".app") })
		if fresh == "" {
			return errors.New("the download holds no .app")
		}
		old := app + ".old-" + strconv.FormatInt(time.Now().Unix(), 10)
		if err := os.Rename(app, old); err != nil {
			return fmt.Errorf("could not move the old app aside: %w", err)
		}
		// the same volume, or a copy
		if err := os.Rename(fresh, app); err != nil {
			if out, cerr := exec.Command("ditto", fresh, app).CombinedOutput(); cerr != nil {
				os.Rename(old, app)
				return fmt.Errorf("could not put the new app in place: %s", strings.TrimSpace(string(out)))
			}
		}
		// what you asked for is not a stranger's download: no quarantine on it
		exec.Command("xattr", "-dr", "com.apple.quarantine", app).Run()
		os.RemoveAll(old)
		return nil
	case "windows":
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		fresh := findUnpacked(unpacked, func(p string, i os.FileInfo) bool { return !i.IsDir() && strings.EqualFold(filepath.Ext(p), ".exe") })
		if fresh == "" {
			return errors.New("the download holds no .exe")
		}
		next := exe + ".new"
		if err := copyFile(fresh, next); err != nil {
			return err
		}
		// a running .exe cannot be replaced: a helper swaps it once we have quit (see UpdateRelaunch)
		return nil
	default:
		exe, err := os.Executable()
		if err != nil {
			return err
		}
		exe, _ = filepath.EvalSymlinks(exe)
		fresh := findUnpacked(unpacked, func(p string, i os.FileInfo) bool { return !i.IsDir() && i.Mode()&0o111 != 0 })
		if fresh == "" {
			return errors.New("the download holds no binary")
		}
		next := exe + ".new"
		if err := copyFile(fresh, next); err != nil {
			return err
		}
		os.Chmod(next, 0o755)
		old := exe + ".old"
		os.Remove(old)
		if err := os.Rename(exe, old); err != nil {
			return err
		}
		if err := os.Rename(next, exe); err != nil {
			os.Rename(old, exe)
			return err
		}
		os.Remove(old)
		return nil
	}
}

func copyFile(from, to string) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(to, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	return out.Close()
}

// UpdateRelaunch starts the installed build and quits this one.
func (s *ProjectService) UpdateRelaunch() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	switch runtime.GOOS {
	case "darwin":
		app := bundlePath()
		if app == "" {
			return errors.New("not an app bundle")
		}
		// open waits for us to be gone before the new one shows: -n forces a fresh instance
		cmd := exec.Command("sh", "-c", `sleep 1; open -n "$0"`, app)
		if err := cmd.Start(); err != nil {
			return err
		}
	case "windows":
		next := exe + ".new"
		if _, err := os.Stat(next); err != nil {
			return errors.New("no update is waiting")
		}
		script := fmt.Sprintf(`timeout /t 2 /nobreak >nul & move /y "%s" "%s" & start "" "%s"`, next, exe, exe)
		cmd := exec.Command("cmd", "/c", script)
		if err := cmd.Start(); err != nil {
			return err
		}
	default:
		cmd := exec.Command("sh", "-c", `sleep 1; "$0" &`, exe)
		if err := cmd.Start(); err != nil {
			return err
		}
	}
	go func() {
		time.Sleep(300 * time.Millisecond)
		if s.app != nil {
			s.app.Quit()
		} else {
			os.Exit(0)
		}
	}()
	return nil
}

// for tests and the CLI: the assets a release list offers this machine
func sortedTags(releases []ghRelease) []string {
	out := []string{}
	for _, r := range releases {
		if strings.HasPrefix(r.TagName, "studio-v") {
			out = append(out, r.TagName)
		}
	}
	sort.Slice(out, func(i, j int) bool { return newer(parseVersion(out[i]), parseVersion(out[j])) })
	return out
}
