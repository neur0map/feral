# Feral — Architecture Design Document

**Date:** 2026-03-02
**Status:** Approved
**Scope:** Core loop — template drop, compile, preview, wire, export. AI prompt nodes deferred to Phase 2.

---

## 1. System Overview

Feral is a visual state-machine compiler for terminal applications. Users drag pre-built TUI screen templates onto a node canvas, preview them instantly in embedded terminals, wire navigation logic between screens using event edges, and export the result as a clean, idiomatic Go/Bubble Tea project.

### Layer Architecture

```
Layer 4 — Canvas & Nodes (React, @xyflow/react)
    ScreenNode, Toolbar, EventEdges, Asset Panel

Layer 3 — PTY Executor (Rust, portable-pty)
    Spawns compiled binaries (not shells), hot-reload via force-kill + respawn

Layer 2 — Build Orchestrator (Rust)
    Generates harnesses, compiles screen packages, manages versioned binaries

Layer 1 — Project Manager (Rust, filesystem)
    Go module structure, screen libraries, feralkit, graph persistence
```

---

## 2. Project Structure — Library-First Architecture

Each screen is written as a Go library. For preview, Feral auto-generates a thin harness application that imports the library and runs it. For export, harnesses are discarded and a clean root `main.go` imports all screen libraries directly.

### Why Library-First

In Go, a `package main` cannot be imported by another package. If screens were written as applications for standalone preview, they could never be stitched into a unified exported application. The library-plus-harness pattern solves both sides:

- **Preview:** Feral runs the auto-generated harness binary.
- **Export:** Feral throws away all harnesses and generates one clean `main.go` that imports all screen libraries.

### Directory Layout

```
~/.feral/projects/{project-id}/
├── go.mod                          # module feral.dev/{project-id}
├── go.sum
│
├── feralkit/                       # shared Feral runtime helpers
│   └── feralkit.go                 # EventMsg type, EmitEvent() helper
│
├── screens/                        # THE REAL CODE — all libraries
│   ├── splash/
│   │   ├── splash.go              # package splash — exports Model, New()
│   │   └── .feral.json            # metadata: template origin, node-id
│   └── filepicker/
│       ├── filepicker.go          # package filepicker — exports Model, New()
│       └── .feral.json
│
├── .harness/                       # AUTO-GENERATED, disposable, .gitignored
│   ├── splash/
│   │   └── main.go                # package main — imports splash, runs it
│   └── filepicker/
│       └── main.go                # package main — imports filepicker, runs it
│
├── .build/                         # compiled harness binaries (versioned)
│   ├── splash_1709312400          # ← PTY spawns this for preview
│   ├── splash_1709312487          # newer version after AI modification
│   └── filepicker_1709312401
│
└── graph.json                      # edge graph from React Flow canvas
```

### Screen Library Contract

Every screen library exports a Bubble Tea Model with a `New()` constructor:

```go
package splash

import tea "github.com/charmbracelet/bubbletea"

type Model struct { /* screen state */ }

func New() Model                                           { return Model{} }
func (m Model) Init() tea.Cmd                              { /* ... */ }
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd)    { /* ... */ }
func (m Model) View() string                               { /* ... */ }
```

### feralkit — Shared Event Helper

Ships with both the development project and the final export. No external dependency.

```go
package feralkit

import tea "github.com/charmbracelet/bubbletea"

// EventMsg signals a navigation event to the Feral runtime.
type EventMsg struct {
    Name string
}

// EmitEvent returns a Bubble Tea command that emits a navigation event.
func EmitEvent(name string) tea.Cmd {
    return func() tea.Msg {
        return EventMsg{Name: name}
    }
}
```

### Screen Event Declaration

Each template's `.feral.json` declares what events the screen can emit and receive:

```json
{
  "templateId": "neon-splash",
  "events": {
    "outputs": ["proceed", "quit"],
    "inputs": ["focus"]
  }
}
```

The ScreenNode reads this metadata and renders React Flow handles — one per output event on the right edge, one input handle on the left.

---

## 3. Build Orchestrator

A Rust module (`build_orchestrator.rs`) in the Tauri backend. Three operations.

### Operation 1 — `init_project(project_id)`

Called once when the user creates a new Feral project.

1. Creates directory tree: `screens/`, `feralkit/`, `.harness/`, `.build/`
2. Runs `go mod init feral.dev/{project-id}`
3. Writes `feralkit/feralkit.go`
4. Adds Bubble Tea dependency: `go get github.com/charmbracelet/bubbletea`
5. Stores project metadata in Tauri managed state

