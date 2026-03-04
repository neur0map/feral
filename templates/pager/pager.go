package pager

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/viewport"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var helpStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))

type Model struct {
	viewport viewport.Model
	ready    bool
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
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		if !m.ready {
			m.viewport = viewport.New(msg.Width, msg.Height-4)
			m.viewport.SetContent(generateContent())
			m.ready = true
		} else {
			m.viewport.Width = msg.Width
			m.viewport.Height = msg.Height - 4
		}
	}
	var cmd tea.Cmd
	m.viewport, cmd = m.viewport.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	if !m.ready {
		return "\n  Initializing..."
	}
	return fmt.Sprintf("%s\n%s",
		m.viewport.View(),
		helpStyle.Render("  ↑/↓: scroll • q: quit"),
	)
}

func generateContent() string {
	var b strings.Builder
	for i := 1; i <= 100; i++ {
		b.WriteString(fmt.Sprintf("  Line %d — Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n", i))
	}
	return b.String()
}
