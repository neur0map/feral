# Feral

A visual node editor for building CLI/TUI applications. Drag, connect, and preview Go-powered terminal screens on an infinite canvas.

![Tauri v2](https://img.shields.io/badge/Tauri-v2-blue)
![React 18](https://img.shields.io/badge/React-18-61dafb)
![Go](https://img.shields.io/badge/Go-Bubble%20Tea-00ADD8)

## What It Does

Feral turns TUI development into a visual workflow:

1. **Pick a template** from the sidebar (splash, menu, dashboard, or your own)
2. **Drop it on the canvas** — it compiles and runs live in an embedded terminal
3. **Wire screens together** by drawing edges between output handles and input handles
4. **Edit code inline** with the built-in Go editor, hot-reload on save
5. **Use AI** to generate or modify screen code via a PromptNode
6. **Attach a Coder** terminal that spawns Claude Code (or any CLI assistant) scoped to a screen's directory, with automatic hot-reload
7. **Run the assembled app** or **eject** a standalone Go project

## Architecture

```
┌─────────────────────────────────────────────────┐
│  React Flow Canvas (React 18 + TypeScript)      │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  │
│  │ ScreenNode│──│ ScreenNode│  │ CoderNode  │  │
│  │ (xterm.js)│  │ (xterm.js)│  │ (xterm.js) │  │
│  └───────────┘  └───────────┘  └────────────┘  │
│  ┌───────────┐                                  │
│  │PromptNode │  AI code generation              │
│  └───────────┘                                  │
├─────────────────────────────────────────────────┤
│  Tauri v2 IPC Bridge                            │
├─────────────────────────────────────────────────┤
│  Rust Backend                                   │
│  • portable-pty (real PTY, not pipes)           │
│  • Go build orchestrator                        │
│  • notify file watcher (hot-reload)             │
│  • Multi-provider LLM client                    │
└─────────────────────────────────────────────────┘
```

**Library-first design** — screens are Go libraries (`package screenname`), not applications. A disposable harness wraps them for preview. On export, harnesses are discarded and a clean state-machine `main.go` is generated.

## Node Types

| Node | Purpose |
|------|---------|
| **ScreenNode** | Live terminal preview of a Bubble Tea screen with inline code editor |
| **PromptNode** | Send natural language prompts to AI to generate/modify connected screen code |
| **CoderNode** | Spawns a zsh terminal + CLI coding assistant scoped to a screen's Go package. File changes auto-reload the preview |
| **RunnerNode** | Ephemeral node that runs the full assembled multi-screen app |

## Prerequisites

- **macOS** (Linux support planned)
- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- [Go](https://go.dev/dl/) 1.21+
- [Tauri CLI](https://v2.tauri.app/start/prerequisites/) v2

## Getting Started

```bash
# Clone
git clone https://github.com/neur0map/feral.git
cd feral

# Install frontend dependencies
npm install

# Run in dev mode
npm run tauri dev
```

## Project Layout

```
feral/
├── src/                    # React frontend
│   ├── components/
│   │   ├── Canvas.tsx          # React Flow canvas + node orchestration
│   │   ├── TerminalNode.tsx    # Screen node (terminal + editor + AI overlay)
│   │   ├── CoderNode.tsx       # CLI coding assistant terminal
│   │   ├── PromptNode.tsx      # AI prompt node
│   │   ├── RunnerNode.tsx      # Full-app runner
│   │   ├── Toolbar.tsx         # Floating toolbar
│   │   ├── TemplateSidebar.tsx # Template picker
│   │   └── SettingsDialog.tsx  # LLM provider config
│   └── index.css               # Design system (all styles)
├── src-tauri/              # Rust backend
│   └── src/
│       ├── lib.rs              # PTY manager + Tauri wiring
│       └── project.rs          # Build orchestrator + LLM client + file watcher
├── templates/              # Built-in screen templates
│   ├── splash/
│   ├── menu/
│   └── dashboard/
└── package.json
```

## Runtime Data

Feral stores project data at `~/.feral/projects/default/`:

```
~/.feral/projects/default/
├── screens/{name}/{name}.go   # Screen source (library)
├── .harness/{name}/main.go    # Auto-generated runner (disposable)
├── .build/{name}_{timestamp}  # Compiled binaries
├── feralkit/feralkit.go       # Shared event helper
├── graph.json                 # Canvas state (nodes + edges)
├── go.mod / go.sum
```

## AI Providers

Configure in Settings (gear icon). Supported providers:

- **Anthropic** (Claude)
- **OpenAI** (GPT-4o)
- **Groq**
- **OpenRouter**
- **Ollama** (local)

## Key Bindings

| Key | Action |
|-----|--------|
| Scroll | Pan canvas |
| Pinch | Zoom |
| Backspace / Delete | Remove selected node or edge |
| Click terminal | Focus for keyboard input |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 18 + TypeScript + Vite 6 |
| Canvas | React Flow v12 |
| Terminal | xterm.js v5 + FitAddon |
| Code editor | CodeMirror 6 (Go mode) |
| Styling | TailwindCSS 3.4 |
| Backend | Rust + portable-pty 0.9 |
| File watching | notify 7 |
| TUI framework | Go / Bubble Tea |

## License

MIT
