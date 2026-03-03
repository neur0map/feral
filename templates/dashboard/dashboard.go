package dashboard

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

// Model is the Bubble Tea model for the dashboard screen.
type Model struct {
	width  int
	height int
}

// New returns an initialized dashboard Model.
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
		case "r":
			return m, feralkit.EmitEvent("refresh")
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

// View renders the dashboard using styles from ui.go.
func (m Model) View() string {
	if m.width == 0 || m.height == 0 {
		return ""
	}

	var b strings.Builder

	// Header
	b.WriteString(RenderHeader("Dashboard", m.width))
	b.WriteString("\n\n")

	// Stats panels
	panels := []Panel{
		{Title: "Users", Value: "1,247", Delta: "+12%"},
		{Title: "Revenue", Value: "$48.2k", Delta: "+8.3%"},
		{Title: "Active", Value: "342", Delta: "-2.1%"},
	}

	panelWidth := (m.width - 4) / len(panels)
	if panelWidth < 12 {
		panelWidth = 12
	}

	var panelStrs []string
	for _, p := range panels {
		panelStrs = append(panelStrs, RenderPanel(p, panelWidth))
	}
	b.WriteString("  " + strings.Join(panelStrs, " "))
	b.WriteString("\n\n")

	// Footer
	b.WriteString(fmt.Sprintf("  %s[r]%s refresh  %s[q]%s quit",
		StyleDim, StyleReset, StyleDim, StyleReset))

	// Pad remaining height
	lines := strings.Count(b.String(), "\n") + 1
	for i := lines; i < m.height; i++ {
		b.WriteString("\n")
	}

	return b.String()
}
