package windowsize

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	width  int
	height int
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
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) View() string {
	return fmt.Sprintf(
		"\n  Window Size\n\n  Width:  \033[38;5;205m%d\033[0m\n  Height: \033[38;5;205m%d\033[0m\n\n  \033[2mResize to see changes • q: quit\033[0m\n",
		m.width, m.height,
	)
}
