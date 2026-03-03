// ============================================================================
// project.rs — Project Manager + Build Orchestrator
// ============================================================================
//
// Manages the on-disk Go project at ~/.feral/projects/default/.
// Handles template installation, harness generation, compilation,
// and launching compiled binaries in a PTY.
// ============================================================================

use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{PtyState, WatcherState};

// ── Assembly engine structs ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct AppEdge {
    source_screen: String,
    source_handle: String,
    target_screen: String,
}

// ── Template structs ────────────────────────────────────────────────────────

#[derive(Deserialize, Serialize)]
struct TemplateYaml {
    name: String,
    category: String,
    description: String,
    outputs: Vec<String>,
}

#[derive(Serialize)]
pub struct TemplateInfo {
    id: String,
    name: String,
    category: String,
    description: String,
    outputs: Vec<String>,
}

// ── Template helpers ────────────────────────────────────────────────────────

/// Resolves the templates directory at runtime.
/// In production: uses Tauri's resource resolver.
/// In dev mode: walks up from the exe to find the project root.
fn resolve_templates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Try Tauri resource resolver first (production builds)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("templates");
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }

    // Dev mode fallback: walk up from exe to find project root
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|p| p.to_path_buf());
        for _ in 0..10 {
            if let Some(ref d) = dir {
                let candidate = d.join("templates");
                if candidate.is_dir() && candidate.join("splash").is_dir() {
                    return Ok(candidate);
                }
                dir = d.parent().map(|p| p.to_path_buf());
            } else {
                break;
            }
        }
    }

    // Last resort: CWD-based (works when launched from project root)
    let cwd_candidate = std::env::current_dir()
        .map(|d| d.join("templates"))
        .unwrap_or_default();
    if cwd_candidate.is_dir() {
        return Ok(cwd_candidate);
    }

    Err("Could not locate templates directory".to_string())
}

/// Scans the templates directory, parses each subfolder's template.yaml.
fn scan_templates(app: &AppHandle) -> Result<Vec<TemplateInfo>, String> {
    let templates_dir = resolve_templates_dir(app)?;
    let mut templates = Vec::new();

    let entries = std::fs::read_dir(&templates_dir)
        .map_err(|e| format!("Failed to read templates dir: {e}"))?;

    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }

        let id = entry.file_name().to_string_lossy().to_string();
        let yaml_path = entry.path().join("template.yaml");

        if !yaml_path.exists() {
            continue;
        }

        let yaml_content = std::fs::read_to_string(&yaml_path)
            .map_err(|e| format!("Failed to read {}: {e}", yaml_path.display()))?;

        let parsed: TemplateYaml = serde_yaml_ng::from_str(&yaml_content)
            .map_err(|e| format!("Failed to parse {}: {e}", yaml_path.display()))?;

        templates.push(TemplateInfo {
            id,
            name: parsed.name,
            category: parsed.category,
            description: parsed.description,
            outputs: parsed.outputs,
        });
    }

    templates.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(templates)
}

/// Reads the Go source file for a template: {id}/{id}.go
fn read_template_source(app: &AppHandle, template_id: &str) -> Result<String, String> {
    let templates_dir = resolve_templates_dir(app)?;
    let go_file = templates_dir
        .join(template_id)
        .join(format!("{template_id}.go"));

    std::fs::read_to_string(&go_file)
        .map_err(|e| format!("Failed to read template source {}: {e}", go_file.display()))
}

/// Copies all .go files from a template directory into the screen directory.
/// Renames the package declaration from template_id to screen_name in each file.
fn install_template_files(
    app: &AppHandle,
    template_id: &str,
    screen_dir: &std::path::Path,
    screen_name: &str,
) -> Result<(), String> {
    let templates_dir = resolve_templates_dir(app)?;
    let template_dir = templates_dir.join(template_id);

    let entries = std::fs::read_dir(&template_dir)
        .map_err(|e| format!("Failed to read template dir: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "go") {
            let filename = entry.file_name();
            let filename_str = filename.to_string_lossy();

            // Determine destination filename: rename {template_id}.go → {screen_name}.go
            let dest_name = if filename_str == format!("{template_id}.go") {
                format!("{screen_name}.go")
            } else {
                filename_str.to_string()
            };

            let dest_path = screen_dir.join(&dest_name);

            // Read source, replace package declaration
            let content = std::fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
            let fixed = content.replacen(
                &format!("package {template_id}"),
                &format!("package {screen_name}"),
                1,
            );

            std::fs::write(&dest_path, &fixed)
                .map_err(|e| format!("Failed to write {}: {e}", dest_path.display()))?;
        }
    }

    Ok(())
}

// ── Managed state ───────────────────────────────────────────────────────────

/// Holds the lazily-initialized project root path.
pub struct ProjectState {
    root: Mutex<Option<PathBuf>>,
}

impl ProjectState {
    pub fn new() -> Self {
        Self {
            root: Mutex::new(None),
        }
    }
}

// ── Helper: find Go binary ──────────────────────────────────────────────────

/// Resolves the `go` binary path. macOS GUI apps don't inherit shell PATH,
/// so we check common Homebrew and system locations as fallback.
fn find_go_binary() -> Result<String, String> {
    // Try PATH first (works in terminal-launched dev mode)
    if let Ok(output) = std::process::Command::new("which").arg("go").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path);
            }
        }
    }

    // Fallback: common macOS locations
    let fallbacks = ["/opt/homebrew/bin/go", "/usr/local/go/bin/go"];
    for path in &fallbacks {
        if std::path::Path::new(path).exists() {
            return Ok(path.to_string());
        }
    }

    Err("Go binary not found. Install Go: https://go.dev/dl/".to_string())
}

// ── Helper: ensure project exists ───────────────────────────────────────────

