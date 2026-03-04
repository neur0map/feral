package realtime

import (
	"fmt"
	"math/rand"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type dataMsg float64

func listenForData() tea.Cmd {
	return tea.Tick(time.Second, func(time.Time) tea.Msg {
		return dataMsg(rand.Float64() * 100)
	})
}

type Model struct {
	values  []float64
	current float64
}

func New() Model { return Model{} }

func (m Model) Init() tea.Cmd { return listenForData() }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case dataMsg:
		m.current = float64(msg)
		m.values = append(m.values, m.current)
		if len(m.values) > 20 {
			m.values = m.values[1:]
		}
		return m, listenForData()
	}
	return m, nil
}

func (m Model) View() string {
	s := "\n  Realtime Data\n\n"
	s += fmt.Sprintf("  Current: \033[38;5;205m%.1f\033[0m\n\n", m.current)
	for _, v := range m.values {
		bars := int(v / 5)
		s += fmt.Sprintf("  \033[38;5;205m%s\033[0m %.1f\n", repeat("▮", bars), v)
	}
	s += "\n  \033[2mq: quit\033[0m\n"
	return s
}

func repeat(s string, n int) string {
	r := ""
	for i := 0; i < n; i++ {
		r += s
	}
	return r
}
