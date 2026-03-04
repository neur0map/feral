package http

import (
	"fmt"
	"time"

	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

type statusMsg int
type errMsg struct{ err error }

func (e errMsg) Error() string { return e.err.Error() }

func fakeRequest() tea.Cmd {
	return func() tea.Msg {
		time.Sleep(2 * time.Second)
		return statusMsg(200)
	}
}

type Model struct {
	spinner spinner.Model
	status  int
	loading bool
	err     error
}

func New() Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
	return Model{spinner: s, loading: true}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, fakeRequest())
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case statusMsg:
		m.loading = false
		m.status = int(msg)
		return m, feralkit.EmitEvent("done")
	case errMsg:
		m.loading = false
		m.err = msg.err
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	}
	return m, nil
}

func (m Model) View() string {
	if m.err != nil {
		return fmt.Sprintf("\n  \033[38;5;196mError: %s\033[0m\n\n  \033[2mq: quit\033[0m\n", m.err)
	}
	if m.loading {
		return fmt.Sprintf("\n  %s Fetching data...\n\n  \033[2mq: quit\033[0m\n", m.spinner.View())
	}
	return fmt.Sprintf("\n  \033[38;5;114m✓\033[0m Status: %d\n\n  \033[2mq: quit\033[0m\n", m.status)
}