/// Lazily initializes the Go project at ~/.feral/projects/default/.
/// Creates directory structure and runs `go mod init` + `go get` on first call.
fn ensure_project(state: &ProjectState) -> Result<PathBuf, String> {
    let mut root_guard = state
        .root
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;

    // Return cached path if already initialized
    if let Some(ref path) = *root_guard {
        return Ok(path.clone());
    }

    let go_bin = find_go_binary()?;

    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let root = PathBuf::from(home)
        .join(".feral")
        .join("projects")
        .join("default");

    // Create directory structure
    let dirs = ["screens", ".harness", ".build", "feralkit"];
    for dir in &dirs {
        std::fs::create_dir_all(root.join(dir))
            .map_err(|e| format!("Failed to create {dir}: {e}"))?;
    }

    // Write feralkit helper package
    let feralkit_path = root.join("feralkit").join("feralkit.go");
    if !feralkit_path.exists() {
        std::fs::write(
            &feralkit_path,
            r#"package feralkit

import tea "github.com/charmbracelet/bubbletea"

// EventMsg is emitted by screens to signal navigation transitions.
// The harness intercepts this, prints it to stderr for Feral to detect,
// and exits the program.
type EventMsg struct{ Name string }

// EmitEvent returns a tea.Cmd that fires an EventMsg.
func EmitEvent(name string) tea.Cmd {
	return func() tea.Msg { return EventMsg{Name: name} }
}
"#,
        )
        .map_err(|e| format!("Failed to write feralkit: {e}"))?;
    }

    // Initialize go module if go.mod doesn't exist
    let go_mod = root.join("go.mod");
    if !go_mod.exists() {
        let output = std::process::Command::new(&go_bin)
            .args(["mod", "init", "feral.dev/default"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("go mod init failed: {e}"))?;

        if !output.status.success() {
            return Err(format!(
                "go mod init failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        // Explicitly add bubbletea dependency (avoids go mod tidy issues with dot-dirs)
        let output = std::process::Command::new(&go_bin)
            .args(["get", "github.com/charmbracelet/bubbletea@latest"])
            .current_dir(&root)
            .output()
            .map_err(|e| format!("go get failed: {e}"))?;

        if !output.status.success() {
            return Err(format!(
                "go get bubbletea failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }

    *root_guard = Some(root.clone());
    Ok(root)
}

// ── Helper: compile a screen ────────────────────────────────────────────────

/// Compiles `screens/{name}` via `.harness/{name}` and returns the binary path.
/// Runs `go mod tidy` first to resolve any new imports introduced by AI.
/// Used by both initial install and hot-reload.
fn build_screen(root: &PathBuf, go_bin: &str, screen_name: &str) -> Result<PathBuf, String> {
    // Run go mod tidy to resolve new dependencies (AI may introduce new imports)
    let tidy_output = std::process::Command::new(go_bin)
        .args(["mod", "tidy"])
        .current_dir(root)
        .output()
        .map_err(|e| format!("go mod tidy failed to start: {e}"))?;

    if !tidy_output.status.success() {
        // Log but don't fail — go build will give a better error
        eprintln!(
            "[feral] go mod tidy warning: {}",
            String::from_utf8_lossy(&tidy_output.stderr)
        );
    }

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let binary_name = format!("{screen_name}_{millis}");
    let binary_path = root.join(".build").join(&binary_name);

    let output = std::process::Command::new(go_bin)
        .args([
            "build",
            "-o",
            binary_path.to_str().unwrap_or(""),
            &format!("./.harness/{screen_name}/"),
        ])
        .current_dir(root)
        .output()
        .map_err(|e| format!("go build failed to start: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Build failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(binary_path)
}

/// Cleans up old binaries for a screen, keeping only `keep_path`.
fn cleanup_old_binaries(root: &PathBuf, screen_name: &str, keep_path: &PathBuf) {
    let build_dir = root.join(".build");
    let prefix = format!("{screen_name}_");
    if let Ok(entries) = std::fs::read_dir(&build_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with(&prefix) && entry.path() != *keep_path {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

// ── Event payload for reload ────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct ReloadPayload {
    binary_path: String,
}

// ── Event payload for AI generation status ──────────────────────────────────

#[derive(Clone, Serialize)]
struct AiGenerationStatus {
    status: String,
    provider: String,
    model: String,
    error: Option<String>,
}

// ── Tauri commands ──────────────────────────────────────────────────────────

/// List all available templates by scanning the templates directory.
#[tauri::command]
pub async fn list_templates(app: AppHandle) -> Result<Vec<TemplateInfo>, String> {
    scan_templates(&app)
}

/// Get the default Go source for a template.
#[tauri::command]
pub async fn get_template_source(
    template_id: String,
    app: AppHandle,
) -> Result<String, String> {
    read_template_source(&app, &template_id)
}

/// Install a screen template, compile it, and run the binary in a PTY.
///
/// 1. Ensures the Go project exists
/// 2. Writes the template source to screens/{name}/{name}.go
/// 3. Generates a harness at .harness/{name}/main.go
/// 4. Compiles with `go build`
/// 5. Spawns the binary in a PTY via spawn_pty_with_command
#[tauri::command]
pub async fn install_and_run_screen(
    screen_name: String,
    template_id: String,
    node_id: String,
    app: AppHandle,
    pty_state: State<'_, PtyState>,
    project_state: State<'_, ProjectState>,
) -> Result<String, String> {
    let root = ensure_project(&project_state)?;
    let go_bin = find_go_binary()?;

    // Install template files: copy all .go files from template dir to screen dir
    // Skip if main screen file already exists (rehydration — preserves user edits on reload)
    let screen_dir = root.join("screens").join(&screen_name);
    std::fs::create_dir_all(&screen_dir)
        .map_err(|e| format!("Failed to create screen dir: {e}"))?;

    let screen_file = screen_dir.join(format!("{screen_name}.go"));
    if !screen_file.exists() {
        install_template_files(&app, &template_id, &screen_dir, &screen_name)?;
    }

    // Generate harness: .harness/{name}/main.go
    let harness_dir = root.join(".harness").join(&screen_name);
    std::fs::create_dir_all(&harness_dir)
        .map_err(|e| format!("Failed to create harness dir: {e}"))?;

    let harness_source = format!(
        r#"package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"{module}/feralkit"
	"{module}/screens/{name}"
)

// wrapper intercepts feralkit.EventMsg before delegating to the screen.
type wrapper struct {{
	inner tea.Model
}}

func (w wrapper) Init() tea.Cmd {{
	return w.inner.Init()
}}

func (w wrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {{
	if evt, ok := msg.(feralkit.EventMsg); ok {{
		fmt.Fprintf(os.Stderr, "\n[feral:event:%s]\n", evt.Name)
		return w, tea.Quit
	}}
	m, cmd := w.inner.Update(msg)
	w.inner = m
	return w, cmd
}}

func (w wrapper) View() string {{
	return w.inner.View()
}}

func main() {{
	p := tea.NewProgram(wrapper{{inner: {name}.New()}}, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {{
		os.Exit(1)
	}}
}}
"#,
        module = "feral.dev/default",
        name = screen_name,
    );

    let harness_file = harness_dir.join("main.go");
    std::fs::write(&harness_file, harness_source)
        .map_err(|e| format!("Failed to write harness: {e}"))?;

    // Compile
    let binary_path = build_screen(&root, &go_bin, &screen_name)?;

    // Spawn the compiled binary in a PTY
    let mut cmd = CommandBuilder::new(&binary_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");

    crate::spawn_pty_with_command(node_id, cmd, &app, &pty_state)?;

    Ok(binary_path.to_string_lossy().to_string())
}

/// Hot-reload: overwrite screen source, recompile, swap the PTY process.
///
/// 1. Writes `new_source` to screens/{name}/{name}.go
/// 2. Compiles via go build
/// 3. Kills the old PTY child and removes the instance
/// 4. Emits `terminal-reload-{node_id}` so frontend can reset xterm
/// 5. Spawns the new binary in a fresh PTY
/// 6. Cleans up old binaries
#[tauri::command]
pub async fn rebuild_and_reload_screen(
    screen_name: String,
    new_source: String,
    node_id: String,
    app: AppHandle,
    pty_state: State<'_, PtyState>,
    project_state: State<'_, ProjectState>,
) -> Result<String, String> {
    let root = ensure_project(&project_state)?;
    let go_bin = find_go_binary()?;

    // Overwrite the screen source
    let screen_file = root
        .join("screens")
        .join(&screen_name)
        .join(format!("{screen_name}.go"));
    std::fs::write(&screen_file, &new_source)
        .map_err(|e| format!("Failed to write screen source: {e}"))?;

    // Compile — if this fails, we return the error and leave the old process running
    let binary_path = build_screen(&root, &go_bin, &screen_name)?;

    // Kill the old process
    {
        let mut terminals = pty_state
            .terminals
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(mut old) = terminals.remove(&node_id) {
            let _ = old.child.kill();
        }
    }

    // Brief pause to let the old PTY reader thread see EOF
    std::thread::sleep(Duration::from_millis(50));

    // Tell the frontend to reset its xterm before new output arrives
    let _ = app.emit(
        &format!("terminal-reload-{node_id}"),
        ReloadPayload {
            binary_path: binary_path.to_string_lossy().to_string(),
        },
    );

    // Spawn the new binary
    let mut cmd = CommandBuilder::new(&binary_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");

    crate::spawn_pty_with_command(node_id, cmd, &app, &pty_state)?;

    // Clean up old binaries in the background
    cleanup_old_binaries(&root, &screen_name, &binary_path);

    Ok(binary_path.to_string_lossy().to_string())
}

// ── Assembly engine helpers ──────────────────────────────────────────────────

/// Converts a snake_case name to PascalCase. "splash" → "Splash", "main_menu" → "MainMenu"
fn to_pascal_case(s: &str) -> String {
    s.split('_')
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

/// Generates the full-app `main.go` source from edges and a start screen.
/// Reused by both `build_full_app` and `eject_project`.
fn generate_full_app_source(edges: &[AppEdge], start_screen: &str, module_path: &str) -> String {
    // Collect unique screen names (preserving order, start screen first)
    let mut screens: Vec<String> = vec![start_screen.to_string()];
    for edge in edges {
        if !screens.contains(&edge.source_screen) {
            screens.push(edge.source_screen.clone());
        }
        if !screens.contains(&edge.target_screen) {
            screens.push(edge.target_screen.clone());
        }
    }

    // Build import lines
    let imports: Vec<String> = screens
        .iter()
        .map(|s| format!("\t\"{module_path}/screens/{s}\""))
        .collect();

    // Build screenID enum
    let enum_lines: Vec<String> = screens
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let pascal = to_pascal_case(s);
            if i == 0 {
                format!("\tscreen{pascal} screenID = iota")
            } else {
                format!("\tscreen{pascal}")
            }
        })
        .collect();

    // Build newScreen switch cases
    let new_screen_cases: Vec<String> = screens
        .iter()
        .map(|s| {
            let pascal = to_pascal_case(s);
            format!("\tcase screen{pascal}:\n\t\treturn {s}.New()")
        })
        .collect();

    // Group route cases by source screen
    let mut route_by_source: std::collections::HashMap<String, Vec<(String, String)>> =
        std::collections::HashMap::new();
    for edge in edges {
        route_by_source
            .entry(edge.source_screen.clone())
            .or_default()
            .push((edge.source_handle.clone(), edge.target_screen.clone()));
    }

    let mut grouped_route_cases: Vec<String> = Vec::new();
    for screen in &screens {
        if let Some(handlers) = route_by_source.get(screen) {
            let pascal = to_pascal_case(screen);
            let mut inner_cases: Vec<String> = Vec::new();
            for (handle, target) in handlers {
                let tgt_pascal = to_pascal_case(target);
                inner_cases.push(format!(
                    "\t\tcase \"{handle}\":\n\t\t\treturn screen{tgt_pascal}, false"
                ));
            }
            grouped_route_cases.push(format!(
                "\tcase screen{pascal}:\n\t\tswitch event {{\n{inner}\n\t\t}}",
                inner = inner_cases.join("\n"),
            ));
        }
    }

    let start_pascal = to_pascal_case(start_screen);

    format!(
        r#"package main

import (
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
{imports}
	"{module_path}/feralkit"
)

type screenID int

const (
{enum_lines}
)

func newScreen(id screenID) tea.Model {{
	switch id {{
{new_screen_cases}
	default:
		fmt.Fprintf(os.Stderr, "unknown screen: %d\n", id)
		os.Exit(1)
		return nil
	}}
}}

func route(from screenID, event string) (screenID, bool) {{
	switch from {{
{grouped_route_cases}
	}}
	return from, true
}}

type wrapper struct {{
	inner tea.Model
	event string
}}

func (w *wrapper) Init() tea.Cmd {{
	return w.inner.Init()
}}

func (w *wrapper) Update(msg tea.Msg) (tea.Model, tea.Cmd) {{
	if evt, ok := msg.(feralkit.EventMsg); ok {{
		w.event = evt.Name
		return w, tea.Quit
	}}
	m, cmd := w.inner.Update(msg)
	w.inner = m
	return w, cmd
}}

func (w *wrapper) View() string {{
	return w.inner.View()
}}

func runScreen(m tea.Model) string {{
	w := &wrapper{{inner: m}}
	p := tea.NewProgram(w, tea.WithAltScreen())
	finalModel, err := p.Run()
	if err != nil {{
		fmt.Fprintf(os.Stderr, "runtime error: %v\n", err)
		os.Exit(1)
	}}
	return finalModel.(*wrapper).event
}}

func main() {{
	current := screen{start_pascal}
	for {{
		m := newScreen(current)
		event := runScreen(m)
		next, quit := route(current, event)
		if quit {{
			break
		}}
		current = next
	}}
}}
"#,
        imports = imports.join("\n"),
        enum_lines = enum_lines.join("\n"),
        new_screen_cases = new_screen_cases.join("\n"),
        grouped_route_cases = grouped_route_cases.join("\n"),
        start_pascal = start_pascal,
        module_path = module_path,
    )
}

// ── Assembly engine commands ─────────────────────────────────────────────────

/// Build and run the full assembled app from screen edges.
///
/// 1. Generates main.go at project root from edge graph
/// 2. Compiles with `go build`
/// 3. Deletes main.go (avoids conflict with harness builds)
/// 4. Spawns binary in PTY
/// 5. Cleans up old full_app binaries
#[tauri::command]
pub async fn build_full_app(
    edges_json: String,
    start_screen: String,
    runner_node_id: String,
    app: AppHandle,
    pty_state: State<'_, PtyState>,
    project_state: State<'_, ProjectState>,
) -> Result<String, String> {
    let root = ensure_project(&project_state)?;
    let go_bin = find_go_binary()?;

    let edges: Vec<AppEdge> =
        serde_json::from_str(&edges_json).map_err(|e| format!("Invalid edges JSON: {e}"))?;

    // Generate main.go
    let source = generate_full_app_source(&edges, &start_screen, "feral.dev/default");
    let main_go = root.join("main.go");
    std::fs::write(&main_go, &source)
        .map_err(|e| format!("Failed to write main.go: {e}"))?;

    // Build
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let binary_name = format!("full_app_{millis}");
    let binary_path = root.join(".build").join(&binary_name);

    let output = std::process::Command::new(&go_bin)
        .args([
            "build",
            "-o",
            binary_path.to_str().unwrap_or(""),
            ".",
        ])
        .current_dir(&root)
        .output()
        .map_err(|e| format!("go build failed to start: {e}"))?;

    // Always delete main.go after build (prevents conflict with harness builds)
    let _ = std::fs::remove_file(&main_go);

    if !output.status.success() {
        return Err(format!(
            "Build failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Kill any existing terminal for this node (guards against double-mount)
    {
        let mut terminals = pty_state
            .terminals
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(mut old) = terminals.remove(&runner_node_id) {
            let _ = old.child.kill();
        }
    }

    std::thread::sleep(Duration::from_millis(50));

    // Spawn in PTY
    let mut cmd = CommandBuilder::new(&binary_path);
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");

    crate::spawn_pty_with_command(runner_node_id, cmd, &app, &pty_state)?;

    // Clean up old full_app binaries
    cleanup_old_binaries(&root, "full_app", &binary_path);

    Ok(binary_path.to_string_lossy().to_string())
}

/// Copy a directory recursively.
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create dir {}: {e}", dst.display()))?;

    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read dir {}: {e}", src.display()))?;

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let dest_path = dst.join(entry.file_name());

        if entry_path.is_dir() {
            copy_dir_recursive(&entry_path, &dest_path)?;
        } else {
            std::fs::copy(&entry_path, &dest_path).map_err(|e| {
                format!(
                    "Failed to copy {} → {}: {e}",
                    entry_path.display(),
                    dest_path.display()
                )
            })?;
        }
    }

    Ok(())
}

/// Eject the project as a standalone Go application.
///
/// 1. Copies screens referenced in the edge graph
/// 2. Copies feralkit/
/// 3. Generates main.go
/// 4. Copies go.mod + go.sum
#[tauri::command]
pub async fn eject_project(
    output_dir: String,
    edges_json: String,
    start_screen: String,
    project_state: State<'_, ProjectState>,
) -> Result<String, String> {
    let root = ensure_project(&project_state)?;

    let edges: Vec<AppEdge> =
        serde_json::from_str(&edges_json).map_err(|e| format!("Invalid edges JSON: {e}"))?;

    // Expand ~ in output path
    let output = if output_dir.starts_with('~') {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        PathBuf::from(output_dir.replacen('~', &home, 1))
    } else {
        PathBuf::from(&output_dir)
    };

    std::fs::create_dir_all(&output)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    // Collect unique screen names from edges
    let mut screen_names: Vec<String> = vec![start_screen.clone()];
    for edge in &edges {
        if !screen_names.contains(&edge.source_screen) {
            screen_names.push(edge.source_screen.clone());
        }
        if !screen_names.contains(&edge.target_screen) {
            screen_names.push(edge.target_screen.clone());
        }
    }

    // Copy screens
    let screens_dst = output.join("screens");
    for name in &screen_names {
        let src = root.join("screens").join(name);
        if src.is_dir() {
            copy_dir_recursive(&src, &screens_dst.join(name))?;
        }
    }

    // Copy feralkit
    let feralkit_src = root.join("feralkit");
    if feralkit_src.is_dir() {
        copy_dir_recursive(&feralkit_src, &output.join("feralkit"))?;
    }

    // Generate main.go
    let source = generate_full_app_source(&edges, &start_screen, "feral.dev/default");
    std::fs::write(output.join("main.go"), &source)
        .map_err(|e| format!("Failed to write main.go: {e}"))?;

    // Copy go.mod + go.sum
    for file in &["go.mod", "go.sum"] {
        let src = root.join(file);
        if src.exists() {
            std::fs::copy(&src, output.join(file))
                .map_err(|e| format!("Failed to copy {file}: {e}"))?;
        }
    }

    Ok(output.to_string_lossy().to_string())
}

// ── Graph persistence ────────────────────────────────────────────────────────

/// Save the React Flow graph (nodes + edges) to graph.json in the project dir.
#[tauri::command]
pub async fn save_graph(
    graph_data: String,
    project_state: State<'_, ProjectState>,
) -> Result<(), String> {
    let root = ensure_project(&project_state)?;
    let graph_path = root.join("graph.json");
    std::fs::write(&graph_path, &graph_data)
        .map_err(|e| format!("Failed to write graph.json: {e}"))?;
    Ok(())
}

/// Load the React Flow graph from graph.json. Returns None if it doesn't exist.
#[tauri::command]
pub async fn load_graph(
    project_state: State<'_, ProjectState>,
) -> Result<Option<String>, String> {
    let root = ensure_project(&project_state)?;
    let graph_path = root.join("graph.json");
    if graph_path.exists() {
        let data = std::fs::read_to_string(&graph_path)
            .map_err(|e| format!("Failed to read graph.json: {e}"))?;
        Ok(Some(data))
    } else {
        Ok(None)
    }
}

// ── Settings persistence ─────────────────────────────────────────────────────

/// Save settings JSON to ~/.feral/settings.json (app-wide, not per-project).
#[tauri::command]
pub async fn save_settings(settings_json: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let settings_path = PathBuf::from(home).join(".feral").join("settings.json");
    std::fs::create_dir_all(settings_path.parent().unwrap())
        .map_err(|e| format!("Failed to create .feral dir: {e}"))?;
    std::fs::write(&settings_path, &settings_json)
        .map_err(|e| format!("Failed to write settings.json: {e}"))?;
    Ok(())
}

/// Load settings JSON from ~/.feral/settings.json.
#[tauri::command]
pub async fn load_settings() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let settings_path = PathBuf::from(home).join(".feral").join("settings.json");
    if settings_path.exists() {
        let data = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {e}"))?;
        Ok(Some(data))
    } else {
        Ok(None)
    }
}

// ── CoderNode helpers ─────────────────────────────────────────────────────────

/// Spawn a zsh shell in a screen's directory and inject a CLI coding assistant.
/// Optionally starts a file watcher for hot-reload when `screen_node_id` is provided.
#[tauri::command]
pub async fn spawn_coder_terminal(
    node_id: String,
    screen_name: String,
    screen_node_id: Option<String>,
    app: AppHandle,
    pty_state: State<'_, PtyState>,
    project_state: State<'_, ProjectState>,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let root = ensure_project(&project_state)?;
    let screen_dir = root.join("screens").join(&screen_name);
    std::fs::create_dir_all(&screen_dir)
        .map_err(|e| format!("Failed to create screen dir: {e}"))?;

    let mut cmd = CommandBuilder::new("zsh");
    cmd.cwd(&screen_dir);
    cmd.env("TERM", "xterm-256color");
    cmd.env("LANG", "en_US.UTF-8");

    crate::spawn_pty_with_command(node_id.clone(), cmd, &app, &pty_state)?;

    // Wait for shell to init, then inject CLI assistant launch
    std::thread::sleep(Duration::from_millis(500));
    {
        let mut terminals = pty_state
            .terminals
            .lock()
            .map_err(|e| format!("Lock poisoned: {e}"))?;
        if let Some(term) = terminals.get_mut(&node_id) {
            term.writer
                .write_all(b"claude\n")
                .map_err(|e| format!("Write failed: {e}"))?;
            term.writer
                .flush()
                .map_err(|e| format!("Flush failed: {e}"))?;
        }
    }

    // Start a file watcher on the screen directory for hot-reload
    if let Some(sn_id) = screen_node_id {
        start_screen_watcher(
            &node_id,
            &screen_name,
            &sn_id,
            &root,
            &screen_dir,
            &app,
            &watcher_state,
        )?;
    }

    Ok(())
}

/// Start a notify file watcher on a screen's directory.
/// When any .go file is modified, automatically rebuild and hot-reload the ScreenNode preview.
fn start_screen_watcher(
    coder_node_id: &str,
    screen_name: &str,
    screen_node_id: &str,
    project_root: &std::path::Path,
    screen_dir: &std::path::Path,
    app: &AppHandle,
    watcher_state: &WatcherState,
) -> Result<(), String> {
    use crate::notify::{self, RecursiveMode, Watcher};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let screen_name = screen_name.to_string();
    let screen_node_id = screen_node_id.to_string();
    let project_root = project_root.to_path_buf();
    let screen_dir_path = screen_dir.to_path_buf();
    let app_clone = app.clone();

    // Debounce flag — prevents overlapping rebuilds
    let rebuilding = Arc::new(AtomicBool::new(false));
    let rebuilding_clone = rebuilding.clone();

    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        let event = match res {
            Ok(e) => e,
            Err(_) => return,
        };

        // Only react to file modifications/creations
        use notify::EventKind;
        match event.kind {
            EventKind::Modify(_) | EventKind::Create(_) => {}
            _ => return,
        }

        // Only .go files
        let has_go_file = event.paths.iter().any(|p| {
            p.extension().map_or(false, |ext| ext == "go")
        });
        if !has_go_file {
            return;
        }

        // Debounce: skip if already rebuilding
        if rebuilding_clone.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }

        let screen_name = screen_name.clone();
        let screen_node_id = screen_node_id.clone();
        let project_root = project_root.clone();
        let app = app_clone.clone();
        let rebuilding = rebuilding_clone.clone();

        // Spawn rebuild in a new thread to avoid blocking the watcher
        std::thread::spawn(move || {
            // Small delay to let the editor finish flushing writes
            std::thread::sleep(Duration::from_millis(300));

            let go_bin = match find_go_binary() {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("[feral] Watcher: go binary not found: {e}");
                    rebuilding.store(false, Ordering::SeqCst);
                    return;
                }
            };

            match build_screen(&project_root, &go_bin, &screen_name) {
                Ok(binary_path) => {
                    // Kill old process for the screen node
                    if let Some(pty_state) = app.try_state::<crate::PtyState>() {
                        let mut terminals = pty_state.terminals.lock().unwrap();
                        if let Some(mut old) = terminals.remove(&screen_node_id) {
                            let _ = old.child.kill();
                        }
                        drop(terminals);

                        std::thread::sleep(Duration::from_millis(50));

                        // Emit reload event so frontend resets xterm
                        let _ = app.emit(
                            &format!("terminal-reload-{screen_node_id}"),
                            ReloadPayload {
                                binary_path: binary_path.to_string_lossy().to_string(),
                            },
                        );

                        // Spawn new binary
                        let mut cmd = CommandBuilder::new(&binary_path);
                        cmd.env("TERM", "xterm-256color");
                        cmd.env("LANG", "en_US.UTF-8");

                        if let Err(e) = crate::spawn_pty_with_command(
                            screen_node_id.clone(),
                            cmd,
                            &app,
                            &pty_state,
                        ) {
                            eprintln!("[feral] Watcher: failed to spawn new binary: {e}");
                        }

                        cleanup_old_binaries(&project_root, &screen_name, &binary_path);
                    }
                }
                Err(e) => {
                    eprintln!("[feral] Watcher: build failed: {e}");
                }
            }

            // Allow next rebuild after a cooldown
            std::thread::sleep(Duration::from_millis(500));
            rebuilding.store(false, Ordering::SeqCst);
        });
    }).map_err(|e| format!("Failed to create file watcher: {e}"))?;

    watcher
        .watch(&screen_dir_path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    // Store watcher — dropping it stops watching
    let mut watchers = watcher_state
        .watchers
        .lock()
        .map_err(|e| format!("Lock poisoned: {e}"))?;
    watchers.insert(coder_node_id.to_string(), watcher);

    Ok(())
}

// ── Screen file management ──────────────────────────────────────────────

/// List all .go files in a screen's directory. Returns filenames only (not paths).
#[tauri::command]
pub async fn list_screen_files(
    screen_name: String,
    project_state: State<'_, ProjectState>,
) -> Result<Vec<String>, String> {
    let root = ensure_project(&project_state)?;
    let screen_dir = root.join("screens").join(&screen_name);

    if !screen_dir.is_dir() {
        return Ok(vec![]);
    }

    let mut files: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&screen_dir)
        .map_err(|e| format!("Failed to read screen dir: {e}"))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "go") {
            if let Some(name) = path.file_name() {
                files.push(name.to_string_lossy().to_string());
            }
        }
    }

    // Sort with main file first, then alphabetically
    let main_file = format!("{screen_name}.go");
    files.sort_by(|a, b| {
        if *a == main_file {
            std::cmp::Ordering::Less
        } else if *b == main_file {
            std::cmp::Ordering::Greater
        } else {
            a.cmp(b)
        }
    });

    Ok(files)
}

/// Read a specific .go file from a screen's directory.
#[tauri::command]
pub async fn read_screen_file(
    screen_name: String,
    filename: String,
    project_state: State<'_, ProjectState>,
) -> Result<String, String> {
    let root = ensure_project(&project_state)?;
    let file_path = root
        .join("screens")
        .join(&screen_name)
        .join(&filename);

    std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {e}", file_path.display()))
}

/// Save a specific .go file in a screen's directory.
#[tauri::command]
pub async fn save_screen_file(
    screen_name: String,
    filename: String,
    source: String,
    project_state: State<'_, ProjectState>,
) -> Result<(), String> {
    let root = ensure_project(&project_state)?;
    let file_path = root
        .join("screens")
        .join(&screen_name)
        .join(&filename);

    std::fs::write(&file_path, &source)
        .map_err(|e| format!("Failed to write {}: {e}", file_path.display()))
}

// ── Model fetching ──────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub async fn fetch_models(
    provider: String,
    api_key: String,
    ollama_url: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    let client = reqwest::Client::new();

    let mut models: Vec<ModelInfo> = match provider.as_str() {
        "anthropic" => {
            if api_key.is_empty() {
                return Err("API key required".to_string());
            }
            let resp = client
                .get("https://api.anthropic.com/v1/models")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("API error: {}", resp.status()));
            }

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Parse failed: {e}"))?;

            body.get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            let name = m
                                .get("display_name")
                                .and_then(|n| n.as_str())
                                .unwrap_or_else(|| m.get("id").and_then(|i| i.as_str()).unwrap_or(""))
                                .to_string();
                            Some(ModelInfo { id, name })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "openai" => {
            if api_key.is_empty() {
                return Err("API key required".to_string());
            }
            let resp = client
                .get("https://api.openai.com/v1/models")
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("API error: {}", resp.status()));
            }

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Parse failed: {e}"))?;

            body.get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            Some(ModelInfo {
                                name: id.clone(),
                                id,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "groq" => {
            if api_key.is_empty() {
                return Err("API key required".to_string());
            }
            let resp = client
                .get("https://api.groq.com/openai/v1/models")
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("API error: {}", resp.status()));
            }

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Parse failed: {e}"))?;

            body.get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            Some(ModelInfo {
                                name: id.clone(),
                                id,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "openrouter" => {
            if api_key.is_empty() {
                return Err("API key required".to_string());
            }
            let resp = client
                .get("https://openrouter.ai/api/v1/models")
                .header("Authorization", format!("Bearer {api_key}"))
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("API error: {}", resp.status()));
            }

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Parse failed: {e}"))?;

            body.get("data")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let id = m.get("id")?.as_str()?.to_string();
                            let name = m
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or(&id)
                                .to_string();
                            Some(ModelInfo { id, name })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        "ollama" => {
            let base_url = ollama_url
                .as_deref()
                .unwrap_or("http://localhost:11434");
            let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Request failed: {e}"))?;

            if !resp.status().is_success() {
                return Err(format!("Ollama error: {}", resp.status()));
            }

            let body: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Parse failed: {e}"))?;

            body.get("models")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|m| {
                            let name = m.get("name")?.as_str()?.to_string();
                            Some(ModelInfo {
                                id: name.clone(),
                                name,
                            })
                        })
                        .collect()
                })
                .unwrap_or_default()
        }
        _ => return Err(format!("Unknown provider: {provider}")),
    };

    models.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(models)
}

// ── AI LLM client ────────────────────────────────────────────────────────────

/// Call an LLM provider and return the response text.
///
/// Handles five provider APIs:
/// - Anthropic: POST /v1/messages (Messages API)
/// - OpenAI/Groq/OpenRouter: POST /v1/chat/completions (OpenAI-compatible)
/// - Ollama: POST /api/chat (local)
async fn call_llm(
    provider: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_url: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    match provider {
        "anthropic" => {
            if api_key.is_empty() {
                return Err("Anthropic API key not configured".to_string());
            }
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 8192,
                "system": system_prompt,
                "messages": [
                    { "role": "user", "content": user_prompt }
                ]
            });

            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Anthropic request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error {status}: {text}"));
            }

            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse Anthropic response: {e}"))?;

            json.get("content")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|block| block.get("text"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "No text in Anthropic response".to_string())
        }
        "openai" | "groq" | "openrouter" => {
            if api_key.is_empty() {
                return Err(format!("{provider} API key not configured"));
            }

            let url = match provider {
                "openai" => "https://api.openai.com/v1/chat/completions",
                "groq" => "https://api.groq.com/openai/v1/chat/completions",
                "openrouter" => "https://openrouter.ai/api/v1/chat/completions",
                _ => unreachable!(),
            };

            let body = serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ],
                "temperature": 0
            });

            let resp = client
                .post(url)
                .header("Authorization", format!("Bearer {api_key}"))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("{provider} request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("{provider} API error {status}: {text}"));
            }

            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse {provider} response: {e}"))?;

            json.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|arr| arr.first())
                .and_then(|choice| choice.get("message"))
                .and_then(|msg| msg.get("content"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| format!("No content in {provider} response"))
        }
        "ollama" => {
            let base = if ollama_url.is_empty() {
                "http://localhost:11434"
            } else {
                ollama_url
            };
            let url = format!("{}/api/chat", base.trim_end_matches('/'));

            let body = serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ],
                "stream": false
            });

            let resp = client
                .post(&url)
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Ollama request failed: {e}"))?;

            if !resp.status().is_success() {
                let status = resp.status();
                let text = resp.text().await.unwrap_or_default();
                return Err(format!("Ollama error {status}: {text}"));
            }

            let json: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse Ollama response: {e}"))?;

            json.get("message")
                .and_then(|msg| msg.get("content"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "No content in Ollama response".to_string())
        }
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

