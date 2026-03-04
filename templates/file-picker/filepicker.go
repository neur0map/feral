package filepicker

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/bubbles/filepicker"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	filepicker   filepicker.Model
	selectedFile string
}

func New() Model {
	fp := filepicker.New()
	fp.AllowedTypes = []string{".go", ".txt", ".md", ".yaml", ".json"}
	fp.CurrentDirectory = "."
	return Model{filepicker: fp}
}

func (m Model) Init() tea.Cmd {
	return m.filepicker.Init()
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c", "q":
			return m, feralkit.EmitEvent("quit")
		}
	}
	var cmd tea.Cmd
	m.filepicker, cmd = m.filepicker.Update(msg)
	if didSelect, path := m.filepicker.DidSelectFile(msg); didSelect {
		m.selectedFile = path
		return m, feralkit.EmitEvent("select")
	}
	return m, cmd
}

func (m Model) View() string {
	var b strings.Builder
	b.WriteString("\n  Pick a file:\n\n")
	b.WriteString(m.filepicker.View())
	if m.selectedFile != "" {
		b.WriteString(fmt.Sprintf("\n  Selected: %s\n", m.selectedFile))
	}
	b.WriteString("\n  \033[2mq: quit\033[0m\n")
	return b.String()
}
