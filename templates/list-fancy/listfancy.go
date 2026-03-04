package listfancy

import (
	"github.com/charmbracelet/bubbles/list"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var docStyle = lipgloss.NewStyle().Margin(1, 2)

type item struct {
	title, desc string
}

func (i item) Title() string       { return i.title }
func (i item) Description() string { return i.desc }
func (i item) FilterValue() string { return i.title }

type Model struct {
	list   list.Model
	width  int
	height int
}

func New() Model {
	items := []list.Item{
		item{title: "Vim", desc: "Endlessly configurable"},
		item{title: "Move", desc: "Fast and reliable"},
		item{title: "Emacs", desc: "An operating system with a text editor"},
		item{title: "Sublime", desc: "A text editor, not a sandwich"},
		item{title: "VS Code", desc: "It's just a browser"},
		item{title: "Helix", desc: "A kakoune-like text editor"},
		item{title: "Nano", desc: "Good for beginners"},
		item{title: "Micro", desc: "Like nano but modern"},
	}
	delegate := list.NewDefaultDelegate()
	delegate.Styles.SelectedTitle = delegate.Styles.SelectedTitle.
		Foreground(lipgloss.Color("205")).
		BorderLeftForeground(lipgloss.Color("205"))
	delegate.Styles.SelectedDesc = delegate.Styles.SelectedDesc.
		Foreground(lipgloss.Color("241")).
		BorderLeftForeground(lipgloss.Color("205"))
	l := list.New(items, delegate, 0, 0)
	l.Title = "Text Editors"
	l.Styles.Title = l.Styles.Title.
		Foreground(lipgloss.Color("205")).
		Background(lipgloss.Color("0"))
	return Model{list: l}
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			return m, feralkit.EmitEvent("quit")
		}
		if msg.String() == "enter" && !m.list.SettingFilter() {
			return m, feralkit.EmitEvent("select")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.list.SetSize(msg.Width-4, msg.Height-2)
	}
	var cmd tea.Cmd
	m.list, cmd = m.list.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	if m.width == 0 {
		return ""
	}
	return docStyle.Render(m.list.View())
}