/// Pick a fast/cheap router model for the given provider.
/// The router only needs to output a filename — any small model works.
fn router_model_for_provider(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "claude-sonnet-4-20250514",
        "openai" => "gpt-4o-mini",
        "groq" => "llama-3.3-70b-versatile",
        "openrouter" => "meta-llama/llama-3.3-70b-instruct",
        "ollama" => "", // will use user's selected model
        _ => "",
    }
}

/// Extract Go source code from an LLM response.
///
/// Handles responses wrapped in markdown code fences (```go ... ``` or ``` ... ```).
/// If no fences found, returns the raw response (the LLM may have returned plain code).
fn extract_go_code(response: &str) -> String {
    let trimmed = response.trim();

    // Try to find ```go or ``` fence
    let fence_start = if let Some(pos) = trimmed.find("```go") {
        Some(pos + 5) // skip "```go"
    } else if let Some(pos) = trimmed.find("```Go") {
        Some(pos + 5)
    } else if let Some(pos) = trimmed.find("```golang") {
        Some(pos + 9)
    } else if let Some(pos) = trimmed.find("```") {
        Some(pos + 3)
    } else {
        None
    };

    if let Some(start) = fence_start {
        let after_fence = &trimmed[start..];
        // Skip any newline right after the fence marker
        let code_start = if after_fence.starts_with('\n') {
            1
        } else if after_fence.starts_with("\r\n") {
            2
        } else {
            0
        };
        let code_region = &after_fence[code_start..];

        // Find the closing fence
        if let Some(end) = code_region.rfind("```") {
            return code_region[..end].trim_end().to_string();
        }
        // No closing fence — return everything after opening fence
        return code_region.trim_end().to_string();
    }

    // No fences at all — return as-is (the model returned raw code)
    trimmed.to_string()
}

