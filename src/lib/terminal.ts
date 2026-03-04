// ============================================================================
// terminal.ts — Shared xterm factory for all terminal-bearing nodes
// ============================================================================

import { Terminal, type ITheme, type IDisposable } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

// ── Shared theme ────────────────────────────────────────────────────────────

export const XTERM_THEME: ITheme = {
  background: "#121213",
  foreground: "#d4d4d8",
  cursor: "#d4d4d8",
  cursorAccent: "#121213",
  selectionBackground: "rgba(255, 255, 255, 0.15)",
  selectionForeground: "#ffffff",
  black: "#1a1a1c",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d4d4d8",
  brightBlack: "#3f3f44",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

// ── Variant types ───────────────────────────────────────────────────────────

export type TerminalVariant = "screen" | "runner" | "coder";

export interface TerminalBundle {
  term: Terminal;
  fitAddon: FitAddon;
}

// ── OSC query suppression ────────────────────────────────────────────────
//
// Bubble Tea v1's init() calls lipgloss.HasDarkBackground() which sends
// OSC 10/11/12 queries to detect terminal colors. xterm.js responds with
// the actual colors and the response leaks through onData → PTY → Go stdin,
// appearing as garbled text like "]11;rgb:1212/1212/1313\".
//
// We fix this at two levels:
// 1. Server-side: TERM=tmux-256color makes termenv skip OSC queries entirely
// 2. Client-side: parser.registerOscHandler intercepts any remaining queries
//    at the xterm.js parser level BEFORE a response is generated.
//
// The registerOscHandler approach is the xterm.js-recommended mechanism.
// Returning `true` from the handler means "I consumed this" — the built-in
// handler never runs, so no response is ever generated or sent through onData.

/**
 * Register OSC handlers that silently consume color query responses (OSC 10/11/12).
 * Prevents xterm.js from generating responses that leak into the PTY as garbled text.
 * Color SET operations (non-query) still pass through to the built-in handler.
 * Returns disposables for cleanup.
 */
export function suppressColorQueries(term: Terminal): IDisposable[] {
  return [10, 11, 12].map((id) =>
    term.parser.registerOscHandler(id, (data: string) => {
      // "?" = query → suppress; anything else = set → let through
      return data === "?";
    }),
  );
}

// ── Write coalescer ─────────────────────────────────────────────────────────
//
// Tauri events can arrive on separate event-loop ticks even within the same
// animation frame. Each `term.write()` call schedules xterm.js processing,
// and if two writes land in different microtask batches the terminal may
// render an intermediate state (e.g. cursor-hidden but content not yet
// rewritten), causing visible flicker.
//
// The coalescer accumulates all data within a single rAF frame and flushes
// once, guaranteeing one atomic buffer update → one render per frame.

/**
 * Create a write function that coalesces rapid writes into one-per-frame
 * flushes to the terminal. Returns a `write(data)` function to use in place
 * of `term.write()`.
 */
export function createWriteCoalescer(term: Terminal): (data: string) => void {
  let buffer = "";
  let scheduled = false;

  return (data: string) => {
    buffer += data;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(() => {
        const flush = buffer;
        buffer = "";
        scheduled = false;
        term.write(flush);
      });
    }
  };
}

// ── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a configured Terminal instance with addons loaded.
 *
 * - All variants: WebGL renderer (GPU-accelerated; falls back to DOM renderer
 *   on WebGL context loss), FitAddon, Unicode11Addon
 * - "coder": WebLinksAddon, scrollback: 5000, cursor blink on
 * - "screen"/"runner": scrollback: 0, cursor blink off, smooth scroll off
 *
 * WebGL is critical for screen/runner because the DOM renderer modifies
 * individual <span> elements per character cell — hundreds of DOM mutations
 * per Bubble Tea repaint — causing visible flicker in WKWebView. WebGL draws
 * to a single <canvas>, avoiding DOM mutation overhead entirely.
 */
export function createTerminal(
  container: HTMLElement,
  variant: TerminalVariant,
): TerminalBundle {
  const isCoder = variant === "coder";
  const isScreen = variant === "screen" || variant === "runner";

  const term = new Terminal({
    theme: XTERM_THEME,
    fontSize: 13,
    fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
    lineHeight: 1.2,
    // Coder shells: xterm.js manages the cursor → blink on.
    // Screen/runner: Bubble Tea manages cursor via PTY escape codes → blink off
    // to avoid double-blink between xterm.js CSS animation and Bubble Tea timer.
    cursorBlink: !isScreen,
    cursorStyle: "bar",
    allowProposedApi: true,
    // Screen/runner: TUI apps repaint the full alternate buffer on every update;
    // smooth scroll causes a 100ms animation per repaint → visible flicker.
    smoothScrollDuration: isCoder ? 100 : 0,
    scrollback: isCoder ? 5000 : 0,
    convertEol: false,
    drawBoldTextInBrightColors: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  // Suppress OSC 10/11/12 color query responses at the parser level.
  // Must be registered BEFORE opening (and thus before any data is written).
  suppressColorQueries(term);

  // Must open before loading GPU addons (they need a canvas context)
  term.open(container);

  // Load optional addons asynchronously — all dynamic imports so a failure
  // in any single addon never crashes the app.
  // All variants get WebGL for flicker-free rendering. Mode 2026 (synchronized
  // output, injected in lib.rs) ensures xterm.js defers rendering until the
  // full Bubble Tea frame is ready.
  loadOptionalAddons(term, isCoder, false);

  return { term, fitAddon };
}

/**
 * Safely dispose a terminal. GPU addons (WebGL/Canvas) can throw when their
 * GL context is already lost (e.g. DOM element removed by React Flow before
 * the cleanup effect runs). This swallows those errors.
 */
export function disposeTerminal(term: Terminal): void {
  try {
    term.dispose();
  } catch { /* GPU addon dispose on detached DOM — safe to ignore */ }
}

// ── Optional addon loader (all async, all guarded) ──────────────────────────

/** Returns true if the terminal has been disposed (node deleted). */
function isDisposed(term: Terminal): boolean {
  return !term.element;
}

async function loadOptionalAddons(
  term: Terminal,
  isCoder: boolean,
  skipGpu: boolean,
): Promise<void> {
  // Unicode 11 — wide chars, emoji, box-drawing
  try {
    const { Unicode11Addon } = await import("@xterm/addon-unicode11");
    if (isDisposed(term)) return;
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
  } catch { /* addon unavailable */ }

  // GPU renderer — WebGL avoids DOM mutation overhead that causes flicker
  // in WKWebView during rapid Bubble Tea repaints. Falls back to DOM renderer.
  if (!skipGpu) {
    if (isDisposed(term)) return;
    try {
      const { WebglAddon } = await import("@xterm/addon-webgl");
      if (isDisposed(term)) return;
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        // DOM renderer is the implicit fallback — no canvas addon needed
      });
      term.loadAddon(webgl);
    } catch { /* DOM renderer is the implicit fallback */ }
  }

  // Clickable URLs for coder shells
  if (isCoder) {
    try {
      const { WebLinksAddon } = await import("@xterm/addon-web-links");
      if (isDisposed(term)) return;
      term.loadAddon(new WebLinksAddon());
    } catch { /* addon unavailable */ }
  }
}

