package debounce

import (
	"fmt"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type searchMsg string

func search(query string) tea.Cmd {
	return tea.Tick(300*time.Millisecond, func(time.Time) tea.Msg {
		return searchMsg(query)
	})
}

type Model struct {
	textInput textinput.Model
	query     string
	result    string
}

func New() Model {
	ti := textinput.New()
	ti.Placeholder = "Search..."
	ti.Focus()
	ti.Width = 30
	return Model{textInput: ti}
}

func (m Model) Init() tea.Cmd { return textinput.Blink }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case searchMsg:
		if string(msg) == m.textInput.Value() {
			m.result = fmt.Sprintf("Results for: %q", msg)
		}
	}
	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)
	if m.textInput.Value() != m.query {
		m.query = m.textInput.Value()
		return m, tea.Batch(cmd, search(m.query))
	}
	return m, cmd
}

func (m Model) View() string {
	s := fmt.Sprintf("\n  Debounced Search\n\n  %s\n\n", m.textInput.View())
	if m.result != "" {
		s += fmt.Sprintf("  \033[38;5;205m%s\033[0m\n", m.result)
	}
	s += "\n  \033[2mctrl+c: quit\033[0m\n"
	return s
}
