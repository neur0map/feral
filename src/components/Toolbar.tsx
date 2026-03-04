// ============================================================================
// Toolbar.tsx — Floating macOS-style toolbar with actions
// ============================================================================

import { Zap, Play, Download, Check, Settings as SettingsIcon, Sparkles, TerminalSquare, ChevronDown, Blocks } from "lucide-react";

const CODER_OPTIONS = [
  { id: "claude",   label: "Claude",   accent: "#d4a27a" },
  { id: "codex",    label: "Codex",    accent: "#4ade80" },
  { id: "gemini",   label: "Gemini",   accent: "#60a5fa" },
  { id: "droid",    label: "Droid",    accent: "#c084fc" },
  { id: "kilo",     label: "Kilo",     accent: "#fbbf24" },
  { id: "opencode", label: "OpenCode", accent: "#22d3ee" },
] as const;

interface ToolbarProps {
  onRunApp: () => void;
  onEjectCode: () => void;
  onAddPrompt: () => void;
  onAddCoder: (coderId?: string) => void;
  onOpenTemplates: () => void;
  onOpenSettings: () => void;
  canRun: boolean;
  justSaved: boolean;
}

export function Toolbar({
  onRunApp,
  onEjectCode,
  onAddPrompt,
  onAddCoder,
  onOpenTemplates,
  onOpenSettings,
  canRun,
  justSaved,
}: ToolbarProps) {
  return (
    <div
      className="
        toolbar
        absolute top-4 left-1/2 -translate-x-1/2 z-50
        flex items-center
      "
    >
      <Zap size={14} className="text-white/50" />
      <span className="text-xs font-medium text-white/60 tracking-wide">
        FERAL
      </span>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Open template gallery */}
      <button
        className="toolbar-button"
        onClick={onOpenTemplates}
        title="Browse templates"
      >
        <Blocks size={12} />
        <span>Templates</span>
      </button>

      {/* Add AI Prompt node */}
      <button
        className="toolbar-button"
        onClick={onAddPrompt}
        title="Add AI prompt node"
      >
        <Sparkles size={12} />
        <span>AI</span>
      </button>

      {/* Add Coder node — with hover dropdown */}
      <div className="toolbar-dropdown-wrapper">
        <button
          className="toolbar-button"
          onClick={() => onAddCoder()}
          title="Add coder terminal node"
        >
          <TerminalSquare size={12} />
          <span>Coder</span>
          <ChevronDown size={10} className="toolbar-dropdown-chevron" />
        </button>

        <div className="toolbar-dropdown">
          <div className="toolbar-dropdown-menu">
            {CODER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                className="toolbar-dropdown-item"
                onClick={() => onAddCoder(opt.id)}
              >
                <span
                  className="toolbar-dropdown-dot"
                  style={{ background: opt.accent }}
                />
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Run button */}
      <button
        className="toolbar-button toolbar-button-primary"
        onClick={onRunApp}
        disabled={!canRun}
        title="Run assembled app"
      >
        <Play size={12} />
        <span>Run</span>
      </button>

      {/* Eject button */}
      <button
        className="toolbar-button"
        onClick={onEjectCode}
        disabled={!canRun}
        title="Export standalone project"
      >
        <Download size={12} />
        <span>Eject</span>
      </button>

      {/* Divider */}
      <div className="toolbar-divider" />

      {/* Settings */}
      <button
        className="toolbar-icon-btn"
        onClick={onOpenSettings}
        title="Settings"
      >
        <SettingsIcon size={14} />
      </button>

      {/* Auto-save indicator */}
      <div
        className={`toolbar-save-indicator ${justSaved ? "toolbar-save-visible" : ""}`}
      >
        <Check size={10} />
        <span>Saved</span>
      </div>
    </div>
  );
}
