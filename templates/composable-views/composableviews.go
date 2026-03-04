package composableviews

import (
	"fmt"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	"github.com/charmbracelet/bubbles/timer"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

type activeView int

const (
	timerView activeView = iota
	spinnerView
)

type Model struct {
	active  activeView
	timer   timer.Model
	spinner spinner.Model
}

func New() Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
	return Model{
		timer:   timer.NewWithInterval(30*time.Second, time.Second),
		spinner: s,
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.timer.Init(), m.spinner.Tick)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case "tab":
			if m.active == timerView {
				m.active = spinnerView
			} else {
				m.active = timerView
			}
		}
	}
	var cmd tea.Cmd
	switch m.active {
	case timerView:
		m.timer, cmd = m.timer.Update(msg)
	case spinnerView:
		m.spinner, cmd = m.spinner.Update(msg)
	}
	return m, cmd
}

func (m Model) View() string {
	var content string
	switch m.active {
	case timerView:
		content = fmt.Sprintf("  Timer: %s", m.timer.View())
	case spinnerView:
		content = fmt.Sprintf("  %s Loading...", m.spinner.View())
	}
	return fmt.Sprintf("\n%s\n\n  \033[2mtab: switch view • q: quit\033[0m\n", content)
}
