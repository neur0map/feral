// ============================================================================
// SettingsDialog.tsx — Compact single-column settings panel
// ============================================================================

import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Eye, EyeOff, ChevronDown, Check, Loader2 } from "lucide-react";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", keyField: "anthropic_key", modelField: "model_anthropic" },
  { id: "groq", label: "Groq", keyField: "groq_key", modelField: "model_groq" },
  { id: "ollama", label: "Ollama (Local)", keyField: null, modelField: "model_ollama" },
  { id: "openai", label: "OpenAI", keyField: "openai_key", modelField: "model_openai" },
  { id: "openrouter", label: "OpenRouter", keyField: "openrouter_key", modelField: "model_openrouter" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["id"];

interface Settings {
  active_provider: ProviderId;
  anthropic_key: string;
  openai_key: string;
  groq_key: string;
  openrouter_key: string;
  ollama_url: string;
  model_anthropic: string;
  model_openai: string;
  model_groq: string;
  model_openrouter: string;
  model_ollama: string;
}

const DEFAULT_SETTINGS: Settings = {
  active_provider: "anthropic",
  anthropic_key: "",
  openai_key: "",
  groq_key: "",
  openrouter_key: "",
  ollama_url: "http://localhost:11434",
  model_anthropic: "",
  model_openai: "",
  model_groq: "",
  model_openrouter: "",
  model_ollama: "",
};

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  // Model combobox state
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [comboOpen, setComboOpen] = useState(false);
  const [comboFilter, setComboFilter] = useState("");
  const comboRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load settings on open
  useEffect(() => {
    if (!open) return;
    invoke<string | null>("load_settings", {})
      .then((data) => {
        if (data) {
          try {
            const parsed = JSON.parse(data);
            setSettings({ ...DEFAULT_SETTINGS, ...parsed });
          } catch {
            /* ignore parse errors */
          }
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open]);

  // Save on every change
  const updateSetting = useCallback(
    <K extends keyof Settings>(key: K, value: Settings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        invoke("save_settings", {
          settingsJson: JSON.stringify(next),
        }).catch(console.error);
        return next;
      });
    },
    []
  );

  const toggleReveal = useCallback((field: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);

  // Fetch models when provider or API key changes (debounced)
  useEffect(() => {
    if (!loaded) return;

    const provider = settings.active_provider;
    const providerDef = PROVIDERS.find((p) => p.id === provider);
    if (!providerDef) return;

    const apiKey = providerDef.keyField
      ? (settings[providerDef.keyField as keyof Settings] as string)
      : "";
    const ollamaUrl = settings.ollama_url;

    // For non-ollama providers, require a key
    if (provider !== "ollama" && !apiKey) {
      setModels([]);
      setModelsError("");
      return;
    }

    setModelsLoading(true);
    setModelsError("");

    const timer = setTimeout(() => {
      invoke<{ id: string; name: string }[]>("fetch_models", {
        provider,
        apiKey,
        ollamaUrl: provider === "ollama" ? ollamaUrl : null,
      })
        .then((result) => {
          setModels(result);
          setModelsError("");
          setModelsLoading(false);
        })
        .catch((err) => {
          setModels([]);
          setModelsError(String(err));
          setModelsLoading(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [
    loaded,
    settings.active_provider,
    settings.anthropic_key,
    settings.openai_key,
    settings.groq_key,
    settings.openrouter_key,
    settings.ollama_url,
  ]);

  // Close combobox on click outside
  useEffect(() => {
    if (!comboOpen) return;
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setComboOpen(false);
        setComboFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [comboOpen]);

  // Close combobox on Escape
  useEffect(() => {
    if (!comboOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setComboOpen(false);
        setComboFilter("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [comboOpen]);

  // Focus search input when combobox opens
  useEffect(() => {
    if (comboOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [comboOpen]);

  // Reset combobox state when provider changes
  useEffect(() => {
    setComboOpen(false);
    setComboFilter("");
  }, [settings.active_provider]);

  if (!open) return null;

  const activeProvider = PROVIDERS.find(
    (p) => p.id === settings.active_provider
  )!;
  const modelField = activeProvider.modelField as keyof Settings;
  const selectedModel = settings[modelField] as string;

  const filteredModels = comboFilter
    ? models.filter(
        (m) =>
          m.name.toLowerCase().includes(comboFilter.toLowerCase()) ||
          m.id.toLowerCase().includes(comboFilter.toLowerCase())
      )
    : models;

  const hasKey =
    activeProvider.id === "ollama" ||
    (activeProvider.keyField &&
      !!(settings[activeProvider.keyField as keyof Settings] as string));

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="settings-header">
          <span className="settings-header-title">Settings</span>
          <button className="settings-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Content — single column */}
        <div className="settings-content">
          {loaded && (
            <>
              <div className="settings-section-label">Model Provider</div>

              {PROVIDERS.map((p) => {
                const isActive = settings.active_provider === p.id;
                return (
                  <div className="settings-provider-row" key={p.id}>
                    <button
                      className="settings-provider-btn"
                      onClick={() => updateSetting("active_provider", p.id)}
                    >
                      <span
                        className={
                          isActive
                            ? "settings-radio-on"
                            : "settings-radio-off"
                        }
                      />
                      <span
                        className={`settings-provider-name ${
                          isActive ? "active" : ""
                        }`}
                      >
                        {p.label}
                      </span>
                    </button>

                    {/* Inline key input — only for active provider with keyField */}
                    {isActive && p.keyField && (
                      <div className="settings-key-inline">
                        <input
                          type={
                            revealedKeys.has(p.keyField) ? "text" : "password"
                          }
                          className="settings-input"
                          value={
                            settings[p.keyField as keyof Settings] as string
                          }
                          onChange={(e) =>
                            updateSetting(
                              p.keyField as keyof Settings,
                              e.target.value
                            )
                          }
                          placeholder="sk-..."
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <button
                          className="settings-reveal-btn"
                          onClick={() => toggleReveal(p.keyField!)}
                          title={
                            revealedKeys.has(p.keyField) ? "Hide" : "Reveal"
                          }
                        >
                          {revealedKeys.has(p.keyField) ? (
                            <EyeOff size={13} />
                          ) : (
                            <Eye size={13} />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Ollama URL — inline like key input */}
                    {isActive && p.id === "ollama" && (
                      <div className="settings-key-inline">
                        <input
                          type="text"
                          className="settings-input"
                          value={settings.ollama_url}
                          onChange={(e) =>
                            updateSetting("ollama_url", e.target.value)
                          }
                          placeholder="http://localhost:11434"
                          spellCheck={false}
                        />
                      </div>
                    )}

                    {/* Model combobox — below key input for active provider */}
                    {isActive && (
                      <div className="settings-model-combobox" ref={comboRef}>
                        <button
                          className={`settings-model-trigger ${
                            comboOpen ? "settings-model-trigger-open" : ""
                          }`}
                          onClick={() => {
                            if (hasKey && models.length > 0) {
                              setComboOpen(!comboOpen);
                              if (comboOpen) setComboFilter("");
                            }
                          }}
                          disabled={!hasKey || modelsLoading}
                        >
                          <span
                            className={
                              selectedModel
                                ? ""
                                : "settings-model-trigger-placeholder"
                            }
                          >
                            {modelsLoading
                              ? "Loading models..."
                              : selectedModel ||
                                (hasKey
                                  ? "Select a model"
                                  : "Enter API key to load models")}
                          </span>
                          {modelsLoading ? (
                            <Loader2
                              size={12}
                              className="settings-model-spinner"
                            />
                          ) : (
                            <ChevronDown
                              size={12}
                              className={`settings-model-chevron ${
                                comboOpen
                                  ? "settings-model-chevron-open"
                                  : ""
                              }`}
                            />
                          )}
                        </button>

                        {comboOpen && (
                          <div className="settings-model-dropdown">
                            <input
                              ref={searchRef}
                              type="text"
                              className="settings-model-search"
                              placeholder="Filter models..."
                              value={comboFilter}
                              onChange={(e) =>
                                setComboFilter(e.target.value)
                              }
                              spellCheck={false}
                            />
                            {modelsError ? (
                              <div className="settings-model-error">
                                {modelsError}
                              </div>
                            ) : filteredModels.length === 0 ? (
                              <div className="settings-model-empty">
                                {comboFilter
                                  ? "No matching models"
                                  : "No models available"}
                              </div>
                            ) : (
                              filteredModels.map((m) => (
                                <button
                                  key={m.id}
                                  className={`settings-model-option ${
                                    selectedModel === m.id
                                      ? "settings-model-option-selected"
                                      : ""
                                  }`}
                                  onClick={() => {
                                    updateSetting(modelField, m.id);
                                    setComboOpen(false);
                                    setComboFilter("");
                                  }}
                                >
                                  <span>{m.name}</span>
                                  {selectedModel === m.id && (
                                    <Check
                                      size={12}
                                      className="settings-model-check"
                                    />
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              <p className="settings-footnote">
                Keys stored locally &middot; ~/.feral/settings.json
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
