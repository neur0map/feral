// ============================================================================
// TerminalNode.tsx — ScreenNode with terminal + code editor + event handles
// ============================================================================

import { useEffect, useRef, useState, useCallback } from "react";
import {
  type NodeProps,
  NodeResizer,
  Handle,
  Position,
  useReactFlow,
} from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import CodeMirror from "@uiw/react-codemirror";
import { go } from "@codemirror/lang-go";
import { oneDark } from "@codemirror/theme-one-dark";
import { search } from "@codemirror/search";
import "@xterm/xterm/css/xterm.css";

// ── Xterm theme ─────────────────────────────────────────────────────────────

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

export function TerminalNode({ id, selected, data }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const screenName = (nodeData.screenName as string) ?? "splash";
  const templateId = (nodeData.templateId as string) ?? "splash";
  const outputs = (nodeData.outputs as string[]) ?? [];

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Editor state — multi-file
  const [showEditor, setShowEditor] = useState(false);
  const [screenFiles, setScreenFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState("");
  const [fileSources, setFileSources] = useState<Record<string, string>>({});
  const [isBuilding, setIsBuilding] = useState(false);
  const filesLoaded = useRef(false);

  // Load file list and active file source when editor opens
  useEffect(() => {
    if (showEditor && !filesLoaded.current) {
      filesLoaded.current = true;
      invoke<string[]>("list_screen_files", { screenName }).then((files) => {
        if (files.length === 0) {
          // Fallback for single-file templates — use legacy path
          files = [`${screenName}.go`];
        }
        setScreenFiles(files);
        setActiveFile(files[0]);
        // Load the first file
        invoke<string>("read_screen_file", { screenName, filename: files[0] }).then(
          (content) => {
            setFileSources((prev) => ({ ...prev, [files[0]]: content }));
          }
        );
      });
    }
  }, [showEditor, screenName]);

  // Load file content when switching active file
  useEffect(() => {
    if (activeFile && !(activeFile in fileSources)) {
      invoke<string>("read_screen_file", { screenName, filename: activeFile }).then(
        (content) => {
          setFileSources((prev) => ({ ...prev, [activeFile]: content }));
        }
      );
    }
  }, [activeFile, screenName, fileSources]);

  const source = fileSources[activeFile] ?? "";

  // Process state
  const [exited, setExited] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  // AI generation overlay state
  const [aiStatus, setAiStatus] = useState<{
    active: boolean;
    provider: string;
    model: string;
  } | null>(null);

  const lastDims = useRef<{ cols: number; rows: number }>({ cols: 80, rows: 24 });
  const { setEdges } = useReactFlow();

  // ── Fit + resize helper ─────────────────────────────────────────────────
  const fitAndResize = useCallback(() => {
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon) return;

    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const { cols, rows } = term;
    if (cols !== lastDims.current.cols || rows !== lastDims.current.rows) {
      lastDims.current = { cols, rows };
      invoke("resize_terminal", { id, cols, rows }).catch(console.error);
    }
  }, [id]);

  // ── Flash an edge connected to a specific handle ──────────────────────
  const flashEdge = useCallback(
    (handleId: string) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.source === id && e.sourceHandle === handleId
            ? { ...e, className: "edge-fired", animated: true }
            : e
        )
      );
      // Reset after 1.2s
      setTimeout(() => {
        setEdges((eds) =>
          eds.map((e) =>
            e.source === id && e.sourceHandle === handleId
              ? { ...e, className: "", animated: false }
              : e
          )
        );
      }, 1200);
    },
    [id, setEdges]
  );

  // ── Main effect: wire up xterm + PTY ──────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    setExited(false);
    setLastEvent(null);

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

    // Compile and run
    term.write("\x1b[90mCompiling...\x1b[0m\r\n");
    invoke("install_and_run_screen", {
      screenName,
      templateId,
      nodeId: id,
    }).catch((err) => {
      term.write(`\r\n\x1b[31m[Feral] Build failed: ${err}\x1b[0m\r\n`);
    });

    // Listen for PTY output
    let unlistenOutput: UnlistenFn | null = null;
    listen<{ data: string }>(`terminal-output-${id}`, (event) => {
      term.write(event.payload.data);
      // Detect "[process exited]" sentinel
      if (event.payload.data.includes("[process exited]")) {
        setExited(true);
      }
    }).then((fn) => {
      unlistenOutput = fn;
    });

    // Listen for reload events — reset xterm before new PTY data arrives
    let unlistenReload: UnlistenFn | null = null;
    listen<{ binary_path: string }>(`terminal-reload-${id}`, () => {
      term.reset();
      setExited(false);
      setLastEvent(null);
    }).then((fn) => {
      unlistenReload = fn;
    });

    // Listen for feralkit events (navigation triggers from Go code)
    let unlistenEvent: UnlistenFn | null = null;
    listen<{ event: string }>(`terminal-event-${id}`, (event) => {
      const eventName = event.payload.event;
      setLastEvent(eventName);
      flashEdge(eventName);
    }).then((fn) => {
      unlistenEvent = fn;
    });

    // Listen for AI generation status events
    let unlistenAiGen: UnlistenFn | null = null;
    listen<{ status: string; provider: string; model: string; error: string | null }>(
      `ai-generation-${id}`,
      (event) => {
        const { status, provider, model } = event.payload;
        if (status === "started") {
          setAiStatus({ active: true, provider, model });
        } else {
          setAiStatus(null);
          if (status === "complete") {
            // AI wrote new code to disk — re-fetch all files in one batch
            // IMPORTANT: Do NOT clear fileSources to {} — that causes CodeMirror
            // to see "" which triggers onChange, racing with the re-fetch.
            filesLoaded.current = false;
            invoke<string[]>("list_screen_files", { screenName }).then(async (files) => {
              if (files.length === 0) files = [`${screenName}.go`];
              filesLoaded.current = true;
              setScreenFiles(files);
              // Fetch all files in parallel, then set state in one go
              const entries = await Promise.all(
                files.map(async (file) => {
                  const content = await invoke<string>("read_screen_file", {
                    screenName,
                    filename: file,
                  });
                  return [file, content] as [string, string];
                })
              );
              const newSources: Record<string, string> = {};
              for (const [file, content] of entries) {
                newSources[file] = content;
              }
              setFileSources(newSources);
            });
          }
        }
      }
    ).then((fn) => {
      unlistenAiGen = fn;
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
      if (unlistenReload) unlistenReload();
      if (unlistenEvent) unlistenEvent();
      if (unlistenAiGen) unlistenAiGen();
      term.dispose();
      invoke("kill_terminal", { id }).catch(console.error);
    };
  }, [id, fitAndResize, flashEdge]);

  // ── Refit xterm when editor panel toggles ─────────────────────────────
  useEffect(() => {
    const timeout = setTimeout(() => {
      fitAndResize();
    }, 60);
    return () => clearTimeout(timeout);
  }, [showEditor, fitAndResize]);

  // ── Apply changes handler ─────────────────────────────────────────────
  const handleApply = useCallback(async () => {
    setIsBuilding(true);
    const term = terminalRef.current;

    try {
      // Save all modified files before rebuilding
      for (const [filename, content] of Object.entries(fileSources)) {
        await invoke("save_screen_file", { screenName, filename, source: content });
      }
      // Rebuild (reads from disk, so all saved files are picked up)
      await invoke("rebuild_and_reload_screen", {
        screenName,
        newSource: fileSources[`${screenName}.go`] ?? source,
        nodeId: id,
      });
    } catch (err) {
      if (term) {
        term.write(`\r\n\x1b[31m${err}\x1b[0m\r\n`);
      }
    } finally {
      setIsBuilding(false);
    }
  }, [id, screenName, fileSources, source]);

  // ── Restart handler ───────────────────────────────────────────────────
  const handleRestart = useCallback(async () => {
    const term = terminalRef.current;
    if (term) term.reset();
    setExited(false);
    setLastEvent(null);

    term?.write("\x1b[90mRestarting...\x1b[0m\r\n");
    try {
      await invoke("install_and_run_screen", {
        screenName,
        templateId,
        nodeId: id,
      });
    } catch (err) {
      term?.write(`\r\n\x1b[31m[Feral] Build failed: ${err}\x1b[0m\r\n`);
    }
  }, [id, screenName, templateId]);

  // ── Click-to-focus handler ────────────────────────────────────────────
  const handleTerminalClick = useCallback(() => {
    terminalRef.current?.focus();
    setIsFocused(true);
  }, []);

  const handleTerminalBlur = useCallback(() => {
    setIsFocused(false);
  }, []);

  // ── Compute handle positions evenly spaced ────────────────────────────
  const outputCount = outputs.length;

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={showEditor ? 700 : 380}
        minHeight={260}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />

      {/* ── Input handle (left side) ──────────────────────────────────── */}
      <div>
        <Handle
          type="target"
          id="input"
          position={Position.Left}
          className="feral-handle feral-handle-input"
        />
        <div
          className="handle-label handle-label-input"
          style={{ top: "50%" }}
        >
          in
        </div>
      </div>

      {/* ── Output handles (right side) ───────────────────────────────── */}
      {outputs.map((name, i) => {
        // Evenly space handles along the right edge
        const pct = ((i + 1) / (outputCount + 1)) * 100;
        return (
          <div key={name}>
            <Handle
              type="source"
              id={name}
              position={Position.Right}
              className={`feral-handle feral-handle-output ${
                lastEvent === name ? "feral-handle-fired" : ""
              }`}
              style={{ top: `${pct}%` }}
            />
            <div
              className="handle-label"
              style={{ top: `${pct}%` }}
            >
              {name}
            </div>
          </div>
        );
      })}

      <div className={`terminal-node ${isFocused ? "focused" : ""}`}>
        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="terminal-header">
          <div className="traffic-lights">
            <span className="dot close" />
            <span className="dot minimize" />
            <span className="dot maximize" />
          </div>
          <span className="terminal-title">
            {screenName}
          </span>
          <button
            className="editor-toggle nodrag"
            onClick={() => setShowEditor((v) => !v)}
            title={showEditor ? "Hide editor" : "Edit source"}
          >
            {showEditor ? "\u2715" : "</>"}
          </button>
        </div>

        {/* ── Body: terminal + optional editor panel ──────────────────── */}
        <div className="screen-body">
          {/* Terminal pane wrapper — holds xterm + restart overlay */}
          <div className="terminal-pane">
            <div
              ref={containerRef}
              className={`terminal-body ${selected ? "nodrag nowheel" : ""}`}
              onClick={handleTerminalClick}
              onBlur={handleTerminalBlur}
            />

            {/* Click-to-focus overlay — blocks terminal input until node is selected */}
            {!selected && (
              <div className="terminal-focus-overlay" />
            )}

            {/* AI generation overlay — shown while AI is generating code */}
            {aiStatus?.active && (
              <div className="ai-generation-overlay">
                <div className="ai-generation-spinner" />
                <div className="ai-generation-label">
                  Generating with {aiStatus.provider}...
                </div>
                <div className="ai-generation-model">
                  {aiStatus.model || "default model"}
                </div>
              </div>
            )}

            {/* Restart overlay — shown when process exits */}
            {exited && (
              <div className="restart-overlay nodrag">
                {lastEvent && (
                  <div className="restart-event-badge">
                    event: {lastEvent}
                  </div>
                )}
                <button className="restart-button" onClick={handleRestart}>
                  Restart
                </button>
              </div>
            )}
          </div>

          {/* Editor pane */}
          {showEditor && (
            <div className={`editor-panel ${selected ? "nodrag nowheel" : ""}`}>
              <div className="editor-tab-bar">
                {screenFiles.length > 1 ? (
                  <div className="editor-file-picker">
                    {screenFiles.map((file) => (
                      <button
                        key={file}
                        className={`editor-file-pill ${
                          file === activeFile ? "editor-file-pill-active" : ""
                        }`}
                        onClick={() => setActiveFile(file)}
                      >
                        {file}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="editor-tab-name">{activeFile || `${screenName}.go`}</span>
                )}
                <button
                  className="editor-apply"
                  onClick={handleApply}
                  disabled={isBuilding}
                >
                  {isBuilding ? "Building..." : "Apply"}
                </button>
              </div>
              <div className="editor-cm-wrapper">
                <CodeMirror
                  value={source}
                  height="100%"
                  onChange={(val) =>
                    setFileSources((prev) => ({ ...prev, [activeFile]: val }))
                  }
                  extensions={[go(), search({ top: true })]}
                  theme={oneDark}
                  basicSetup={{
                    lineNumbers: true,
                    foldGutter: true,
                    bracketMatching: true,
                    closeBrackets: true,
                    autocompletion: true,
                    highlightActiveLine: true,
                    indentOnInput: true,
                    tabSize: 4,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
