// ============================================================================
// charm.rs — Charm / Bubble Tea framework templates
// ============================================================================
//
// All Go source templates specific to the Charm ecosystem live here.
// Adding a new framework means creating a sibling module (e.g. ratatui.rs)
// rather than touching project.rs.
// ============================================================================

pub const FERALKIT_SOURCE: &str = r#"package feralkit

import tea "github.com/charmbracelet/bubbletea"

// EventMsg is emitted by screens to signal navigation transitions.
// The harness intercepts this, prints it to stderr for Feral to detect,
// and exits the program.
type EventMsg struct{ Name string }

// EmitEvent returns a tea.Cmd that fires an EventMsg.
func EmitEvent(name string) tea.Cmd {
	return func() tea.Msg { return EventMsg{Name: name} }
}
"#;

pub const GO_DEPENDENCIES: &[&str] = &[
    "github.com/charmbracelet/bubbletea@latest",
    "github.com/charmbracelet/lipgloss@latest",
    "github.com/charmbracelet/bubbles@latest",
];

pub fn harness_source(module: &str, screen_name: &str) -> String {
    format!(
        r#"package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"{module}/feralkit"
	"{module}/screens/{name}"
)

// wrapper intercepts feralkit.EventMsg before delegating to the screen.
type wrapper struct {{
	inner tea.Model
}}

func (w wrapper) Init() tea.Cmd {{
	return w.inner.Init()
}}

func (w wrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {{
	if evt, ok := msg.(feralkit.EventMsg); ok {{
		fmt.Fprintf(os.Stderr, "\n[feral:event:%s]\n", evt.Name)
		return w, tea.Quit
	}}
	m, cmd := w.inner.Update(msg)
	w.inner = m
	return w, cmd
}}

func (w wrapper) View() string {{
	return w.inner.View()
}}

func main() {{
	p := tea.NewProgram(wrapper{{inner: {name}.New()}}, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {{
		os.Exit(1)
	}}
}}
"#,
        module = module,
        name = screen_name,
    )
}

pub fn full_app_template(
    imports: &str,
    enum_lines: &str,
    new_screen_cases: &str,
    route_cases: &str,
    start_pascal: &str,
    module_path: &str,
) -> String {
    format!(
        r#"package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
{imports}
	"{module_path}/feralkit"
)

type screenID int

const (
{enum_lines}
)

func newScreen(id screenID) tea.Model {{
	switch id {{
{new_screen_cases}
	default:
		fmt.Fprintf(os.Stderr, "unknown screen: %d\n", id)
		os.Exit(1)
		return nil
	}}
}}

func route(from screenID, event string) (screenID, bool) {{
	switch from {{
{route_cases}
	}}
	return from, true
}}

type wrapper struct {{
	inner tea.Model
	event string
}}

func (w *wrapper) Init() tea.Cmd {{
	return w.inner.Init()
}}

func (w *wrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {{
	if evt, ok := msg.(feralkit.EventMsg); ok {{
		w.event = evt.Name
		return w, tea.Quit
	}}
	m, cmd := w.inner.Update(msg)
	w.inner = m
	return w, cmd
}}

func (w *wrapper) View() string {{
	return w.inner.View()
}}

func runScreen(m tea.Model) string {{
	w := &wrapper{{inner: m}}
	p := tea.NewProgram(w, tea.WithAltScreen())
	finalModel, err := p.Run()
	if err != nil {{
		fmt.Fprintf(os.Stderr, "runtime error: %v\n", err)
		os.Exit(1)
	}}
	return finalModel.(*wrapper).event
}}

func main() {{
	current := screen{start_pascal}
	for {{
		m := newScreen(current)
		event := runScreen(m)
		next, quit := route(current, event)
		if quit {{
			break
		}}
		current = next
	}}
}}
"#,
        imports = imports,
        enum_lines = enum_lines,
        new_screen_cases = new_screen_cases,
        route_cases = route_cases,
        start_pascal = start_pascal,
        module_path = module_path,
    )
}

pub fn ai_system_prompt(screen_name: &str, target_file: &str, context_section: &str) -> String {
    format!(
        "You are an expert Go developer EDITING an existing screen file for a Bubble Tea application.\n\
         CRITICAL RULES:\n\
         1. You are EDITING the existing file `{target_file}` in package `{name}`. You will receive its current code below.\n\
         2. The package MUST remain `package {name}`.\n\
         3. DO NOT write a `func main()`. This file is imported as a library.\n\
         4. DO NOT try to route to other screens or import other screens.\n\
         5. If the user asks to navigate, return `feralkit.EmitEvent(\"event_name\")` and the visual node editor will handle the routing.\n\
         6. Return ONLY valid Go code inside a markdown code block (```go). No explanations.\n\
         7. PRESERVE the existing code structure, types, functions, imports, and functionality. Only modify what is necessary to fulfill the user's request.\n\
         8. Output the COMPLETE modified file — do not use placeholders or comments like \"rest of code here\".{context}",
        name = screen_name,
        target_file = target_file,
        context = context_section,
    )
}
