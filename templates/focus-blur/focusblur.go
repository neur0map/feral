package focusblur

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	focused bool
	count   int
}

func New() Model { return Model{focused: true} }

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.FocusMsg:
		m.focused = true
		m.count++
	case tea.BlurMsg:
		m.focused = false
	}
	return m, nil
}

func (m Model) View() string {
	status := "\033[38;5;205mFocused\033[0m"
	if !m.focused {
		status = "\033[2mBlurred\033[0m"
	}
	return fmt.Sprintf(
		"\n  Terminal Focus\n\n  Status: %s\n  Focus count: %d\n\n  \033[2mClick away and come back • q: quit\033[0m\n",
		status, m.count,
	)
}
