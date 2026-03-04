# Writing Feral Templates

Each template is a directory under `templates/` containing a `template.yaml` and one or more `.go` files. When a user clicks a template card, Feral copies the Go source into the project, generates a Bubble Tea harness around it, compiles it, and runs it in a real PTY.

## Directory Layout

```
templates/{id}/
  template.yaml       # required — metadata
  {id}.go             # required — main Go source file
  ui.go               # optional — additional Go files (same package)
```

## Naming Rule (Critical)

**The directory name IS the Go package name.** Feral uses the directory name as:
- The Go `package` declaration
- The import path (`feral.dev/default/screens/{id}`)
- The function call prefix (`{id}.New()`)

Go package names cannot contain hyphens, spaces, or special characters.

| Valid         | Invalid          | Why                          |
|---------------|------------------|------------------------------|
| `simple`      | `my-template`    | Hyphens aren't valid in Go   |
| `filepicker`  | `file-picker`    | Hyphens aren't valid in Go   |
| `listdefault` | `list-default`   | Hyphens aren't valid in Go   |
| `tableresize` | `table_resize`   | Underscores work in Go but Feral expects the dir name to match the package name exactly |
| `splash`      | `Splash`         | Convention is lowercase       |

The main `.go` file must also be named `{id}.go` — matching the directory.

## template.yaml

```yaml
name: Timer                           # Display name in the gallery
category: Feedback                     # One of the categories below
description: Countdown timer with start/stop/reset   # One-line summary
framework: charm                       # TUI framework (default: charm)
outputs:                               # Events this screen can emit
  - timeout
  - quit
```

All fields except `framework` are required. If `framework` is omitted it defaults to `charm` (Charm / Bubble Tea). The field exists to enable future framework support (e.g. ratatui for Rust TUIs).

### Categories

Use one of these (order matches the gallery sidebar):

- Getting Started
- Inputs
- Lists & Tables
- Navigation
- Feedback
- Layout
- Networking
- Patterns
- System

## Go Source Requirements

Every template is a **library**, not a standalone program. Feral auto-generates a `main()` harness — you never write one.

### Minimal Example

```go
package simple

import (
    tea "github.com/charmbracelet/bubbletea"
    "feral.dev/default/feralkit"
)

type Model struct {
    width  int
    height int
}

func New() Model {
    return Model{}
}

func (m Model) Init() tea.Cmd {
    return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        switch msg.String() {
        case "enter":
            return m, feralkit.EmitEvent("select")
        case "q", "ctrl+c":
            return m, feralkit.EmitEvent("quit")
        }
    case tea.WindowSizeMsg:
        m.width = msg.Width
        m.height = msg.Height
    }
    return m, nil
}

func (m Model) View() string {
    return "Hello from Feral\n\npress enter to continue, q to quit"
}
```

### Rules

1. **Package name** — must exactly match the directory name (`package simple` in `templates/simple/`)

2. **Constructor** — must be `func New() Model`. Not `NewModel()`, not `New() *Model`, not `newModel()`. Exactly `func New() Model`.

3. **tea.Model interface** — `Model` must implement all three methods:
   - `func (m Model) Init() tea.Cmd`
   - `func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd)`
   - `func (m Model) View() string`

4. **Events** — emit navigation events with `feralkit.EmitEvent("name")`. Every event name must appear in the `outputs` list in `template.yaml`.

5. **No main()** — never write `func main()` or `package main`. The harness is generated.

6. **No os.Exit()** — use `feralkit.EmitEvent("quit")` instead. The harness handles process lifecycle.

7. **No cross-screen imports** — don't import other screens. Shared code goes in a helper file within the same package.

### feralkit

The `feralkit` package provides one type and one function:

```go
import "feral.dev/default/feralkit"

// In your Update():
return m, feralkit.EmitEvent("quit")     // emits EventMsg{Name: "quit"}
return m, feralkit.EmitEvent("proceed")  // emits EventMsg{Name: "proceed"}
```

The harness intercepts `EventMsg`, prints a marker to stderr, and exits. Feral's backend reads the marker and routes to the next screen.

### Allowed Imports

These are available in the project's `go.mod`:

```
github.com/charmbracelet/bubbletea     # aliased as tea
github.com/charmbracelet/lipgloss      # styling
github.com/charmbracelet/bubbles/*     # textinput, list, table, viewport, etc.
github.com/charmbracelet/glamour       # markdown rendering
feral.dev/default/feralkit             # event emission
```

Standard library imports (`fmt`, `strings`, `time`, `math/rand`, etc.) are always fine.

Don't import packages that aren't in go.mod — `go mod tidy` runs before build but can't resolve packages that don't exist.

## Multi-File Templates

You can split a template across multiple `.go` files. All files must declare the same package name:

```
templates/dashboard/
  template.yaml
  dashboard.go      # Model, New(), Init(), Update(), View()
  ui.go             # helper functions, styling constants
```

When installed, all `.go` files are copied to the screen directory. The main file (`{id}.go`) gets renamed to `{screen_name}.go`; other files keep their names.

## How It Works (Build Pipeline)

1. User clicks a template card in the gallery
2. Go files are copied from `templates/{id}/` to `~/.feral/projects/default/screens/{name}/`
3. Package declaration is rewritten from `package {id}` to `package {name}`
4. A harness is generated at `.harness/{name}/main.go` that imports the screen and wraps it
5. `go mod tidy` runs to resolve imports
6. `go build` compiles the harness + screen into `.build/{name}_{timestamp}`
7. The binary runs in a real PTY (portable-pty, not pipes — TUI apps need this)

## Checklist Before Committing a Template

- [ ] Directory name is a valid Go identifier (lowercase, no hyphens, no underscores)
- [ ] Main `.go` file is named `{directory_name}.go`
- [ ] `package` declaration matches directory name
- [ ] `func New() Model` exists and is exported
- [ ] Model implements `Init()`, `Update()`, `View()`
- [ ] All emitted event names appear in `outputs:` in `template.yaml`
- [ ] `template.yaml` has all required fields: `name`, `category`, `description`, `outputs` (plus optional `framework`)
- [ ] No `func main()` or `package main` anywhere
- [ ] No `os.Exit()` calls — use `feralkit.EmitEvent("quit")` instead
- [ ] Imports are limited to bubbletea, lipgloss, bubbles, glamour, stdlib, and feralkit
