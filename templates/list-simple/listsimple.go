package listsimple

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var items = []string{
	"Ramen", "Tomato Soup", "Hamburgers", "Cheeseburgers",
	"Currywurst", "Okonomiyaki", "Pasta", "Falafel",
	"Fried Rice", "Cachapa",
}

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
			if m.cursor < len(items)-1 {
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
	var b strings.Builder
	b.WriteString("\n  \033[1mWhat do you want for dinner?\033[0m\n\n")
	for i, item := range items {
		cursor := "  "
		if m.cursor == i {
			cursor = "\033[38;5;205m▸ \033[0m"
		}
		b.WriteString(fmt.Sprintf("  %s%s\n", cursor, item))
	}
	b.WriteString("\n  \033[2mj/k: navigate • enter: select • q: quit\033[0m\n")
	return b.String()
}
