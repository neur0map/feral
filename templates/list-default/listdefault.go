package listdefault

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
		item{title: "Raspberry Pi's", desc: "I have 'em all over my house"},
		item{title: "Nutella", desc: "It's good on toast"},
		item{title: "Bitter melon", desc: "It cools you down"},
		item{title: "Nice socks", desc: "And by that I mean socks without holes"},
		item{title: "Eight hours of sleep", desc: "I had mass amounts of it once"},
		item{title: "Cycling", desc: "Good for the gams"},
		item{title: "Bubble Tea", desc: "The real deal"},
		item{title: "Shampoo", desc: "Nothing like clean hair"},
		item{title: "Table tennis", desc: "It's ping pong but fancy"},
		item{title: "Noodles", desc: "Served hot and fresh"},
	}
	l := list.New(items, list.NewDefaultDelegate(), 0, 0)
	l.Title = "My Fstrx List"
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
