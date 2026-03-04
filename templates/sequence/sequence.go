package sequence

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type stepMsg int

func runStep(step int) tea.Cmd {
	return func() tea.Msg {
		time.Sleep(500 * time.Millisecond)
		return stepMsg(step)
	}
}

type Model struct {
	step   int
	done   bool
	status []string
}

func New() Model {
	return Model{
		status: []string{
			"Preparing...",
			"Building...",
			"Testing...",
			"Deploying...",
			"Done!",
		},
	}
}

func (m Model) Init() tea.Cmd { return runStep(0) }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case stepMsg:
		m.step = int(msg) + 1
		if m.step >= len(m.status) {
			m.done = true
			return m, feralkit.EmitEvent("done")
		}
		return m, runStep(m.step)
	}
	return m, nil
}

func (m Model) View() string {
	s := "\n  Sequence\n\n"
	for i := 0; i < len(m.status) && i <= m.step; i++ {
		check := "\033[38;5;205m✓\033[0m"
		if i == m.step && !m.done {
			check = "\033[38;5;228m●\033[0m"
		}
		s += fmt.Sprintf("  %s %s\n", check, m.status[i])
	}
	s += "\n  \033[2mq: quit\033[0m\n"
	return s
}
