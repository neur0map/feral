// ============================================================================
// TemplateSidebar.tsx — Right-side panel listing available templates
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Blocks, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";

interface TemplateInfo {
  id: string;
  name: string;
  category: string;
  description: string;
  outputs: string[];
}

interface TemplateSidebarProps {
  onSpawn: (templateId: string, screenName: string, outputs: string[]) => void;
}

export function TemplateSidebar({ onSpawn }: TemplateSidebarProps) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [compact, setCompact] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    invoke<TemplateInfo[]>("list_templates").then(setTemplates);
  }, []);

  const groups = useMemo(() => {
    const grouped = new Map<string, TemplateInfo[]>();
    for (const t of templates) {
      const list = grouped.get(t.category) ?? [];
      list.push(t);
      grouped.set(t.category, list);
    }
    return grouped;
  }, [templates]);

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  if (compact) {
    return (
      <div className="template-sidebar template-sidebar-compact">
        <button
          className="template-sidebar-expand"
          onClick={() => setCompact(false)}
          title="Expand templates"
        >
          <Blocks size={16} className="template-sidebar-icon" />
        </button>
      </div>
    );
  }

  return (
    <div className="template-sidebar">
      <div className="template-sidebar-header">
        <Blocks size={14} className="template-sidebar-icon" />
        <span>Templates</span>
        <span className="template-count-badge">{templates.length}</span>
        <button
          className="template-sidebar-collapse"
          onClick={() => setCompact(true)}
          title="Collapse sidebar"
        >
          <PanelRightClose size={14} />
        </button>
      </div>
      <div className="template-sidebar-body">
        {Array.from(groups.entries()).map(([category, items]) => {
          const isOpen = !collapsedCategories.has(category);
          return (
            <div key={category} className="template-group">
              <button
                className="template-group-header"
                onClick={() => toggleCategory(category)}
              >
                <ChevronRight
                  size={12}
                  className={`template-chevron ${isOpen ? "template-chevron-open" : ""}`}
                />
                <span className="template-group-label">{category}</span>
                <span className="template-count-badge">{items.length}</span>
              </button>
              <div
                className={`template-group-content ${isOpen ? "template-group-content-open" : ""}`}
              >
                <div className="template-group-inner">
                  {items.map((t) => (
                    <TemplateCard key={t.id} template={t} onSpawn={onSpawn} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onSpawn,
}: {
  template: TemplateInfo;
  onSpawn: (templateId: string, screenName: string, outputs: string[]) => void;
}) {
  return (
    <button
      className="template-card"
      onClick={() => onSpawn(template.id, template.id, template.outputs)}
    >
      <span className="template-card-name">{template.name}</span>
      <span className="template-card-desc">{template.description}</span>
      <span className="template-card-outputs">
        {template.outputs.map((o) => (
          <span key={o} className="template-card-tag">
            {o}
          </span>
        ))}
      </span>
    </button>
  );
}
