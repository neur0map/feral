package fullscreen

import (
	"fmt"
	"strings"

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
	if m.width == 0 || m.height == 0 {
		return ""
	}
	title := "F U L L S C R E E N"
	subtitle := fmt.Sprintf("%d × %d", m.width, m.height)
	hint := "press q to quit"

	var b strings.Builder
	topPad := m.height / 3
	for i := 0; i < topPad; i++ {
		b.WriteString("\n")
	}
	b.WriteString(center(title, m.width) + "\n\n")
	b.WriteString(center("\033[2m"+subtitle+"\033[0m", m.width) + "\n\n")
	b.WriteString(center("\033[2m"+hint+"\033[0m", m.width) + "\n")
	for i := topPad + 5; i < m.height; i++ {
		b.WriteString("\n")
	}
	return b.String()
}

func center(s string, width int) string {
	pad := (width - len(s)) / 2
	if pad < 0 {
		pad = 0
	}
	return strings.Repeat(" ", pad) + s
}