### Operation 2 — `install_screen(project_id, screen_name, template_source)`

Called when a template is dropped onto the canvas.

1. Writes template Go source to `screens/{screen_name}/{screen_name}.go`
2. Writes `.feral.json` metadata (template origin, node ID, timestamp)
3. Generates harness at `.harness/{screen_name}/main.go` — deterministic string template, no AI involved
4. Runs `go build -o .build/{screen_name}_{unix_millis} ./.harness/{screen_name}/`
5. Returns the binary path on success, or `go build` stderr on failure

### Operation 3 — `rebuild_screen(project_id, screen_name)`

Called after AI modifies a screen's source. Same as steps 3–5 of Operation 2. Returns:

```rust
struct BuildResult {
    binary_path: PathBuf,       // the new binary to spawn
    old_binaries: Vec<PathBuf>, // stale binaries to clean up after PTY swap
    stderr: Option<String>,     // populated only on compile failure
}
```

### Versioned Binaries (Hash/Timestamp Trick)

Every `go build` outputs to a unique filename: `.build/{screen_name}_{unix_millis}`. This bypasses `ETXTBSY` errors — the OS locks a binary while it's running, so writing to the same path would fail. A new filename means `go build` never touches the running binary.

Stale binary cleanup: after the PTY swap completes, glob `.build/{screen_name}_*`, sort by timestamp, delete everything except the latest.

### Concurrency Constraint

All `go build` calls are sequential per-project (Mutex per project ID) to avoid concurrent write conflicts on `go.sum`. Different projects can build in parallel.

### Harness Template

The harness is a pure function of (module_path, screen_name). 100% deterministic, no AI.

```go
// .harness/{screen_name}/main.go — auto-generated by Feral
package main

import (
    "fmt"
    "os"

    tea "github.com/charmbracelet/bubbletea"
    "feral.dev/{project-id}/feralkit"
    "{module_path}/screens/{screen_name}"
)

type wrapper struct {
    inner tea.Model
}

func (w wrapper) Init() tea.Cmd { return w.inner.Init() }
func (w wrapper) View() string  { return w.inner.View() }

func (w wrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    // Intercept navigation events — in preview, print and quit.
    if evt, ok := msg.(feralkit.EventMsg); ok {
        fmt.Fprintf(os.Stderr, "\n[feral:event:%s]\n", evt.Name)
        return w, tea.Quit
    }
    model, cmd := w.inner.Update(msg)
    w.inner = model
    return w, cmd
}

func main() {
    p := tea.NewProgram(wrapper{inner: {screen_name}.New()}, tea.WithAltScreen())
    if _, err := p.Run(); err != nil {
        os.Exit(1)
    }
}
```

---

## 4. PTY Executor — Binary Runner with Hot-Reload

### Changed from MVP

The executor no longer spawns `zsh`. It spawns a specific compiled binary path.

```rust
#[tauri::command]
fn spawn_terminal(
    id: String,
    binary_path: String,   // e.g., "~/.feral/projects/abc/.build/splash_1709312487"
    cwd: String,           // e.g., "~/.feral/projects/abc/"
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String>
```

The PTY configuration:

```rust
let mut cmd = CommandBuilder::new(&binary_path);
cmd.env("TERM", "xterm-256color");
cmd.env("LANG", "en_US.UTF-8");
cmd.cwd(&cwd);
```

No shell, no rc files, no user environment pollution. The binary is self-contained.

### Hot-Reload: `reload_terminal`

```rust
#[tauri::command]
fn reload_terminal(
    id: String,
    binary_path: String,
    cwd: String,
    app: AppHandle,
    state: State<'_, PtyState>,
) -> Result<(), String>
```

Sequence:

1. **Force-kill the old process.** Remove the `TerminalInstance` from the HashMap. Call `child.kill()` explicitly — do NOT rely on drop semantics. An AI-hallucinated infinite loop in Go code won't respond to graceful EOF. `SIGKILL` is the only guarantee.

```rust
let old_instance = {
    let mut terminals = state.terminals.lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;
    terminals.remove(&id)
};

if let Some(mut instance) = old_instance {
    let _ = instance.child.kill();  // Force-kill FIRST
    drop(instance);                 // Then drop fds to unblock reader thread
}
```

2. **Brief pause.** `thread::sleep(50ms)` to let the reader thread flush final output.

