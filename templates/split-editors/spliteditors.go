package spliteditors

import (
	"fmt"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var (
	focusedBorder = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("205"))
	blurredBorder = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("240"))
)

type Model struct {
	editors    [2]textarea.Model
	focusIndex int
	width      int
	height     int
}

func New() Model {
	var editors [2]textarea.Model
	for i := range editors {
		ta := textarea.New()
		ta.ShowLineNumbers = true
		if i == 0 {
			ta.Placeholder = "Editor 1..."
			ta.Focus()
		} else {
			ta.Placeholder = "Editor 2..."
		}
		editors[i] = ta
	}
	return Model{editors: editors}
}

func (m Model) Init() tea.Cmd { return textarea.Blink }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case "tab":
			m.editors[m.focusIndex].Blur()
			m.focusIndex = (m.focusIndex + 1) % 2
			return m, m.editors[m.focusIndex].Focus()
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		w := (msg.Width - 6) / 2
		h := msg.Height - 4
		for i := range m.editors {
			m.editors[i].SetWidth(w)
			m.editors[i].SetHeight(h)
		}
	}
	var cmd tea.Cmd
	m.editors[m.focusIndex], cmd = m.editors[m.focusIndex].Update(msg)
	return m, cmd
}

func (m Model) View() string {
	var left, right string
	if m.focusIndex == 0 {
		left = focusedBorder.Render(m.editors[0].View())
		right = blurredBorder.Render(m.editors[1].View())
	} else {
		left = blurredBorder.Render(m.editors[0].View())
		right = focusedBorder.Render(m.editors[1].View())
	}
	return fmt.Sprintf("%s\n\033[2m  tab: switch editor • ctrl+c: quit\033[0m\n",
		lipgloss.JoinHorizontal(lipgloss.Top, left, " ", right),
	)
}
