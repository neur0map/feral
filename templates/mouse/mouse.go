package mouse

import (
	"fmt"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	lastEvent string
	mouseX    int
	mouseY    int
}

func New() Model { return Model{lastEvent: "none"} }

func (m Model) Init() tea.Cmd { return tea.EnableMouseAllMotion }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.MouseMsg:
		m.mouseX = msg.X
		m.mouseY = msg.Y
		switch msg.Type {
		case tea.MouseLeft:
			m.lastEvent = "left click"
		case tea.MouseRight:
			m.lastEvent = "right click"
		case tea.MouseMiddle:
			m.lastEvent = "middle click"
		case tea.MouseWheelUp:
			m.lastEvent = "wheel up"
		case tea.MouseWheelDown:
			m.lastEvent = "wheel down"
		case tea.MouseMotion:
			m.lastEvent = "motion"
		case tea.MouseRelease:
			m.lastEvent = "release"
		}
	}
	return m, nil
}

func (m Model) View() string {
	return fmt.Sprintf(
		"\n  Mouse Events\n\n  Position: (%d, %d)\n  Last: \033[38;5;205m%s\033[0m\n\n  \033[2mq: quit\033[0m\n",
		m.mouseX, m.mouseY, m.lastEvent,
	)
}
