// ============================================================================
// TemplateGallery.tsx — Full-screen modal gallery for browsing templates
// ============================================================================

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, X } from "lucide-react";

interface TemplateInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  outputs: string[];
  framework: string;
}

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (templateId: string, screenName: string, outputs: string[], framework: string) => void;
}

const CATEGORY_ORDER = [
  "Getting Started",
  "Inputs",
  "Lists & Tables",
  "Navigation",
  "Feedback",
  "Layout",
  "Networking",
  "Patterns",
  "System",
];

export function TemplateGallery({ open, onClose, onSpawn }: TemplateGalleryProps) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch templates once
  useEffect(() => {
    invoke<TemplateInfo[]>("list_templates").then(setTemplates);
  }, []);

  // Reset state + auto-focus search on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedCategory(null);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Categories present in templates
  const categories = useMemo(() => {
    const present = new Set(templates.map((t) => t.category));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [templates]);

  // Filtered templates
  const filtered = useMemo(() => {
    let list = templates;
    if (selectedCategory) {
      list = list.filter((t) => t.category === selectedCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      );
    }
    return list;
  }, [templates, search, selectedCategory]);

  const handleSpawn = useCallback(
    (t: TemplateInfo) => {
      onSpawn(t.id, t.id, t.outputs, t.framework);
      onClose();
    },
    [onSpawn, onClose],
  );

  if (!open) return null;

  return (
    <div className="gallery-overlay" onMouseDown={onClose}>
      <div className="gallery-modal" onMouseDown={(e) => e.stopPropagation()}>
        {/* Left sidebar */}
        <div className="gallery-sidebar">
          <div className="gallery-sidebar-header">Templates</div>
          <div className="gallery-sidebar-list">
            <button
              className={`gallery-category-item ${selectedCategory === null ? "gallery-category-active" : ""}`}
              onClick={() => setSelectedCategory(null)}
            >
              All Templates
              <span className="gallery-category-count">{templates.length}</span>
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                className={`gallery-category-item ${selectedCategory === cat ? "gallery-category-active" : ""}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
                <span className="gallery-category-count">
                  {templates.filter((t) => t.category === cat).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Right main area */}
        <div className="gallery-main">
          <div className="gallery-header">
            <div className="gallery-search-wrapper">
              <Search size={13} className="gallery-search-icon" />
              <input
                ref={searchRef}
                className="gallery-search"
                type="text"
                placeholder="Search templates..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button className="gallery-close" onClick={onClose}>
              <X size={14} />
            </button>
          </div>

          <div className="gallery-grid-wrapper">
            {filtered.length > 0 ? (
              <div className="gallery-grid">
                {filtered.map((t) => (
                  <GalleryCard key={t.id} template={t} onClick={() => handleSpawn(t)} />
                ))}
              </div>
            ) : (
              <div className="gallery-empty">No templates found</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GalleryCard({
  template,
  onClick,
}: {
  template: TemplateInfo;
  onClick: () => void;
}) {
  return (
    <button className="gallery-card" onClick={onClick}>
      <div className="gallery-card-preview">
        <div className="gallery-card-preview-bar">
          <span className="gallery-card-dot" />
          <span className="gallery-card-dot" />
          <span className="gallery-card-dot" />
        </div>
        <span className="gallery-card-preview-label">{template.name}</span>
      </div>
      <div className="gallery-card-body">
        <span className="gallery-card-name">{template.name}</span>
        <span className="gallery-card-desc">{template.description}</span>
        <span className="gallery-card-outputs">
          {template.outputs.map((o) => (
            <span key={o} className="gallery-card-tag">
              {o}
            </span>
          ))}
        </span>
      </div>
    </button>
  );
}
