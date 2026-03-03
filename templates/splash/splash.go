package splash

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

// Model is the Bubble Tea model for the splash screen.
type Model struct {
	width  int
	height int
}

// New returns an initialized splash Model.
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
		case " ", "enter":
			return m, feralkit.EmitEvent("proceed")
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the splash screen with centered colored text.
func (m Model) View() string {
	if m.width == 0 || m.height == 0 {
		return ""
	}

	title := "F  E  R  A  L"
	subtitle := "visual flow editor for TUI apps"
	hint := "press space to continue"

	// ANSI color codes
	purple := "\033[38;5;141m"
	dim := "\033[2m"
	reset := "\033[0m"

	titleLine := purple + title + reset
	subtitleLine := dim + subtitle + reset
	hintLine := dim + hint + reset

	// Build centered content
	var b strings.Builder

	// Vertical centering: place content at ~40% from top
	topPad := (m.height - 5) / 3
	if topPad < 0 {
		topPad = 0
	}

	for i := 0; i < topPad; i++ {
		b.WriteString("\n")
	}

	b.WriteString(centerLine(titleLine, len(title), m.width) + "\n")
	b.WriteString("\n")
	b.WriteString(centerLine(subtitleLine, len(subtitle), m.width) + "\n")
	b.WriteString("\n")
	b.WriteString(centerLine(hintLine, len(hint), m.width) + "\n")

	// Fill remaining lines so alt-screen doesn't show garbage
	contentLines := topPad + 5
	for i := contentLines; i < m.height; i++ {
		b.WriteString("\n")
	}

	return b.String()
}

// centerLine pads a (possibly ANSI-colored) string so the visible text is centered.
// visibleLen is the length without ANSI escapes.
func centerLine(s string, visibleLen, width int) string {
	if visibleLen >= width {
		return s
	}
	pad := (width - visibleLen) / 2
	return fmt.Sprintf("%s%s", strings.Repeat(" ", pad), s)
}
