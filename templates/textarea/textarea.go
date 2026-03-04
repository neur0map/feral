package textarea

import (
	"fmt"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	textarea textarea.Model
	width    int
	height   int
}

func New() Model {
	ta := textarea.New()
	ta.Placeholder = "Once upon a time..."
	ta.Focus()
	return Model{textarea: ta}
}

func (m Model) Init() tea.Cmd {
	return textarea.Blink
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		case "esc":
			if m.textarea.Focused() {
				m.textarea.Blur()
			} else {
				return m, feralkit.EmitEvent("quit")
			}
		}
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.textarea.SetWidth(msg.Width - 4)
		m.textarea.SetHeight(msg.Height - 6)
	}
	m.textarea, cmd = m.textarea.Update(msg)
	return m, cmd
}

func (m Model) View() string {
	return fmt.Sprintf(
		"\n  Tell me a story.\n\n%s\n\n  %s\n",
		m.textarea.View(),
		"\033[2m(ctrl+c to quit)\033[0m",
	)
}
