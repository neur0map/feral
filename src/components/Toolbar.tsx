// ============================================================================
// Toolbar.tsx — Floating macOS-style toolbar with actions
// ============================================================================

import { Zap, Play, Download, Check, Settings as SettingsIcon, Sparkles, TerminalSquare } from "lucide-react";

interface ToolbarProps {
  onRunApp: () => void;
  onEjectCode: () => void;
  onAddPrompt: () => void;
  onAddCoder: () => void;
  onOpenSettings: () => void;
  canRun: boolean;
  justSaved: boolean;
}

export function Toolbar({
  onRunApp,
  onEjectCode,
  onAddPrompt,
  onAddCoder,
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

      {/* Add AI Prompt node */}
      <button
        className="toolbar-button"
        onClick={onAddPrompt}
        title="Add AI prompt node"
      >
        <Sparkles size={12} />
        <span>AI</span>
      </button>

      {/* Add Coder node */}
      <button
        className="toolbar-button"
        onClick={onAddCoder}
        title="Add coder terminal node"
      >
        <TerminalSquare size={12} />
        <span>Coder</span>
      </button>

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
