package spinners

import (
	"fmt"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var spinnerStyles = []spinner.Spinner{
	spinner.Line,
	spinner.Dot,
	spinner.MiniDot,
	spinner.Jump,
	spinner.Pulse,
	spinner.Points,
	spinner.Globe,
	spinner.Moon,
	spinner.Monkey,
}

var spinnerNames = []string{
	"Line", "Dot", "MiniDot", "Jump", "Pulse", "Points", "Globe", "Moon", "Monkey",
}

type Model struct {
	index    int
	spinners []spinner.Model
}

func New() Model {
	m := Model{
		spinners: make([]spinner.Model, len(spinnerStyles)),
	}
	for i, style := range spinnerStyles {
		s := spinner.New()
		s.Spinner = style
		s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
		m.spinners[i] = s
	}
	return m
}

func (m Model) Init() tea.Cmd {
	cmds := make([]tea.Cmd, len(m.spinners))
	for i := range m.spinners {
		cmds[i] = m.spinners[i].Tick
	}
	return tea.Batch(cmds...)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case spinner.TickMsg:
		cmds := make([]tea.Cmd, len(m.spinners))
		for i := range m.spinners {
			m.spinners[i], cmds[i] = m.spinners[i].Update(msg)
		}
		return m, tea.Batch(cmds...)
	}
	return m, nil
}

func (m Model) View() string {
	s := "\n  Spinner Gallery\n\n"
	for i, sp := range m.spinners {
		s += fmt.Sprintf("  %s %s\n", sp.View(), spinnerNames[i])
	}
	s += "\n  \033[2mq: quit\033[0m\n"
	return s
}
