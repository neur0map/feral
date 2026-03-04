package doomfire

import (
	"math/rand"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var palette = []string{
	"\033[38;5;232m", "\033[38;5;52m", "\033[38;5;88m", "\033[38;5;124m",
	"\033[38;5;160m", "\033[38;5;196m", "\033[38;5;202m", "\033[38;5;208m",
	"\033[38;5;214m", "\033[38;5;220m", "\033[38;5;226m", "\033[38;5;228m",
	"\033[38;5;230m", "\033[38;5;231m",
}

type frameMsg struct{}

func animate() tea.Cmd {
	return tea.Tick(time.Millisecond*50, func(time.Time) tea.Msg {
		return frameMsg{}
	})
}

type Model struct {
	width  int
	height int
	pixels []int
}

func New() Model { return Model{} }

func (m Model) Init() tea.Cmd { return animate() }

func (m *Model) initFire() {
	m.pixels = make([]int, m.width*m.height)
	for x := 0; x < m.width; x++ {
		m.pixels[(m.height-1)*m.width+x] = len(palette) - 1
	}
}

func (m *Model) spreadFire() {
	for y := 1; y < m.height; y++ {
		for x := 0; x < m.width; x++ {
			src := y*m.width + x
			pixel := m.pixels[src]
			if pixel == 0 {
				m.pixels[(y-1)*m.width+x] = 0
			} else {
				r := rand.Intn(3)
				dst := (y-1)*m.width + x - r + 1
				if dst < 0 {
					dst = 0
				}
				if dst >= len(m.pixels) {
					dst = len(m.pixels) - 1
				}
				m.pixels[dst] = pixel - (r & 1)
				if m.pixels[dst] < 0 {
					m.pixels[dst] = 0
				}
			}
		}
	}
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
		m.height = msg.Height - 1
		if m.height < 2 {
			m.height = 2
		}
		m.initFire()
	case frameMsg:
		if len(m.pixels) > 0 {
			m.spreadFire()
		}
		return m, animate()
	}
	return m, nil
}

func (m Model) View() string {
	if m.width == 0 || len(m.pixels) == 0 {
		return ""
	}
	var b strings.Builder
	reset := "\033[0m"
	for y := 0; y < m.height; y++ {
		for x := 0; x < m.width; x++ {
			idx := m.pixels[y*m.width+x]
			if idx < 0 {
				idx = 0
			}
			if idx >= len(palette) {
				idx = len(palette) - 1
			}
			b.WriteString(palette[idx] + "▄" + reset)
		}
		if y < m.height-1 {
			b.WriteString("\n")
		}
	}
	return b.String()
}
