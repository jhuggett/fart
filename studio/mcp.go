package main

// Uranus as a tool. A small MCP server (streamable HTTP, JSON-RPC 2.0) on
// the loopback that Claude Code connects to. Every tool call is relayed
// to the page, which holds the document and does the work (reads,
// applies with undo, renders, validates); its reply is the tool result.
// The shell only carries messages, and only from this machine.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"
)

// ToolCall is what the page receives: a call to answer with ToolReply.
type ToolCall struct {
	ID   string          `json:"id"`
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

type toolRelay struct {
	mu      sync.Mutex
	pending map[string]chan string
	seq     int
	bus     *bus
}

func (r *toolRelay) call(name string, args json.RawMessage, timeout time.Duration) (string, error) {
	r.mu.Lock()
	r.seq++
	id := fmt.Sprintf("t%d", r.seq)
	ch := make(chan string, 1)
	r.pending[id] = ch
	r.mu.Unlock()
	if args == nil {
		args = json.RawMessage("{}")
	}
	r.bus.emit("tool", ToolCall{ID: id, Name: name, Args: args})
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(timeout):
		r.mu.Lock()
		delete(r.pending, id)
		r.mu.Unlock()
		return "", fmt.Errorf("the editor did not answer %s in time (is a document open?)", name)
	}
}

func (r *toolRelay) reply(id, result string) {
	r.mu.Lock()
	ch := r.pending[id]
	delete(r.pending, id)
	r.mu.Unlock()
	if ch != nil {
		ch <- result
	}
}

type MCP struct {
	url   string
	relay *toolRelay
}

// The tools, as Claude sees them. The page implements each.
var mcpTools = []map[string]any{
	{
		"name":        "get_document",
		"description": "The document open in Uranus: its path, its JSON (a .fart, format 1.x), what is selected (part and shapes), and the state or clip on the canvas. With no file open, the project's file list instead.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
	},
	{
		"name":        "apply_document",
		"description": "Replace the open document with this one: the whole document, valid format JSON. It is validated first and refused with the errors if wrong; applied as one undo step; the canvas updates at once. Say what changed in note.",
		"inputSchema": map[string]any{
			"type":     "object",
			"required": []string{"doc"},
			"properties": map[string]any{
				"doc":  map[string]any{"type": "object", "description": "the whole document"},
				"note": map[string]any{"type": "string", "description": "one line on what changed, shown to the user"},
			},
		},
	},
	{
		"name":        "render",
		"description": "A PNG of the open document: a named state, or a clip at a time in seconds, or what is on the canvas when neither is given. Look before and after a change.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"state": map[string]any{"type": "string"},
				"clip":  map[string]any{"type": "string"},
				"t":     map[string]any{"type": "number", "description": "seconds into the clip"},
				"size":  map[string]any{"type": "integer", "description": "pixels on the long side, default 512"},
			},
		},
	},
	{
		"name":        "validate",
		"description": "The validator's report (errors with codes and paths, warnings) for a document, or for the open one when none is given.",
		"inputSchema": map[string]any{
			"type":       "object",
			"properties": map[string]any{"doc": map[string]any{"type": "object"}},
		},
	},
	{
		"name":        "open_file",
		"description": "Open another .fart file of the project in the editor, by its project-relative path (as get_document lists them).",
		"inputSchema": map[string]any{
			"type":       "object",
			"required":   []string{"path"},
			"properties": map[string]any{"path": map[string]any{"type": "string"}},
		},
	},
}

func startMCP(b *bus) (*MCP, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	tok := make([]byte, 12)
	_, _ = rand.Read(tok)
	path := "/mcp/" + hex.EncodeToString(tok)
	m := &MCP{relay: &toolRelay{pending: map[string]chan string{}, bus: b}}
	m.url = fmt.Sprintf("http://%s%s", ln.Addr().String(), path)
	mux := http.NewServeMux()
	mux.HandleFunc(path, m.handle)
	go func() { _ = http.Serve(ln, mux) }()
	return m, nil
}

type rpcReq struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func (m *MCP) handle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method", 405)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 32<<20))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	var req rpcReq
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, "bad json-rpc", 400)
		return
	}
	// a notification: nothing to answer
	if len(req.ID) == 0 || string(req.ID) == "null" {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	reply := func(result any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
	}
	fail := func(code int, msg string) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": req.ID, "error": map[string]any{"code": code, "message": msg}})
	}
	switch req.Method {
	case "initialize":
		var p struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(req.Params, &p)
		if p.ProtocolVersion == "" {
			p.ProtocolVersion = "2025-06-18"
		}
		reply(map[string]any{
			"protocolVersion": p.ProtocolVersion,
			"capabilities":    map[string]any{"tools": map[string]any{}},
			"serverInfo":      map[string]any{"name": "uranus", "version": "0.3.0"},
			"instructions":    "Uranus is the editor the user is looking at. get_document, then apply_document; render to see.",
		})
	case "ping":
		reply(map[string]any{})
	case "tools/list":
		reply(map[string]any{"tools": mcpTools})
	case "tools/call":
		var p struct {
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(req.Params, &p); err != nil || p.Name == "" {
			fail(-32602, "tools/call needs a name")
			return
		}
		known := false
		for _, t := range mcpTools {
			if t["name"] == p.Name {
				known = true
			}
		}
		if !known {
			fail(-32602, "no tool named "+p.Name)
			return
		}
		res, err := m.relay.call(p.Name, p.Arguments, 90*time.Second)
		if err != nil {
			reply(map[string]any{"content": []map[string]any{{"type": "text", "text": err.Error()}}, "isError": true})
			return
		}
		// the page already shaped the result
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"jsonrpc":"2.0","id":%s,"result":%s}`, string(req.ID), res)
	default:
		fail(-32601, "no such method: "+req.Method)
	}
}