3. **Emit reload signal.** `terminal-reload-{id}` event so the frontend can call `term.reset()`.

4. **Spawn new PTY.** Identical to `spawn_terminal` — open PTY, spawn binary, clone reader, take writer, store instance, start reader thread. Same node ID, fresh process.

The frontend xterm.js instance is never destroyed during reload. It receives the reload event, clears its buffer, and starts displaying the new binary's output.

### Compound Commands

The frontend typically calls compound commands that combine build + PTY operations:

- `install_and_run_screen(project_id, screen_name, template_source, node_id)` — install template, compile, spawn PTY
- `rebuild_and_reload_screen(project_id, screen_name, node_id)` — recompile, force-kill, respawn

### Event Interception

When the PTY reader thread sees `[feral:event:{name}]` on stderr (emitted by the harness wrapper), it parses it and emits a structured Tauri event: `terminal-event-{node_id}` with payload `{ event: "proceed" }`. The frontend can highlight the corresponding edge on the canvas.

---

## 5. Node Lifecycle States

```
┌─────────┐     build succeeds     ┌─────────┐
│COMPILING │───────────────────────▶│ RUNNING  │
└─────────┘                        └────┬─────┘
                                        │
                           AI modifies source
                                        │
                                   ┌────▼──────┐    build succeeds    ┌──────────┐
                                   │RECOMPILING │───────────────────▶  │ RELOADING│
                                   └────┬───────┘                     └────┬─────┘
                                        │                                  │
                                   build fails                      swap completes
                                        │                                  │
                                   ┌────▼──────┐                     ┌────▼─────┐
                                   │COMP ERROR  │                     │ RUNNING  │
                                   └────────────┘                     └──────────┘
```

**Critical UX rule:** Compile errors never kill the running preview. If the user has a working screen running and AI introduces a syntax error, the old binary keeps running. The node header shows a warning indicator, and the `go build` stderr is available in a popover.

Frontend state:

```typescript
type ScreenState =
  | { status: "compiling" }
  | { status: "running"; binaryPath: string }
  | { status: "recompiling"; binaryPath: string }
  | { status: "reloading" }
  | { status: "error"; stderr: string }
  | { status: "exited" };
```

---

## 6. Event Wiring

### Edge Data Model

When the user draws an edge from Splash's `proceed` handle to FilePicker's input handle:

```typescript
{
  id: "edge-1",
  source: "splash-node-id",
  sourceHandle: "proceed",
  target: "filepicker-node-id",
  targetHandle: "input",
}
```

Stored in React Flow state and persisted to `graph.json` in the project directory.

### Preview Behavior

Each screen previews in isolation. Edges are visual + data only. When a screen emits an event in preview mode, the harness prints the event and quits. The frontend highlights the corresponding edge — a brief flash showing "this is the path that would fire."

The full connected state machine only runs when exported.

---

## 7. Export — Generating the Final Go Application

### Exported Structure

```
exported-project/
├── go.mod                     # user-specified module path
├── go.sum
├── main.go                    # generated state machine
├── feralkit/
│   └── feralkit.go            # EventMsg helper (no external dependency)
└── screens/
    ├── splash/
    │   └── splash.go          # copied verbatim
    └── filepicker/
        └── filepicker.go      # copied verbatim
```

No `.harness/`, `.build/`, or `.feral.json` files. Clean, `go build`-able immediately.

### Generated `main.go`

The state machine wraps all screens in a root Bubble Tea model that switches between them based on the event graph.

Given this graph:
```
Splash ──proceed──▶ FilePicker
Splash ──quit──────▶ [exit app]
FilePicker ──selected──▶ [exit app]
FilePicker ──cancelled──▶ Splash
```

Generated code:

