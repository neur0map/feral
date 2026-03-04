package isbnform

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var (
	titleStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("205")).Bold(true)
	labelStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
)

type Model struct {
	inputs     []textinput.Model
	focusIndex int
}

func New() Model {
	inputs := make([]textinput.Model, 3)
	for i := range inputs {
		t := textinput.New()
		t.CharLimit = 64
		switch i {
		case 0:
			t.Placeholder = "978-0-13-468599-1"
			t.Focus()
		case 1:
			t.Placeholder = "The Go Programming Language"
		case 2:
			t.Placeholder = "Donovan & Kernighan"
		}
		inputs[i] = t
	}
	return Model{inputs: inputs}
}

func (m Model) Init() tea.Cmd {
	return textinput.Blink
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case "tab", "enter":
			if m.focusIndex == len(m.inputs)-1 {
				return m, feralkit.EmitEvent("submit")
			}
			m.focusIndex++
			cmds := make([]tea.Cmd, len(m.inputs))
			for i := range m.inputs {
				if i == m.focusIndex {
					cmds[i] = m.inputs[i].Focus()
				} else {
					m.inputs[i].Blur()
				}
			}
			return m, tea.Batch(cmds...)
		case "shift+tab":
			if m.focusIndex > 0 {
				m.focusIndex--
			}
			cmds := make([]tea.Cmd, len(m.inputs))
			for i := range m.inputs {
				if i == m.focusIndex {
					cmds[i] = m.inputs[i].Focus()
				} else {
					m.inputs[i].Blur()
				}
			}
			return m, tea.Batch(cmds...)
		}
	}
	cmd := m.updateInputs(msg)
	return m, cmd
}

func (m *Model) updateInputs(msg tea.Msg) tea.Cmd {
	cmds := make([]tea.Cmd, len(m.inputs))
	for i := range m.inputs {
		m.inputs[i], cmds[i] = m.inputs[i].Update(msg)
	}
	return tea.Batch(cmds...)
}

func (m Model) View() string {
	labels := []string{"ISBN", "Title", "Author"}
	var b strings.Builder
	b.WriteString("\n  " + titleStyle.Render("Book Entry Form") + "\n\n")
	for i, input := range m.inputs {
		b.WriteString(fmt.Sprintf("  %s\n  %s\n\n",
			labelStyle.Render(labels[i]+":"),
			input.View(),
		))
	}
	b.WriteString("  \033[2mtab: next field • enter: submit • ctrl+c: quit\033[0m\n")
	return b.String()
}
