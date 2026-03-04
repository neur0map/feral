package autocomplete

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

var suggestions = []string{
	"Apple", "Apricot", "Avocado", "Banana", "Blackberry",
	"Blueberry", "Cherry", "Coconut", "Date", "Fig",
	"Grape", "Kiwi", "Lemon", "Lime", "Mango",
	"Orange", "Papaya", "Peach", "Pear", "Pineapple",
	"Plum", "Raspberry", "Strawberry", "Watermelon",
}

type Model struct {
	textInput textinput.Model
	matches   []string
	width     int
	height    int
}

func New() Model {
	ti := textinput.New()
	ti.Placeholder = "Type a fruit..."
	ti.Focus()
	ti.CharLimit = 64
	ti.Width = 40
	return Model{textInput: ti, matches: suggestions}
}

func (m Model) Init() tea.Cmd {
	return textinput.Blink
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "enter":
			return m, feralkit.EmitEvent("submit")
		case "ctrl+c", "esc":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.textInput.Width = msg.Width - 6
	}
	var cmd tea.Cmd
	m.textInput, cmd = m.textInput.Update(msg)
	val := strings.ToLower(m.textInput.Value())
	if val == "" {
		m.matches = suggestions
	} else {
		m.matches = nil
		for _, s := range suggestions {
			if strings.Contains(strings.ToLower(s), val) {
				m.matches = append(m.matches, s)
			}
		}
	}
	return m, cmd
}

func (m Model) View() string {
	var b strings.Builder
	b.WriteString("\n  Search fruits:\n\n")
	b.WriteString("  " + m.textInput.View() + "\n\n")
	shown := m.matches
	if len(shown) > 8 {
		shown = shown[:8]
	}
	for _, s := range shown {
		b.WriteString(fmt.Sprintf("  \033[2m•\033[0m %s\n", s))
	}
	if len(m.matches) > 8 {
		b.WriteString(fmt.Sprintf("  \033[2m...and %d more\033[0m\n", len(m.matches)-8))
	}
	b.WriteString("\n  \033[2m(esc to quit)\033[0m\n")
	return b.String()
}
