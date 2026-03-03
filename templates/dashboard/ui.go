package dashboard

import (
	"fmt"
	"strings"
)

// ANSI style constants
const (
	StyleBold   = "\033[1m"
	StyleDim    = "\033[2m"
	StyleCyan   = "\033[38;5;87m"
	StyleGreen  = "\033[38;5;120m"
	StyleRed    = "\033[38;5;210m"
	StyleYellow = "\033[38;5;228m"
	StyleReset  = "\033[0m"
)

// Panel holds data for a stats panel.
type Panel struct {
	Title string
	Value string
	Delta string
}

// RenderHeader returns a styled header bar.
func RenderHeader(title string, width int) string {
	styled := StyleCyan + StyleBold + " " + title + " " + StyleReset
	line := strings.Repeat("─", width)
	return styled + "\n" + StyleDim + line + StyleReset
}

// RenderPanel renders a single stats panel within the given width.
func RenderPanel(p Panel, width int) string {
	// Pick color based on delta sign
	deltaColor := StyleGreen
	if strings.HasPrefix(p.Delta, "-") {
		deltaColor = StyleRed
	}

	title := StyleDim + p.Title + StyleReset
	value := StyleBold + p.Value + StyleReset
	delta := deltaColor + p.Delta + StyleReset

	// Build panel with border
	top := "┌" + strings.Repeat("─", width-2) + "┐"
	bot := "└" + strings.Repeat("─", width-2) + "┘"
	mid := func(content string, visLen int) string {
		pad := width - 2 - visLen
		if pad < 0 {
			pad = 0
		}
		return fmt.Sprintf("│ %s%s│", content, strings.Repeat(" ", pad))
	}

	return fmt.Sprintf("%s\n%s\n%s\n%s\n%s",
		top,
		mid(title, len(p.Title)),
		mid(value, len(p.Value)),
		mid(delta, len(p.Delta)),
		bot,
	)
}
