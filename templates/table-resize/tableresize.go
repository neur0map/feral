package tableresize

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
		{Title: "Name", Width: 20},
		{Title: "Language", Width: 12},
		{Title: "Stars", Width: 8},
	}
	rows := []table.Row{
		{"Bubble Tea", "Go", "24k"},
		{"Ink", "TypeScript", "25k"},
		{"Ratatui", "Rust", "8k"},
		{"Textual", "Python", "23k"},
		{"Cursive", "Rust", "4k"},
		{"Brick", "Haskell", "1.5k"},
		{"Blessed", "JavaScript", "11k"},
	}

	t := table.New(
		table.WithColumns(columns),
		table.WithRows(rows),
		table.WithFocused(true),
		table.WithHeight(8),
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
		// Resize columns proportionally
		nameW := m.width / 2
		langW := m.width / 4
		starsW := m.width / 4
		m.table.SetColumns([]table.Column{
			{Title: "Name", Width: nameW},
			{Title: "Language", Width: langW},
			{Title: "Stars", Width: starsW},
		})
		m.table.SetHeight(m.height - 4)
	}
	var cmd tea.Cmd
	m.table, cmd = m.table.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	return "\n" + baseStyle.Render(m.table.View()) + "\n  \033[2mq: quit\033[0m\n"
}
