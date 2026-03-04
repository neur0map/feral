package space

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	x, y   int
	width  int
	height int
}

func New() Model { return Model{x: 10, y: 5} }

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case "up", "k":
			if m.y > 0 {
				m.y--
			}
		case "down", "j":
			if m.y < m.height-2 {
				m.y++
			}
		case "left", "h":
			if m.x > 0 {
				m.x--
			}
		case "right", "l":
			if m.x < m.width-2 {
				m.x++
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) View() string {
	if m.width == 0 || m.height == 0 {
		return ""
	}
	var b strings.Builder
	for y := 0; y < m.height-1; y++ {
		for x := 0; x < m.width; x++ {
			if x == m.x && y == m.y {
				b.WriteString("\033[38;5;205m●\033[0m")
			} else {
				b.WriteString(" ")
			}
		}
		if y < m.height-2 {
			b.WriteString("\n")
		}
	}
	b.WriteString(fmt.Sprintf("\n\033[2m(%d,%d) hjkl: move • q: quit\033[0m", m.x, m.y))
	return b.String()
}
