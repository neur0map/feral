package result

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var choices = []string{"Taro", "Coffee", "Lychee"}

type Model struct {
	cursor int
	choice string
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
		case "ctrl+c", "q", "esc":
			return m, feralkit.EmitEvent("quit")
		case "enter":
			m.choice = choices[m.cursor]
			return m, feralkit.EmitEvent("quit")
		case "down", "j":
			m.cursor++
			if m.cursor >= len(choices) {
				m.cursor = 0
			}
		case "up", "k":
			m.cursor--
			if m.cursor < 0 {
				m.cursor = len(choices) - 1
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) View() string {
	if m.choice != "" {
		return fmt.Sprintf("\n  You chose: \033[38;5;212m%s\033[0m\n\n", m.choice)
	}
	var b strings.Builder
	b.WriteString("What kind of Bubble Tea would you like?\n\n")
	for i, c := range choices {
		if m.cursor == i {
			b.WriteString(fmt.Sprintf("  \033[38;5;212m(•) %s\033[0m\n", c))
		} else {
			b.WriteString(fmt.Sprintf("  ( ) %s\n", c))
		}
	}
	b.WriteString("\n  \033[2mpress q to quit\033[0m\n")
	return b.String()
}
