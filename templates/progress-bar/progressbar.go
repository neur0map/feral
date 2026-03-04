package progressbar

import (
	"fmt"
	"strings"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

const (
	padding  = 2
	maxWidth = 80
)

type tickMsg time.Time

func tickCmd() tea.Cmd {
	return tea.Tick(time.Millisecond*100, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

type Model struct {
	progress progress.Model
	percent  float64
	width    int
}

func New() Model {
	return Model{
		progress: progress.New(progress.WithDefaultGradient()),
	}
}

func (m Model) Init() tea.Cmd {
	return tickCmd()
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.progress.Width = msg.Width - padding*2 - 4
		if m.progress.Width > maxWidth {
			m.progress.Width = maxWidth
		}
	case tickMsg:
		if m.percent >= 1.0 {
			return m, feralkit.EmitEvent("done")
		}
		m.percent += 0.02
		if m.percent > 1.0 {
			m.percent = 1.0
		}
		return m, tickCmd()
	case progress.FrameMsg:
		progressModel, cmd := m.progress.Update(msg)
		m.progress = progressModel.(progress.Model)
		return m, cmd
	}
	return m, nil
}

func (m Model) View() string {
	pad := strings.Repeat(" ", padding)
	return fmt.Sprintf("\n%s%s\n\n%s\033[2mq: quit\033[0m\n",
		pad, m.progress.ViewAs(m.percent),
		pad,
	)
}