```go
package main

import (
    "fmt"
    "os"

    tea "github.com/charmbracelet/bubbletea"
    "exported-project/feralkit"
    "exported-project/screens/filepicker"
    "exported-project/screens/splash"
)

type screenID int

const (
    screenSplash screenID = iota
    screenFilepicker
)

type model struct {
    active  screenID
    screens map[screenID]tea.Model
}

func initialModel() model {
    return model{
        active: screenSplash,
        screens: map[screenID]tea.Model{
            screenSplash:     splash.New(),
            screenFilepicker: filepicker.New(),
        },
    }
}

func (m model) Init() tea.Cmd {
    return m.screens[m.active].Init()
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    if evt, ok := msg.(feralkit.EventMsg); ok {
        next, quit := m.route(m.active, evt.Name)
        if quit {
            return m, tea.Quit
        }
        m.active = next
        m.screens[next] = m.newScreen(next)
        return m, m.screens[next].Init()
    }

    updated, cmd := m.screens[m.active].Update(msg)
    m.screens[m.active] = updated
    return m, cmd
}

func (m model) View() string {
    return m.screens[m.active].View()
}

// route maps (current screen, event) → (next screen, should quit).
// Generated from the canvas edge graph.
func (m model) route(from screenID, event string) (screenID, bool) {
    switch from {
    case screenSplash:
        switch event {
        case "proceed":
            return screenFilepicker, false
        case "quit":
            return 0, true
        }
    case screenFilepicker:
        switch event {
        case "selected":
            return 0, true
        case "cancelled":
            return screenSplash, false
        }
    }
    return from, false
}

func (m model) newScreen(id screenID) tea.Model {
    switch id {
    case screenSplash:
        return splash.New()
    case screenFilepicker:
        return filepicker.New()
    default:
        return m.screens[id]
    }
}

func main() {
    p := tea.NewProgram(initialModel(), tea.WithAltScreen())
    if _, err := p.Run(); err != nil {
        fmt.Fprintf(os.Stderr, "Error: %v\n", err)
        os.Exit(1)
    }
}
```

### Export Rust Command

```rust
#[tauri::command]
fn export_project(
    project_id: String,
    output_dir: String,
    module_path: String,   // e.g., "github.com/user/myapp"
    graph: String,         // serialized graph.json from frontend
    state: State<'_, ProjectState>,
) -> Result<(), String>
```

Steps:
1. Parse graph JSON into edge list
2. Copy `screens/` to output (skip `.feral.json` files)
3. Copy `feralkit/` to output
4. Generate `main.go` from edge list using Rust string template
5. Generate `go.mod` with user's module path
6. Run `go mod tidy` to resolve `go.sum`
7. Run `go build` as validation — report error if export doesn't compile

### Export Properties

- `route()` is a pure lookup table generated from `graph.json`
- Screens are re-instantiated on entry via `newScreen()` (no persistent state between screens — future feature)
- Module path is rewritten from `feral.dev/{project-id}` to user-specified path
- `feralkit` ships with the export — zero external Feral dependency
- The exported code is exactly what a human developer would write

---

## 8. Implementation Phases

### Phase 1 — Core Loop (current milestone)
- Layer 1: Project Manager (Go module init, screen installation, feralkit)
- Layer 2: Build Orchestrator (harness generation, versioned compilation)
- Layer 3: PTY Executor (binary runner, hot-reload with force-kill)
- Layer 4: ScreenNode component (replaces TerminalNode, compile states)
- Hardcoded templates in frontend (no marketplace yet)

### Phase 2 — AI Integration
- Prompt Node component on the canvas
- Dual-provider AI backend (Claude + Codex, OAuth token flows, no API keys)
- AI writes/modifies screen libraries only (never harnesses, never `main.go`)
- Rebuild + hot-reload pipeline triggered by AI output

### Phase 3 — Wiring & Export
- Event edge UI (handles on ScreenNodes, labeled connections)
- `graph.json` persistence
- Export command (state machine generation, module path rewrite, validation build)

### Phase 4 — Marketplace
- Community template format and registry
- Asset panel UI (search, categories, preview thumbnails)
- Template versioning and updates

---

## 9. Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Terminal node runtime | Direct binary executor | No shell pollution, no rc files, clean isolation |
| Project structure | Single Go module, per-screen packages | Maps to both canvas (one node = one package) and export (module = project) |
| Screen code pattern | Library-first with auto-generated harness | Libraries can be imported for export; harnesses provide standalone preview |
| Build artifact naming | Timestamped binaries (`{name}_{millis}`) | Bypasses ETXTBSY file lock when recompiling while binary runs in PTY |
| Process termination | Explicit `child.kill()` (SIGKILL) | Graceful EOF won't stop AI-hallucinated infinite loops in Go code |
| AI scope | Deferred to Phase 2 | Build the non-AI wiring workbench first, add AI modification later |
| AI providers | Claude + Codex, OAuth flows, no raw API keys | User's existing auth infrastructure, no key management burden |
| Preview mode | Isolated per-screen, events print and quit | Simple, no inter-process coordination, full graph only runs on export |
| Compile error handling | Never kill running preview | Old binary keeps running; error shown in popover, not terminal |
