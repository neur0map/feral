package tabs

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

type Model struct {
	Tabs      []string
	Content   []string
	activeTab int
	width     int
}

func New() Model {
	return Model{
		Tabs:    []string{"Lip Gloss", "Blush", "Eye Shadow", "Mascara", "Foundation"},
		Content: []string{"Lip Gloss content", "Blush content", "Eye Shadow content", "Mascara content", "Foundation content"},
	}
}

func (m Model) Init() tea.Cmd { return nil }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, feralkit.EmitEvent("quit")
		case "right", "l", "tab":
			m.activeTab = min(m.activeTab+1, len(m.Tabs)-1)
		case "left", "h", "shift+tab":
			m.activeTab = max(m.activeTab-1, 0)
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
	}
	return m, nil
}

func min(a, b int) int { if a < b { return a }; return b }
func max(a, b int) int { if a > b { return a }; return b }

func (m Model) View() string {
	doc := strings.Builder{}
	var renderedTabs []string

	highlight := lipgloss.Color("#7D56F4")
	inactiveTab := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(highlight).
		Padding(0, 1)
	activeTab := inactiveTab.Copy().
		Bold(true).
		Foreground(highlight)

	for i, t := range m.Tabs {
		if i == m.activeTab {
			renderedTabs = append(renderedTabs, activeTab.Render(t))
		} else {
			renderedTabs = append(renderedTabs, inactiveTab.Render(t))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, renderedTabs...)
	doc.WriteString(row)
	doc.WriteString("\n\n")

	content := lipgloss.NewStyle().
		BorderForeground(highlight).
		Padding(1, 2).
		Border(lipgloss.NormalBorder()).
		Width(lipgloss.Width(row))
	doc.WriteString(content.Render(m.Content[m.activeTab]))
	doc.WriteString("\n")

	return fmt.Sprintf("\n%s\n  \033[2m←/→: switch tabs • q: quit\033[0m\n", lipgloss.NewStyle().Padding(1, 2).Render(doc.String()))
}
