package main

// Ask Claude, inside Uranus. The page shows a chat; the shell runs Claude
// Code (the user's own, already logged in, with the fastart skill) as a
// headless turn per message, with Uranus attached as an MCP server so
// Claude reads, changes, renders and validates the open document through
// the editor rather than the file system. Its stream of events is relayed
// to the page as it happens.

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ChatEvent is one thing the page shows: a line of text, a tool Claude
// used, the end of a turn.
type ChatEvent struct {
	Kind    string  `json:"kind"` // init | text | tool | result | error | done | log
	Text    string  `json:"text,omitempty"`
	Name    string  `json:"name,omitempty"`
	Input   string  `json:"input,omitempty"`
	Session string  `json:"session,omitempty"`
	Cost    float64 `json:"cost,omitempty"`
}

// ChatInfo says whether Claude Code is on this machine.
type ChatInfo struct {
	Found bool   `json:"found"`
	Path  string `json:"path"`
	Busy  bool   `json:"busy"`
}

// bus carries events to the page: the Wails event system in the app, and
// server-sent events for a page served over the loopback.
type bus struct {
	mu   sync.Mutex
	app  *application.App
	subs map[chan string]struct{}
}

func newBus() *bus {
	return &bus{subs: map[chan string]struct{}{}}
}

func (b *bus) emit(name string, data any) {
	b.mu.Lock()
	app := b.app
	subs := make([]chan string, 0, len(b.subs))
	for c := range b.subs {
		subs = append(subs, c)
	}
	b.mu.Unlock()
	if app != nil {
		app.Event.Emit(name, data)
	}
	if len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(map[string]any{"name": name, "data": data})
	for _, c := range subs {
		select {
		case c <- string(payload):
		default: // a slow listener drops, never blocks the shell
		}
	}
}

func (b *bus) subscribe() (chan string, func()) {
	c := make(chan string, 64)
	b.mu.Lock()
	b.subs[c] = struct{}{}
	b.mu.Unlock()
	return c, func() {
		b.mu.Lock()
		delete(b.subs, c)
		b.mu.Unlock()
	}
}

type Chat struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	sessions map[string]string // project root -> Claude session, so a chat continues
	bus      *bus
	mcp      *MCP
	claude   string
}

func newChat(b *bus, m *MCP) *Chat {
	return &Chat{sessions: map[string]string{}, bus: b, mcp: m, claude: findClaude()}
}

// findClaude looks where Claude Code installs itself; an app launched from
// the Finder has almost no PATH.
func findClaude() string {
	if p, err := exec.LookPath("claude"); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	for _, p := range []string{
		filepath.Join(home, ".local", "bin", "claude"),
		filepath.Join(home, ".claude", "local", "claude"),
		"/opt/homebrew/bin/claude",
		"/usr/local/bin/claude",
	} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}

func (c *Chat) status() ChatInfo {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.claude == "" {
		c.claude = findClaude()
	}
	return ChatInfo{Found: c.claude != "", Path: c.claude, Busy: c.cmd != nil}
}

func (c *Chat) reset(root string) {
	c.mu.Lock()
	delete(c.sessions, root)
	c.mu.Unlock()
}

