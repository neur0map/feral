package sendmsg

import (
	"fmt"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type statusMsg int

func listenForActivity() tea.Cmd {
	return func() tea.Msg {
		time.Sleep(time.Second)
		return statusMsg(1)
	}
}

type Model struct {
	count  int
	width  int
	height int
}

func New() Model { return Model{} }

func (m Model) Init() tea.Cmd { return listenForActivity() }

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
	case statusMsg:
		m.count += int(msg)
		return m, listenForActivity()
	}
	return m, nil
}

func (m Model) View() string {
	return fmt.Sprintf(
		"\n  Messages Received\n\n  Count: \033[38;5;205m%d\033[0m\n\n  \033[2mMessages arrive every second • q: quit\033[0m\n",
		m.count,
	)
}
