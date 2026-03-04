// ============================================================================
// Feral — Tauri v2 Backend with PTY Manager
// ============================================================================
//
// This module wires up `portable-pty` to Tauri's IPC event system.
//
// Architecture:
//   Frontend (xterm.js)
//       │  invoke("write_to_terminal", {id, data})   ← user keystrokes
//       │  listen("terminal-output-{id}")             ← PTY stdout
//       ▼
//   Tauri IPC bridge
//       │
//       ▼
//   PtyState (Arc<Mutex<HashMap<id, TerminalInstance>>>)
//       │
//       ▼
//   portable-pty (real PTY via macOS forkpty / Unix openpty)
//
// WHY portable-pty instead of std::process::Command?
//   Standard pipes cannot render interactive TUI apps (Bubble Tea, htop, vim)
//   because they don't support terminal ioctls (TIOCGWINSZ, etc.). A real PTY
//   is required so the child process believes it's connected to a terminal.
// ============================================================================

mod framework;
mod project;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

// Re-export notify for use in project.rs
pub(crate) use notify;

// ── Per-terminal state ──────────────────────────────────────────────────────

/// Holds the writer (stdin to PTY) and master (for resize) for one session.
struct TerminalInstance {
    /// Write end — keystrokes flow here from xterm.onData → invoke → writer.
    writer: Box<dyn Write + Send>,
    /// Master handle — kept alive for resize_terminal(). The reader is moved
    /// into a background thread at spawn time.
    master: Box<dyn MasterPty + Send>,
    /// Child process handle — kept so we can force-kill on cleanup.
    child: Box<dyn Child + Send + Sync>,
}

// ── App-wide PTY state (Tauri managed state) ────────────────────────────────

/// Managed by Tauri — holds all active terminal sessions keyed by UUID.
pub struct PtyState {
    pub(crate) terminals: Mutex<HashMap<String, TerminalInstance>>,
}

/// Managed by Tauri — holds file watchers for CoderNode hot-reload.
/// Keyed by coder node id. Dropping the watcher stops it.
pub struct WatcherState {
    pub(crate) watchers: Mutex<HashMap<String, notify::RecommendedWatcher>>,
}

// ── Event payload ───────────────────────────────────────────────────────────

/// Payload sent from the reader thread → frontend via Tauri events.
/// Must be Clone + Serialize for Tauri's emit().
#[derive(Clone, Serialize)]
struct TerminalOutput {
    data: String,
}

/// Payload for screen-emitted navigation events (feralkit.EventMsg).
#[derive(Clone, Serialize)]
struct TerminalEvent {
    event: String,
}

// ── Shared PTY spawn logic ──────────────────────────────────────────────────

