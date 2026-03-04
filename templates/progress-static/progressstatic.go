package progressstatic

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/progress"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	progress progress.Model
	percent  float64
	width    int
}

func New() Model {
	return Model{
		progress: progress.New(progress.WithDefaultGradient()),
		percent:  0.0,
	}
}

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case "right", "l":
			m.percent += 0.1
			if m.percent > 1.0 {
				m.percent = 1.0
			}
		case "left", "h":
			m.percent -= 0.1
			if m.percent < 0.0 {
				m.percent = 0.0
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.progress.Width = msg.Width - 8
		if m.progress.Width > 80 {
			m.progress.Width = 80
		}
	}
	return m, nil
}

func (m Model) View() string {
	pad := strings.Repeat(" ", 2)
	return fmt.Sprintf("\n%s%s\n\n%s\033[2m←/→: adjust • q: quit\033[0m\n",
		pad, m.progress.ViewAs(m.percent),
		pad,
	)
}
