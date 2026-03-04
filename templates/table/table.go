package table

import (
	"github.com/charmbracelet/bubbles/table"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"feral.dev/default/feralkit"
)

var baseStyle = lipgloss.NewStyle().
	BorderStyle(lipgloss.NormalBorder()).
	BorderForeground(lipgloss.Color("240"))

type Model struct {
	table  table.Model
	width  int
	height int
}

func New() Model {
	columns := []table.Column{
		{Title: "Rank", Width: 6},
		{Title: "City", Width: 16},
		{Title: "Country", Width: 16},
	}
	rows := []table.Row{
		{"1", "Tokyo", "Japan"},
		{"2", "Delhi", "India"},
		{"3", "Shanghai", "China"},
		{"4", "Sao Paulo", "Brazil"},
		{"5", "Mexico City", "Mexico"},
		{"6", "Cairo", "Egypt"},
		{"7", "Mumbai", "India"},
		{"8", "Beijing", "China"},
		{"9", "Dhaka", "Bangladesh"},
		{"10", "Osaka", "Japan"},
		{"11", "New York", "USA"},
		{"12", "Karachi", "Pakistan"},
		{"13", "Buenos Aires", "Argentina"},
		{"14", "Chongqing", "China"},
		{"15", "Istanbul", "Turkey"},
	}

	t := table.New(
		table.WithColumns(columns),
		table.WithRows(rows),
		table.WithFocused(true),
		table.WithHeight(10),
	)

	s := table.DefaultStyles()
	s.Header = s.Header.
		BorderStyle(lipgloss.NormalBorder()).
		BorderForeground(lipgloss.Color("240")).
		BorderBottom(true).
		Bold(false)
	s.Selected = s.Selected.
		Foreground(lipgloss.Color("229")).
		Background(lipgloss.Color("57")).
		Bold(false)
	t.SetStyles(s)

	return Model{table: t}
}

func (m Model) Init() tea.Cmd {
	return nil
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	var cmd tea.Cmd
	m.table, cmd = m.table.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	return "\n" + baseStyle.Render(m.table.View()) + "\n  \033[2mq: quit\033[0m\n"
}
