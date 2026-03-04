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
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { TerminalSquare, ClipboardCopy, Check } from "lucide-react";
import { createTerminal, createWriteCoalescer, disposeTerminal } from "@/lib/terminal";
import "@xterm/xterm/css/xterm.css";

// ── Component ───────────────────────────────────────────────────────────────

export function CoderNode({ id, selected, data }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const targetScreenName = (nodeData.targetScreenName as string) ?? "";
  const screenNodeId = (nodeData.screenNodeId as string) ?? "";
  const coderId = (nodeData.coderId as string) ?? "claude";

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastDims = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });

  // Track connection state
  useEffect(() => {
    setIsConnected(!!targetScreenName);
  }, [targetScreenName]);

  // Copy context prompt to clipboard
  // Paste context prompt directly into the coder's PTY
  // Flatten to a single line so the PTY doesn't treat newlines as Enter keypresses
  const handlePasteContext = useCallback(async () => {
    if (!targetScreenName) return;
    try {
      const prompt = await invoke<string>("get_coder_context", {
        screenName: targetScreenName,
      });
      const flat = prompt.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
      await invoke("write_to_terminal", { id, data: flat + "\n" });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("[Feral] Failed to paste context:", err);
    }
  }, [id, targetScreenName]);

  // ── Main effect: wire up xterm + PTY ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !isConnected || !targetScreenName) return;

    const { term, fitAddon } = createTerminal(containerRef.current, "coder");

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // Coalesced write: batches all Tauri events within a single rAF frame
    const coalescedWrite = createWriteCoalescer(term);

    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    // Spawn coder terminal scoped to the screen's directory
    invoke("spawn_coder_terminal", {
      nodeId: id,
      screenName: targetScreenName,
      screenNodeId: screenNodeId || null,
      coderId: coderId,
    }).catch((err) => {
      term.write(`\r\n\x1b[31m[Feral] Failed to spawn terminal: ${err}\x1b[0m\r\n`);
    });

    // Listen for PTY output — uses coalesced writes to avoid flicker
    let unlistenOutput: UnlistenFn | null = null;
    listen<{ data: string }>(`terminal-output-${id}`, (event) => {
      coalescedWrite(event.payload.data);
    }).then((fn) => {
      unlistenOutput = fn;
    });

    // User keystrokes → PTY
    const dataDisposable = term.onData((data) => {
      invoke("write_to_terminal", { id, data }).catch(console.error);
    });

    // ResizeObserver — 150ms debounce to avoid SIGWINCH floods during layout.
    // Pixel-dimension guard prevents fit() → reflow → ResizeObserver loop.
    let resizeTimeout: ReturnType<typeof setTimeout>;
    let lastPxW = 0;
    let lastPxH = 0;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w === lastPxW && h === lastPxH) return;
        lastPxW = w;
        lastPxH = h;
      }
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        fitAddon.fit();
        const { cols, rows } = term;
        if (cols !== lastDims.current.cols || rows !== lastDims.current.rows) {
          lastDims.current = { cols, rows };
          invoke("resize_terminal", { id, cols, rows }).catch(console.error);
        }
      }, 150);
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      clearTimeout(resizeTimeout);
      observer.disconnect();
      dataDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      disposeTerminal(term);
      invoke("kill_terminal", { id }).catch(console.error);
    };
  }, [id, isConnected, targetScreenName, screenNodeId, coderId]);

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
            {targetScreenName
              ? `${coderId.charAt(0).toUpperCase() + coderId.slice(1)} → ${targetScreenName}`
              : coderId.charAt(0).toUpperCase() + coderId.slice(1)}
          </span>
          {isConnected && (
            <button
              className="coder-context-btn"
              onClick={handlePasteContext}
              title="Paste the screen's source code as context into the coder's terminal"
            >
              {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
              <span>{copied ? "Sent" : "Context"}</span>
            </button>
          )}
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
