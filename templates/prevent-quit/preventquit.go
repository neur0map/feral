package preventquit

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	confirmQuit bool
}

func New() Model { return Model{} }

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if m.confirmQuit {
			switch msg.String() {
			case "y", "Y":
				return m, feralkit.EmitEvent("quit")
			default:
				m.confirmQuit = false
			}
		} else {
			switch msg.String() {
			case "q", "ctrl+c":
				m.confirmQuit = true
			}
		}
	}
	return m, nil
}

func (m Model) View() string {
	if m.confirmQuit {
		return fmt.Sprintf("\n  \033[38;5;205mAre you sure you want to quit? (y/n)\033[0m\n")
	}
	return "\n  Press q to quit (with confirmation)\n\n  \033[2mType anything...\033[0m\n"
}
