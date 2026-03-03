// ============================================================================
// RunnerNode.tsx — Simplified terminal for assembled full-app runner
// ============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import { type NodeProps, NodeResizer } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

const XTERM_THEME = {
  background: "#121213",
  foreground: "#d4d4d8",
  cursor: "#d4d4d8",
  cursorAccent: "#121213",
  selectionBackground: "rgba(255, 255, 255, 0.15)",
  selectionForeground: "#ffffff",
  black: "#1a1a24",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#fbbf24",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d4d4d8",
  brightBlack: "#3f3f50",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#fafafa",
};

export function RunnerNode({ id, selected, data }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const edgesJson = (nodeData.edgesJson as string) ?? "[]";
  const startScreen = (nodeData.startScreen as string) ?? "splash";

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const lastDims = useRef<{ cols: number; rows: number }>({
    cols: 80,
    rows: 24,
  });

  // Guard against React 18 strict-mode double-mount
  const buildStarted = useRef(false);

  // ── Main effect: build + wire xterm + PTY ───────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: XTERM_THEME,
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      allowProposedApi: true,
      smoothScrollDuration: 100,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    terminalRef.current = term;

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Build and run assembled app (skip if already started by strict-mode re-mount)
    if (!buildStarted.current) {
      buildStarted.current = true;
      term.write("\x1b[90mAssembling full app...\x1b[0m\r\n");
      invoke("build_full_app", {
        edgesJson,
        startScreen,
        runnerNodeId: id,
      }).catch((err) => {
        term.write(`\r\n\x1b[31m[Feral] Build failed: ${err}\x1b[0m\r\n`);
      });
    }

    // Listen for PTY output
    let unlistenOutput: UnlistenFn | null = null;
    listen<{ data: string }>(`terminal-output-${id}`, (event) => {
      term.write(event.payload.data);
    }).then((fn) => {
      unlistenOutput = fn;
    });

    // User keystrokes → PTY
    const dataDisposable = term.onData((data) => {
      invoke("write_to_terminal", { id, data }).catch(console.error);
    });

    // ResizeObserver
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        fitAddon.fit();
        const { cols, rows } = term;
        if (
          cols !== lastDims.current.cols ||
          rows !== lastDims.current.rows
        ) {
          lastDims.current = { cols, rows };
          invoke("resize_terminal", { id, cols, rows }).catch(console.error);
        }
      }, 50);
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(resizeTimeout);
      observer.disconnect();
      dataDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      term.dispose();
      invoke("kill_terminal", { id }).catch(console.error);
    };
  }, [id, edgesJson, startScreen]);

  // ── Click-to-focus ──────────────────────────────────────────────────────
  const handleTerminalClick = useCallback(() => {
    terminalRef.current?.focus();
    setIsFocused(true);
  }, []);

  const handleTerminalBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  // ── Stop handler ────────────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    invoke("kill_terminal", { id }).catch(console.error);
  }, [id]);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={380}
        minHeight={260}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />

      <div className={`terminal-node ${isFocused ? "focused" : ""}`}>
        {/* Header */}
        <div className="terminal-header">
          <div className="traffic-lights">
            <span className="dot close" />
            <span className="dot minimize" />
            <span className="dot maximize" />
          </div>
          <span className="terminal-title">Full App</span>
          <button
            className="runner-stop-btn nodrag"
            onClick={handleStop}
            title="Stop"
          >
            &#9632;
          </button>
        </div>

        {/* Terminal body */}
        <div className="screen-body">
          <div className="terminal-pane">
            <div
              ref={containerRef}
              className={`terminal-body ${selected ? "nodrag nowheel" : ""}`}
              onClick={handleTerminalClick}
              onBlur={handleTerminalBlur}
            />

            {/* Click-to-focus overlay */}
            {!selected && <div className="terminal-focus-overlay" />}
          </div>
        </div>
      </div>
    </>
  );
}
