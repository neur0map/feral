package menu

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var choices = []struct {
	label string
	event string
}{
	{"Start Game", "start"},
	{"Settings", "settings"},
	{"Quit", "quit"},
}

// Model is the Bubble Tea model for the menu screen.
type Model struct {
	cursor int
	width  int
	height int
}

// New returns an initialized menu Model.
func New() Model {
	return Model{}
}

// Init returns no initial command.
func (m Model) Init() tea.Cmd {
	return nil
}

// Update handles keypresses and window-size events.
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(choices)-1 {
				m.cursor++
			}
		case "enter":
			return m, feralkit.EmitEvent(choices[m.cursor].event)
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the menu with a cursor indicator.
func (m Model) View() string {
	if m.width == 0 || m.height == 0 {
		return ""
	}

	purple := "\033[38;5;141m"
	green := "\033[38;5;114m"
	dim := "\033[2m"
	reset := "\033[0m"

	var b strings.Builder

	// Vertical centering
	contentHeight := len(choices) + 4 // title + blank + choices + blank + hint
	topPad := (m.height - contentHeight) / 3
	if topPad < 0 {
		topPad = 0
	}
	for i := 0; i < topPad; i++ {
		b.WriteString("\n")
	}

	// Title
	title := "M E N U"
	b.WriteString(centerLine(purple+title+reset, len(title), m.width) + "\n\n")

	// Menu items
	for i, c := range choices {
		cursor := "  "
		style := dim
		if i == m.cursor {
			cursor = green + "▸ " + reset
			style = ""
		}
		line := cursor + style + c.label + reset
		visLen := 2 + len(c.label)
		b.WriteString(centerLine(line, visLen, m.width) + "\n")
	}

	// Hint
	b.WriteString("\n")
	hint := "↑/↓ navigate  ⏎ select"
	b.WriteString(centerLine(dim+hint+reset, len(hint), m.width) + "\n")

	// Fill remaining
	used := topPad + contentHeight
	for i := used; i < m.height; i++ {
		b.WriteString("\n")
	}

	return b.String()
}

func centerLine(s string, visibleLen, width int) string {
	if visibleLen >= width {
		return s
	}
	pad := (width - visibleLen) / 2
	return fmt.Sprintf("%s%s", strings.Repeat(" ", pad), s)
}
