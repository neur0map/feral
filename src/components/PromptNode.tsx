// ============================================================================
// PromptNode.tsx — AI prompt node for generating/modifying screen code
// ============================================================================

import { useState, useCallback } from "react";
import {
  type NodeProps,
  Handle,
  Position,
  NodeResizer,
  useReactFlow,
} from "@xyflow/react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Loader2 } from "lucide-react";

export function PromptNode({ id, selected, data }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const initialPrompt = (nodeData.prompt as string) ?? "";

  const [prompt, setPrompt] = useState(initialPrompt);
  const [isGenerating, setIsGenerating] = useState(false);
  const { getEdges, getNodes } = useReactFlow();

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    // Find the connected target node via edges from this node's output
    const edges = getEdges();
    const nodes = getNodes();
    const outEdge = edges.find((e) => e.source === id);

    if (!outEdge) return;

    const targetNode = nodes.find((n) => n.id === outEdge.target);
    if (!targetNode || targetNode.type !== "screen") return;

    const screenName = (targetNode.data as Record<string, unknown>)
      .screenName as string;
    const targetNodeType = targetNode.type; // "screen" or "action"

    setIsGenerating(true);
    try {
      await invoke("generate_screen_code", {
        prompt,
        screenName,
        nodeId: outEdge.target,
        targetNodeType,
      });
    } catch (err) {
      console.error("[Feral] AI generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  }, [id, prompt, isGenerating, getEdges, getNodes]);

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={160}
        lineClassName="node-resize-line"
        handleClassName="node-resize-handle"
      />

      {/* Output handle (right side) */}
      <Handle
        type="source"
        id="ai-output"
        position={Position.Right}
        className="feral-handle feral-handle-output"
      />

      <div className="prompt-node">
        {/* Header */}
        <div className="prompt-header">
          <Sparkles size={14} className="text-white/50" />
          <span className="prompt-title">AI Prompt</span>
        </div>

        {/* Body */}
        <div className="prompt-body">
          <textarea
            className={`prompt-textarea ${selected ? "nodrag nowheel" : ""}`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe changes... e.g. 'Make the title neon green'"
            spellCheck={false}
          />
          <button
            className="prompt-generate-btn nodrag"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
          >
            {isGenerating ? (
              <>
                <Loader2 size={13} className="prompt-spinner" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Sparkles size={13} />
                <span>Generate</span>
              </>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
