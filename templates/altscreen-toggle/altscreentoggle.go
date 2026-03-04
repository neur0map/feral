package altscreentoggle

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	altscreen bool
	width     int
	height    int
}

func New() Model { return Model{altscreen: true} }

func (m Model) Init() tea.Cmd { return tea.EnterAltScreen }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case " ":
			if m.altscreen {
				m.altscreen = false
				return m, tea.ExitAltScreen
			}
			m.altscreen = true
			return m, tea.EnterAltScreen
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) View() string {
	mode := "inline"
	if m.altscreen {
		mode = "altscreen"
	}
	return fmt.Sprintf("\n  Mode: \033[38;5;205m%s\033[0m\n\n  \033[2mspace: toggle • q: quit\033[0m\n", mode)
}
