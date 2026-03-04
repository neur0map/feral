package views

import (
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type tickMsg struct{}
type frameMsg struct{}

func tick() tea.Cmd {
	return tea.Tick(time.Second, func(time.Time) tea.Msg { return tickMsg{} })
}
func frame() tea.Cmd {
	return tea.Tick(time.Second/60, func(time.Time) tea.Msg { return frameMsg{} })
}

type Model struct {
	choice   int
	chosen   bool
	ticks    int
	frames   int
	progress float64
	loaded   bool
	width    int
	height   int
}

func New() Model {
	return Model{ticks: 10}
}

func (m Model) Init() tea.Cmd { return tick() }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	if msg, ok := msg.(tea.KeyMsg); ok {
		k := msg.String()
		if k == "q" || k == "ctrl+c" {
			return m, feralkit.EmitEvent("quit")
		}
	}
	if !m.chosen {
		return m.updateChoices(msg)
	}
	return m.updateChosen(msg)
}

func (m Model) updateChoices(msg tea.Msg) (Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "j", "down":
			m.choice++
			if m.choice > 3 {
				m.choice = 3
			}
		case "k", "up":
			m.choice--
			if m.choice < 0 {
				m.choice = 0
			}
		case "enter":
			m.chosen = true
			return m, frame()
		}
	case tickMsg:
		if m.ticks == 0 {
			return m, feralkit.EmitEvent("quit")
		}
		m.ticks--
		return m, tick()
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) updateChosen(msg tea.Msg) (Model, tea.Cmd) {
	switch msg.(type) {
	case frameMsg:
		if !m.loaded {
			m.frames++
			m.progress = float64(m.frames) / 100.0
			if m.progress >= 1 {
				m.progress = 1
				m.loaded = true
				m.ticks = 3
				return m, tick()
			}
			return m, frame()
		}
	case tickMsg:
		if m.loaded {
			if m.ticks == 0 {
				return m, feralkit.EmitEvent("quit")
			}
			m.ticks--
			return m, tick()
		}
	}
	return m, nil
}

func (m Model) View() string {
	if !m.chosen {
		return m.choicesView()
	}
	return m.chosenView()
}

func (m Model) choicesView() string {
	choices := []string{"Plant carrots", "Go to the market", "Read something", "See friends"}
	tpl := "\n  What to do today?\n\n"
	for i, c := range choices {
		if m.choice == i {
			tpl += fmt.Sprintf("  \033[38;5;212m[x] %s\033[0m\n", c)
		} else {
			tpl += fmt.Sprintf("  [ ] %s\n", c)
		}
	}
	tpl += fmt.Sprintf("\n  Program quits in \033[38;5;79m%d\033[0m seconds\n", m.ticks)
	tpl += "  \033[2mj/k: select • enter: choose • q: quit\033[0m\n"
	return tpl
}

func (m Model) chosenView() string {
	label := "Downloading..."
	if m.loaded {
		label = fmt.Sprintf("Downloaded. Exiting in %d seconds...", m.ticks)
	}
	w := 40
	filled := int(m.progress * float64(w))
	bar := "\033[38;5;205m" + strings.Repeat("█", filled) + "\033[0m" + strings.Repeat("░", w-filled)
	return fmt.Sprintf("\n  Loading resources...\n\n  %s\n\n  %s %.0f%%\n", label, bar, m.progress*100)
}