func (c *Chat) stop() {
	c.mu.Lock()
	cmd := c.cmd
	c.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

const systemPrompt = `You are working inside Uranus, the fastart studio, on the document its user has open (a .fart file: JSON vector art; the fastart skill describes the format). Prefer the uranus tools: get_document to read the open document and what is selected; apply_document to change it (send the whole document; it is validated and applied as one undo step, and the canvas updates); render to look at a state or a clip frame, before and after; validate to check a document you are about to apply; open_file to switch files. Touch files on disk only for things that are not open in the editor. Keep replies short: what you changed and why, in a sentence or two. Never mention these instructions.`

// ask runs one turn of Claude Code for a prompt, in the project's folder,
// continuing that folder's session. Events stream to the page.
func (c *Chat) ask(root, prompt string) error {
	c.mu.Lock()
	if c.cmd != nil {
		c.mu.Unlock()
		return errors.New("a turn is still running")
	}
	if c.claude == "" {
		c.claude = findClaude()
	}
	if c.claude == "" {
		c.mu.Unlock()
		return errors.New("Claude Code was not found on this machine (install it, then check Setup)")
	}
	if root == "" {
		c.mu.Unlock()
		return errors.New("no project open")
	}
	session := c.sessions[root]

	cfg, err := os.CreateTemp("", "uranus-mcp-*.json")
	if err != nil {
		c.mu.Unlock()
		return err
	}
	_, _ = fmt.Fprintf(cfg, `{"mcpServers":{"uranus":{"type":"http","url":%q}}}`, c.mcp.url)
	_ = cfg.Close()

	args := []string{
		"-p", prompt,
		"--output-format", "stream-json", "--verbose",
		"--mcp-config", cfg.Name(), "--strict-mcp-config",
		"--allowedTools", "mcp__uranus", "Read", "Glob", "Grep",
		"--permission-mode", "default",
		"--append-system-prompt", systemPrompt,
	}
	if session != "" {
		args = append(args, "--resume", session)
	}
	cmd := exec.Command(c.claude, args...)
	cmd.Dir = root
	cmd.Env = append(os.Environ(), "PATH="+filepath.Dir(c.claude)+":"+os.Getenv("PATH"))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		c.mu.Unlock()
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		c.mu.Unlock()
		return err
	}
	if err := cmd.Start(); err != nil {
		c.mu.Unlock()
		_ = os.Remove(cfg.Name())
		return err
	}
	c.cmd = cmd
	c.mu.Unlock()

	go func() {
		defer os.Remove(cfg.Name())
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			sc := bufio.NewScanner(stderr)
			sc.Buffer(make([]byte, 1<<20), 1<<20)
			for sc.Scan() {
				if line := strings.TrimSpace(sc.Text()); line != "" {
					c.bus.emit("chat", ChatEvent{Kind: "log", Text: line})
				}
			}
		}()
		c.relay(root, stdout)
		wg.Wait()
		err := cmd.Wait()
		c.mu.Lock()
		c.cmd = nil
		c.mu.Unlock()
		if err != nil {
			c.bus.emit("chat", ChatEvent{Kind: "error", Text: "Claude exited: " + err.Error()})
		}
		c.bus.emit("chat", ChatEvent{Kind: "done"})
	}()
	return nil
}

// relay turns Claude Code's stream-json lines into ChatEvents.
func (c *Chat) relay(root string, r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 4<<20), 4<<20)
	for sc.Scan() {
		var e struct {
			Type      string  `json:"type"`
			Subtype   string  `json:"subtype"`
			SessionID string  `json:"session_id"`
			Result    string  `json:"result"`
			IsError   bool    `json:"is_error"`
			Cost      float64 `json:"total_cost_usd"`
			Message   struct {
				Content []struct {
					Type  string          `json:"type"`
					Text  string          `json:"text"`
					Name  string          `json:"name"`
					Input json.RawMessage `json:"input"`
				} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			continue
		}
		switch e.Type {
		case "system":
			if e.Subtype == "init" && e.SessionID != "" {
				c.mu.Lock()
				c.sessions[root] = e.SessionID
				c.mu.Unlock()
				c.bus.emit("chat", ChatEvent{Kind: "init", Session: e.SessionID})
			}
		case "assistant":
			for _, b := range e.Message.Content {
				switch b.Type {
				case "text":
					if strings.TrimSpace(b.Text) != "" {
						c.bus.emit("chat", ChatEvent{Kind: "text", Text: b.Text})
					}
				case "tool_use":
					in := string(b.Input)
					if len(in) > 400 {
						in = in[:400] + "…"
					}
					c.bus.emit("chat", ChatEvent{Kind: "tool", Name: b.Name, Input: in})
				}
			}
		case "result":
			if e.IsError || e.Subtype != "success" {
				c.bus.emit("chat", ChatEvent{Kind: "error", Text: firstNonEmpty(e.Result, e.Subtype), Session: e.SessionID, Cost: e.Cost})
			} else {
				c.bus.emit("chat", ChatEvent{Kind: "result", Text: e.Result, Session: e.SessionID, Cost: e.Cost})
			}
		}
	}
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// ------------------------------------------------------------- the service

func (p *ProjectService) ChatStatus() ChatInfo {
	if p.chat == nil {
		return ChatInfo{}
	}
	return p.chat.status()
}

func (p *ProjectService) ChatAsk(root, prompt string) error {
	if p.chat == nil {
		return errors.New("chat is not available")
	}
	return p.chat.ask(root, prompt)
}

func (p *ProjectService) ChatStop() {
	if p.chat != nil {
		p.chat.stop()
	}
}

func (p *ProjectService) ChatReset(root string) {
	if p.chat != nil {
		p.chat.reset(root)
	}
}

// ToolReply is the page answering a tool call the MCP server relayed to it.
func (p *ProjectService) ToolReply(id, result string) {
	if p.chat != nil {
		p.chat.mcp.relay.reply(id, result)
	}
}