// ── AI engine router ─────────────────────────────────────────────────────────

/// Generate or modify screen code using AI.
///
/// Two-step pipeline:
/// 1. Router call — pick which file to edit (skipped for single-file screens)
/// 2. Editor call — generate the code with full context
///
/// Build a dynamic system prompt based on the target node type.
fn build_system_prompt(
    _target_node_type: &str,
    screen_name: &str,
    target_file: &str,
    context_files: &[(String, String)],
) -> String {
    let context_section = if context_files.is_empty() {
        String::new()
    } else {
        let mut ctx = String::from("\n\nHere are the other files in this package for context (READ-ONLY, do not reproduce them):\n");
        for (name, content) in context_files {
            ctx.push_str(&format!("\n--- {name} ---\n{content}\n"));
        }
        ctx
    };

    // Only screen nodes are supported now (action node type was removed)
    format!(
            "You are an expert Go developer EDITING an existing screen file for a Bubble Tea application.\n\
             CRITICAL RULES:\n\
             1. You are EDITING the existing file `{target_file}` in package `{name}`. You will receive its current code below.\n\
             2. The package MUST remain `package {name}`.\n\
             3. DO NOT write a `func main()`. This file is imported as a library.\n\
             4. DO NOT try to route to other screens or import other screens.\n\
             5. If the user asks to navigate, return `feralkit.EmitEvent(\"event_name\")` and the visual node editor will handle the routing.\n\
             6. Return ONLY valid Go code inside a markdown code block (```go). No explanations.\n\
             7. PRESERVE the existing code structure, types, functions, imports, and functionality. Only modify what is necessary to fulfill the user's request.\n\
             8. Output the COMPLETE modified file — do not use placeholders or comments like \"rest of code here\".{context}",
            name = screen_name,
            target_file = target_file,
            context = context_section,
        )
}

