package eyes

import (
	"fmt"
	"math"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"feral.dev/default/feralkit"
)

type Model struct {
	mouseX int
	mouseY int
	width  int
	height int
}

func New() Model { return Model{} }

func (m Model) Init() tea.Cmd { return tea.EnableMouseAllMotion }

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, feralkit.EmitEvent("quit")
		}
	case tea.MouseMsg:
		m.mouseX = msg.X
		m.mouseY = msg.Y
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
	}
	return m, nil
}

func (m Model) View() string {
	if m.width == 0 || m.height == 0 {
		return ""
	}
	cx, cy := m.width/2, m.height/2
	lx, ly := cx-6, cy
	rx, ry := cx+6, cy

	lpx, lpy := pupilPos(lx, ly, m.mouseX, m.mouseY, 2)
	rpx, rpy := pupilPos(rx, ry, m.mouseX, m.mouseY, 2)

	var b strings.Builder
	for y := 0; y < m.height-1; y++ {
		for x := 0; x < m.width; x++ {
			if (x == lpx && y == lpy) || (x == rpx && y == rpy) {
				b.WriteString("\033[38;5;205m●\033[0m")
			} else if isEye(x, y, lx, ly, 4, 2) || isEye(x, y, rx, ry, 4, 2) {
				b.WriteString("○")
			} else {
				b.WriteString(" ")
			}
		}
		b.WriteString("\n")
	}
	b.WriteString("\033[2m  Move mouse • q: quit\033[0m")
	return b.String()
}

func isEye(x, y, cx, cy, rx, ry int) bool {
	dx := float64(x-cx) / float64(rx)
	dy := float64(y-cy) / float64(ry)
	return dx*dx+dy*dy <= 1.0
}

func pupilPos(eyeX, eyeY, mouseX, mouseY, radius int) (int, int) {
	dx := float64(mouseX - eyeX)
	dy := float64(mouseY - eyeY)
	dist := math.Sqrt(dx*dx + dy*dy)
	if dist == 0 {
		return eyeX, eyeY
	}
	r := float64(radius)
	if dist < r {
		r = dist
	}
	return eyeX + int(math.Round(dx/dist*r)), eyeY + int(math.Round(dy/dist*r))
}
