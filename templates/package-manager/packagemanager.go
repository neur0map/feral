package packagemanager

import (
	"fmt"
	"math/rand"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var packages = []string{
	"bubbletea", "lipgloss", "bubbles", "glamour",
	"wish", "soft-serve", "glow", "charm",
}

type installedMsg string

func installPkg(name string) tea.Cmd {
	d := time.Millisecond * time.Duration(100+rand.Intn(500))
	return tea.Tick(d, func(time.Time) tea.Msg {
		return installedMsg(name)
	})
}

type Model struct {
	spinner   spinner.Model
	progress  progress.Model
	installed []string
	index     int
	done      bool
}

func New() Model {
	s := spinner.New()
	s.Spinner = spinner.Dot
	s.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("205"))
	return Model{
		spinner:  s,
		progress: progress.New(progress.WithDefaultGradient()),
	}
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(m.spinner.Tick, installPkg(packages[0]))
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.progress.Width = msg.Width - 8
		if m.progress.Width > 60 {
			m.progress.Width = 60
		}
	case installedMsg:
		m.installed = append(m.installed, string(msg))
		m.index++
		if m.index >= len(packages) {
			m.done = true
			return m, feralkit.EmitEvent("done")
		}
		return m, tea.Batch(installPkg(packages[m.index]))
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case progress.FrameMsg:
		p, cmd := m.progress.Update(msg)
		m.progress = p.(progress.Model)
		return m, cmd
	}
	return m, nil
}

func (m Model) View() string {
	pct := float64(m.index) / float64(len(packages))
	s := "\n  Installing packages...\n\n"
	s += fmt.Sprintf("  %s\n\n", m.progress.ViewAs(pct))
	for _, pkg := range m.installed {
		s += fmt.Sprintf("  \033[38;5;114m✓\033[0m %s\n", pkg)
	}
	if !m.done && m.index < len(packages) {
		s += fmt.Sprintf("  %s %s\n", m.spinner.View(), packages[m.index])
	}
	s += "\n  \033[2mq: quit\033[0m\n"
	return s
}