#[tauri::command]
pub async fn generate_screen_code(
    prompt: String,
    screen_name: String,
    node_id: String,
    target_node_type: String,
    app: AppHandle,
    pty_state: State<'_, PtyState>,
    project_state: State<'_, ProjectState>,
) -> Result<String, String> {
    // Load settings to determine provider
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let settings_path = PathBuf::from(&home).join(".feral").join("settings.json");

    let (provider, api_key, model, ollama_url) = if settings_path.exists() {
        let data = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings: {e}"))?;
        let parsed: serde_json::Value =
            serde_json::from_str(&data).map_err(|e| format!("Invalid settings JSON: {e}"))?;

        let provider = parsed
            .get("active_provider")
            .and_then(|v| v.as_str())
            .unwrap_or("anthropic")
            .to_string();

        let key_field = format!("{}_key", provider);
        let api_key = parsed
            .get(&key_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let model_field = format!("model_{}", provider);
        let model = parsed
            .get(&model_field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let ollama_url = parsed
            .get("ollama_url")
            .and_then(|v| v.as_str())
            .unwrap_or("http://localhost:11434")
            .to_string();

        (provider, api_key, model, ollama_url)
    } else {
        (
            "anthropic".to_string(),
            String::new(),
            String::new(),
            "http://localhost:11434".to_string(),
        )
    };

    let root = ensure_project(&project_state)?;
    let screen_dir = root.join("screens").join(&screen_name);

    // ── Step 1: Enumerate files in the screen package ──────────────────
    let mut screen_files: Vec<String> = Vec::new();
    if screen_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&screen_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "go") {
                    if let Some(name) = path.file_name() {
                        screen_files.push(name.to_string_lossy().to_string());
                    }
                }
            }
        }
    }
    screen_files.sort();

    // ── Step 2: Route — pick which file to edit ────────────────────────
    let main_file = format!("{screen_name}.go");
    let target_file = if screen_files.len() <= 1 {
        // Single file — no routing needed
        main_file.clone()
    } else {
        // Multi-file: ask the LLM which file to edit
        let router_model = {
            let m = router_model_for_provider(&provider);
            if m.is_empty() { model.clone() } else { m.to_string() }
        };
        let router_system = "You are a routing agent. Given a user request and a list of files \
            in a Go package, output ONLY the exact filename that needs to be modified to fulfill \
            the request. Output a single filename like `ui.go` — nothing else. No markdown, \
            no explanation, just the filename.";
        let router_user = format!(
            "Request: {prompt}\nFiles: {}",
            screen_files.join(", ")
        );

        match call_llm(
            &provider,
            &api_key,
            &router_model,
            router_system,
            &router_user,
            &ollama_url,
        )
        .await
        {
            Ok(response) => {
                let picked = response.trim().trim_matches('`').trim().to_string();
                // Validate: must match an actual file
                if screen_files.contains(&picked) {
                    picked
                } else {
                    // Hallucinated filename — fallback to main file
                    main_file.clone()
                }
            }
            Err(_) => {
                // Router call failed — fallback to main file
                main_file.clone()
            }
        }
    };

    // ── Step 3: Read all files for context ─────────────────────────────
    let mut all_sources: Vec<(String, String)> = Vec::new();
    for filename in &screen_files {
        let path = screen_dir.join(filename);
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
        all_sources.push((filename.clone(), content));
    }

    // The target file's current content
    let current_code = all_sources
        .iter()
        .find(|(name, _)| name == &target_file)
        .map(|(_, content)| content.clone())
        .unwrap_or_default();

    // Context: other files' content
    let context_files: Vec<(String, String)> = all_sources
        .iter()
        .filter(|(name, _)| name != &target_file)
        .cloned()
        .collect();

    // Build dynamic system prompt with context files
    let system_prompt = build_system_prompt(
        &target_node_type,
        &screen_name,
        &target_file,
        &context_files,
    );

    // User prompt: the request + current file content (emphasize editing)
    let user_prompt = format!(
        "MODIFY the existing code in `{target_file}` to fulfill this request: {prompt}\n\n\
         Here is the EXISTING code you must edit (preserve everything not related to the request):\n\n\
         ```go\n{current_code}\n```"
    );

    // Emit generation started event
    let generation_event = format!("ai-generation-{node_id}");
    let _ = app.emit(
        &generation_event,
        AiGenerationStatus {
            status: "started".to_string(),
            provider: provider.clone(),
            model: model.clone(),
            error: None,
        },
    );

    // ── Step 4: Generate — call the real LLM ────────────────────────────
    let editor_model = if model.is_empty() {
        // Fallback if no model configured
        match provider.as_str() {
            "anthropic" => "claude-sonnet-4-20250514".to_string(),
            "openai" => "gpt-4o".to_string(),
            "groq" => "llama-3.3-70b-versatile".to_string(),
            "openrouter" => "anthropic/claude-sonnet-4-20250514".to_string(),
            "ollama" => "llama3".to_string(),
            _ => "".to_string(),
        }
    } else {
        model.clone()
    };

    let llm_result = call_llm(
        &provider,
        &api_key,
        &editor_model,
        &system_prompt,
        &user_prompt,
        &ollama_url,
    )
    .await;

    let new_code = match llm_result {
        Ok(response) => extract_go_code(&response),
        Err(e) => {
            let _ = app.emit(
                &generation_event,
                AiGenerationStatus {
                    status: "error".to_string(),
                    provider: provider.clone(),
                    model: model.clone(),
                    error: Some(e.clone()),
                },
            );
            return Err(e);
        }
    };

    // Sanity check: the extracted code should contain a package declaration
    if !new_code.contains("package ") {
        let err_msg = "AI response did not contain valid Go code (no package declaration)".to_string();
        let _ = app.emit(
            &generation_event,
            AiGenerationStatus {
                status: "error".to_string(),
                provider: provider.clone(),
                model: model.clone(),
                error: Some(err_msg.clone()),
            },
        );
        return Err(err_msg);
    }

    // Write only the target file
    let target_path = screen_dir.join(&target_file);
    std::fs::write(&target_path, &new_code)
        .map_err(|e| format!("Failed to write {}: {e}", target_path.display()))?;

    // Emit generation complete event
    let _ = app.emit(
        &generation_event,
        AiGenerationStatus {
            status: "complete".to_string(),
            provider: provider.clone(),
            model: model.clone(),
            error: None,
        },
    );

    // For screen nodes: hot-reload (rebuild + swap PTY)
    // For action nodes: just save the code (no terminal to reload)
    if target_node_type == "screen" {
        let go_bin = find_go_binary()?;
        let binary_path = build_screen(&root, &go_bin, &screen_name)?;

        // Kill old process
        {
            let mut terminals = pty_state
                .terminals
                .lock()
                .map_err(|e| format!("Lock poisoned: {e}"))?;
            if let Some(mut old) = terminals.remove(&node_id) {
                let _ = old.child.kill();
            }
        }

        std::thread::sleep(Duration::from_millis(50));

        // Emit reload so frontend resets xterm
        let _ = app.emit(
            &format!("terminal-reload-{node_id}"),
            ReloadPayload {
                binary_path: binary_path.to_string_lossy().to_string(),
            },
        );

        // Spawn new binary
        let mut cmd = CommandBuilder::new(&binary_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("LANG", "en_US.UTF-8");

        crate::spawn_pty_with_command(node_id, cmd, &app, &pty_state)?;

        cleanup_old_binaries(&root, &screen_name, &binary_path);
    }

    Ok("ok".to_string())
}
