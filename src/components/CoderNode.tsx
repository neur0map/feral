// ============================================================================
// CoderNode.tsx — PTY terminal node that spawns a CLI coding assistant
// ============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import {
  type NodeProps,
  NodeResizer,
  Handle,
  Position,
} from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TerminalSquare } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

// ── Xterm theme (matches TerminalNode) ──────────────────────────────────────

const XTERM_THEME = {
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

// ── Component ───────────────────────────────────────────────────────────────

export function CoderNode({ id, selected, data }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const targetScreenName = (nodeData.targetScreenName as string) ?? "";
  const screenNodeId = (nodeData.screenNodeId as string) ?? "";

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const lastDims = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });

  // Track connection state
  useEffect(() => {
    setIsConnected(!!targetScreenName);
  }, [targetScreenName]);

  // ── Main effect: wire up xterm + PTY ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !isConnected || !targetScreenName) return;

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
    fitAddonRef.current = fitAddon;

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Spawn coder terminal scoped to the screen's directory
    invoke("spawn_coder_terminal", {
      nodeId: id,
      screenName: targetScreenName,
      screenNodeId: screenNodeId || null,
    }).catch((err) => {
      term.write(`\r\n\x1b[31m[Feral] Failed to spawn terminal: ${err}\x1b[0m\r\n`);
    });

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
        if (cols !== lastDims.current.cols || rows !== lastDims.current.rows) {
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
  }, [id, isConnected, targetScreenName, screenNodeId]);

  // ── Click-to-focus handler ────────────────────────────────────────────
  const handleTerminalClick = useCallback(() => {
    terminalRef.current?.focus();
    setIsFocused(true);
  }, []);

  const handleTerminalBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={380}
        minHeight={260}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />

      {/* Output handle (right side) — connects to a screen's input */}
      <Handle
        type="source"
        id="coder-output"
        position={Position.Right}
        className="feral-handle feral-handle-output"
      />

      <div className={`coder-node ${isFocused ? "focused" : ""}`}>
        {/* Header */}
        <div className="coder-header">
          <TerminalSquare size={14} className="text-amber-400/80" />
          <span className="coder-title">
            {targetScreenName ? `Coder → ${targetScreenName}` : "Coder"}
          </span>
        </div>

        {/* Body */}
        {isConnected ? (
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
        ) : (
          <div className="coder-placeholder">
            <TerminalSquare size={32} className="text-amber-400/20" />
            <span className="coder-placeholder-label">
              Connect to a screen...
            </span>
          </div>
        )}
      </div>
    </>
  );
}
