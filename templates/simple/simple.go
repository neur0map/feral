package simple

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var choices = []string{"Plant carrots", "Go to the market", "Read something", "See friends"}

type Model struct {
	cursor int
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
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(choices)-1 {
				m.cursor++
			}
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
	if m.width == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("What should we do today?\n\n")
	for i, choice := range choices {
		cursor := "  "
		if m.cursor == i {
			cursor = "\033[38;5;212m▸ \033[0m"
		}
		b.WriteString(fmt.Sprintf("%s%s\n", cursor, choice))
	}
	b.WriteString("\n\033[2mj/k: navigate • enter: select • q: quit\033[0m\n")
	return b.String()
}