/// Spawn a command in a new PTY and wire it to Tauri events.
///
/// Used by both the old `spawn_terminal` (zsh shell) and `project::install_and_run_screen`
/// (compiled Go binary). Creates the PTY pair, spawns the command on the slave end,
/// starts a reader thread, and stores the instance in PtyState.
pub(crate) fn spawn_pty_with_command(
    id: String,
    cmd: CommandBuilder,
    app: &AppHandle,
    pty_state: &PtyState,
) -> Result<(), String> {
    let pty_system = native_pty_system();

    // Default size — will be resized immediately when xterm's FitAddon runs.
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Spawn the command on the slave end of the PTY.
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    // IMPORTANT: Drop the slave. The child process has its own fd to the slave
    // side. Keeping our reference open would prevent EOF detection when the
    // child exits.
    drop(pair.slave);

    // Clone a reader (stdout from the PTY) for the background thread.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone PTY reader: {e}"))?;

    // Take the writer (stdin to the PTY). In portable-pty 0.9 this is
    // `take_writer()` — it can only be called once per master.
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take PTY writer: {e}"))?;

    // Store the terminal instance in our app-wide state.
    {
        let mut terminals = pty_state
            .terminals
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        terminals.insert(
            id.clone(),
            TerminalInstance {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    // ── Background reader threads (batched output) ────────────────────
    //
    // Two threads form a producer/consumer pair:
    //   Inner thread: blocking reads from PTY → sends chunks via mpsc
    //   Outer thread: recv_timeout(32ms) accumulates chunks, flushes once per frame
    //
    // This prevents partial-frame renders where the frontend gets half a
    // Bubble Tea draw and repaints mid-sequence.

    let output_event = format!("terminal-output-{id}");
    let feral_event = format!("terminal-event-{id}");
    let terminal_id = id.clone();
    let app_clone = app.clone();

    let (tx, rx) = mpsc::channel::<Option<Vec<u8>>>();

    // ── Inner thread: blocking PTY reads → channel ──────────────────
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 16384]; // 16KB buffer

        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    // EOF — signal the outer thread
                    let _ = tx.send(None);
                    break;
                }
                Ok(n) => {
                    let _ = tx.send(Some(buf[..n].to_vec()));
                }
                Err(_) => {
                    let _ = tx.send(None);
                    break;
                }
            }
        }
    });

    // ── Outer thread: batch + emit ──────────────────────────────────
    std::thread::spawn(move || {
        let batch_window = Duration::from_millis(32);

        loop {
            // Block until first chunk arrives (or EOF).
            let first = match rx.recv() {
                Ok(Some(chunk)) => chunk,
                _ => {
                    // EOF or channel closed — emit exit sentinel and stop.
                    let _ = app_clone.emit(
                        &output_event,
                        TerminalOutput {
                            data: "\r\n\x1b[90m[process exited]\x1b[0m\r\n".to_string(),
                        },
                    );
                    break;
                }
            };

            // Accumulate more chunks within the batch window.
            let mut batch = first;
            loop {
                match rx.recv_timeout(batch_window) {
                    Ok(Some(chunk)) => batch.extend_from_slice(&chunk),
                    Ok(None) => {
                        // EOF mid-batch — flush remaining then exit.
                        emit_with_event_scan(
                            &app_clone,
                            &output_event,
                            &feral_event,
                            &batch,
                        );
                        let _ = app_clone.emit(
                            &output_event,
                            TerminalOutput {
                                data: "\r\n\x1b[90m[process exited]\x1b[0m\r\n".to_string(),
                            },
                        );
                        return; // exit the outer thread
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }

            emit_with_event_scan(&app_clone, &output_event, &feral_event, &batch);
        }

        eprintln!("[feral] PTY reader done for {terminal_id}");
    });

    Ok(())
}

/// DEC private mode 2026 (synchronized output) escape sequences.
/// Wrapping PTY output with these tells xterm.js v6+ to suppress rendering
/// until the full frame is ready, eliminating flicker from partial repaints.
/// Bubble Tea v1 does NOT emit these itself — we inject them here.
const SYNC_START: &str = "\x1b[?2026h";
const SYNC_END: &str = "\x1b[?2026l";

/// Emit accumulated PTY output to the frontend, scanning for feralkit event
/// markers (`[feral:event:{name}]`) along the way.
///
/// The output is wrapped in DEC mode 2026 (synchronized output) so xterm.js v6
/// suppresses rendering until the entire batch is written, preventing visible
/// intermediate states (cursor hidden, lines partially rewritten) that cause
/// flicker during rapid Bubble Tea TUI repaints.
fn emit_with_event_scan(
    app: &AppHandle,
    output_event: &str,
    feral_event: &str,
    raw: &[u8],
) {
    let data = String::from_utf8_lossy(raw).to_string();

    // Scan for feralkit event markers in the PTY output.
    // The harness writes "[feral:event:{name}]" to stderr,
    // which the PTY merges into the output stream.
    let mut search_from = 0;
    while let Some(offset) = data[search_from..].find("[feral:event:") {
        let start = search_from + offset + 13; // skip "[feral:event:"
        if let Some(end) = data[start..].find(']') {
            let event_name = data[start..start + end].to_string();
            let _ = app.emit(feral_event, TerminalEvent { event: event_name });
            search_from = start + end + 1;
        } else {
            break;
        }
    }

    // Wrap in synchronized output markers so xterm.js renders atomically.
    let wrapped = format!("{SYNC_START}{data}{SYNC_END}");
    let _ = app.emit(output_event, TerminalOutput { data: wrapped });
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

/// Send user keystrokes (from xterm.onData) to the PTY's stdin.
///
/// Called on every keystroke or paste. The `data` string contains raw terminal
/// input (could be a single char, an escape sequence, or a multi-byte paste).
#[tauri::command]
fn write_to_terminal(
    id: String,
    data: String,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if let Some(term) = terminals.get_mut(&id) {
        term.writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {e}"))?;
        term.writer
            .flush()
            .map_err(|e| format!("Flush failed: {e}"))?;
    }

    Ok(())
}

/// Resize the PTY to match xterm's current dimensions.
///
/// Called by the frontend whenever the TerminalNode is resized (via React
/// Flow's NodeResizer) or when the FitAddon recalculates cols/rows.
/// This triggers a SIGWINCH to the child process so TUI apps re-render.
#[tauri::command]
fn resize_terminal(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyState>,
) -> Result<(), String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if let Some(term) = terminals.get(&id) {
        term.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize failed: {e}"))?;
    }

    Ok(())
}

/// Kill a terminal session and clean up resources.
///
/// Called when a TerminalNode unmounts (user deletes the node).
/// Force-kills the child process before dropping to handle runaway processes.
#[tauri::command]
fn kill_terminal(
    id: String,
    state: State<'_, PtyState>,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    if let Some(mut instance) = terminals.remove(&id) {
        // Force-kill the child process. This handles cases where the process
        // is stuck (e.g., infinite loops in AI-generated code).
        let _ = instance.child.kill();
    }

    // Also stop any file watcher associated with this terminal
    if let Ok(mut watchers) = watcher_state.watchers.lock() {
        watchers.remove(&id); // dropping the watcher stops it
    }

    Ok(())
}

// ── Tauri App Entry Point ───────────────────────────────────────────────────

pub fn run() {
    tauri::Builder::default()
        // Register our PTY state as managed state so commands can access it.
        .manage(PtyState {
            terminals: Mutex::new(HashMap::new()),
        })
        .manage(WatcherState {
            watchers: Mutex::new(HashMap::new()),
        })
        .manage(project::ProjectState::new())
        // Register all IPC commands.
        .invoke_handler(tauri::generate_handler![
            write_to_terminal,
            resize_terminal,
            kill_terminal,
            project::list_templates,
            project::get_template_source,
            project::install_and_run_screen,
            project::rebuild_and_reload_screen,
            project::build_full_app,
            project::eject_project,
            project::save_graph,
            project::load_graph,
            project::save_settings,
            project::load_settings,
            project::spawn_coder_terminal,
            project::get_coder_context,
            project::list_screen_files,
            project::read_screen_file,
            project::save_screen_file,
            project::generate_screen_code,
            project::fetch_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Feral");
}
