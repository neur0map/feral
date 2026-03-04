package glamour

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var sampleMarkdown = `# Welcome to Glamour

This is a **markdown** renderer in your terminal.

## Features

- Bold and *italic* text
- Code blocks
- Lists like this one

## Code Example

` + "```go" + `
func main() {
    fmt.Println("Hello, Glamour!")
}
` + "```" + `

> Blockquotes work too!

---

*Powered by Bubble Tea*
`

type Model struct {
	viewport viewport.Model
	ready    bool
}

func New() Model { return Model{} }

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		if !m.ready {
			m.viewport = viewport.New(msg.Width, msg.Height-2)
			m.viewport.SetContent(renderMarkdown(sampleMarkdown))
			m.ready = true
		} else {
			m.viewport.Width = msg.Width
			m.viewport.Height = msg.Height - 2
		}
	}
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	if !m.ready {
		return "\n  Loading..."
	}
	return fmt.Sprintf("%s\n\033[2m  ↑/↓: scroll • q: quit\033[0m", m.viewport.View())
}

func renderMarkdown(md string) string {
	// Simple markdown rendering using ANSI codes
	var b strings.Builder
	lines := strings.Split(md, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "# ") {
			b.WriteString("\033[1;38;5;205m" + line[2:] + "\033[0m\n")
		} else if strings.HasPrefix(line, "## ") {
			b.WriteString("\033[1;38;5;141m" + line[3:] + "\033[0m\n")
		} else if strings.HasPrefix(line, "> ") {
			b.WriteString("\033[38;5;241m│ " + line[2:] + "\033[0m\n")
		} else if strings.HasPrefix(line, "- ") {
			b.WriteString("  \033[38;5;205m•\033[0m " + line[2:] + "\n")
		} else if strings.HasPrefix(line, "---") {
			b.WriteString("\033[2m" + strings.Repeat("─", 40) + "\033[0m\n")
		} else {
			b.WriteString(line + "\n")
		}
	}
	return b.String()
}
