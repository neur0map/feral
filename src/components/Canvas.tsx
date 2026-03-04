// ============================================================================
// Canvas.tsx — Full-screen React Flow canvas with template gallery
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  type Node,
  type Edge,
  type EdgeChange,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { invoke } from "@tauri-apps/api/core";

import { TerminalNode } from "./TerminalNode";
import { RunnerNode } from "./RunnerNode";
import { PromptNode } from "./PromptNode";
import { CoderNode } from "./CoderNode";
import { Toolbar } from "./Toolbar";
import { TemplateGallery } from "./TemplateGallery";
import { SettingsDialog } from "./SettingsDialog";

const nodeTypes = {
  screen: TerminalNode,
  runner: RunnerNode,
  prompt: PromptNode,
  coder: CoderNode,
};

export function Canvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const reactFlowInstance = useRef<ReactFlowInstance<Node, Edge> | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // ── Boot: load saved graph ──────────────────────────────────────────────
  useEffect(() => {
    invoke<string | null>("load_graph", {})
      .then((data) => {
        if (data) {
          try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed.nodes)) {
              // Filter out runner and legacy action nodes — they can't be rehydrated
              const persistedNodes = parsed.nodes.filter(
                (n: Node) => n.type !== "runner" && n.type !== "action"
              );
              setNodes(persistedNodes);
            }
            if (Array.isArray(parsed.edges)) {
              setEdges(parsed.edges);
            }
          } catch (e) {
            console.error("[Feral] Failed to parse graph.json:", e);
          }
        }
        setGraphLoaded(true);
      })
      .catch((err) => {
        console.error("[Feral] Failed to load graph:", err);
        setGraphLoaded(true);
      });
  }, []);

  // ── Auto-save: debounced write on nodes/edges change ────────────────────
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!graphLoaded) return;

    if (saveTimeout.current) clearTimeout(saveTimeout.current);

    saveTimeout.current = setTimeout(() => {
      // Only persist screen + prompt nodes (runner nodes are ephemeral)
      const persistNodes = nodes.filter((n) => n.type !== "runner");
      const graphData = JSON.stringify({ nodes: persistNodes, edges });

      invoke("save_graph", { graphData })
        .then(() => {
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 1500);
        })
        .catch((err) => {
          console.error("[Feral] Auto-save failed:", err);
        });
    }, 1000);

    return () => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [nodes, edges, graphLoaded]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: false }, eds));

      // Detect coder→screen edges: update the coder node's targetScreenName + screenNodeId
      const sourceNode = nodes.find((n) => n.id === params.source);
      const targetNode = nodes.find((n) => n.id === params.target);
      if (sourceNode?.type === "coder" && targetNode?.type === "screen") {
        const screenName = (targetNode.data as Record<string, unknown>)
          .screenName as string;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === sourceNode.id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    targetScreenName: screenName,
                    screenNodeId: targetNode.id,
                  },
                }
              : n
          )
        );
      }
    },
    [setEdges, nodes, setNodes]
  );

  // ── Edge change handler: detect coder disconnects ─────────────────────
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // Before applying changes, check for removed edges that disconnect a coder node
      for (const change of changes) {
        if (change.type === "remove") {
          const removedEdge = edges.find((e) => e.id === change.id);
          if (removedEdge) {
            const sourceNode = nodes.find((n) => n.id === removedEdge.source);
            if (sourceNode?.type === "coder") {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === sourceNode.id
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          targetScreenName: "",
                          screenNodeId: "",
                        },
                      }
                    : n
                )
              );
            }
          }
        }
      }
      onEdgesChange(changes);
    },
    [edges, nodes, setNodes, onEdgesChange]
  );

  const addScreenNode = useCallback(
    (templateId: string, screenName: string, outputs: string[], framework: string) => {
      const id = crypto.randomUUID();

      let position = {
        x: 100 + Math.random() * 200,
        y: 100 + Math.random() * 150,
      };

      if (reactFlowInstance.current) {
        const viewport = reactFlowInstance.current.getViewport();
        position = {
          x: (-viewport.x + window.innerWidth / 2 - 300) / viewport.zoom,
          y: (-viewport.y + window.innerHeight / 2 - 200) / viewport.zoom,
        };
        position.x += (Math.random() - 0.5) * 80;
        position.y += (Math.random() - 0.5) * 60;
      }

      const newNode: Node = {
        id,
        type: "screen",
        position,
        data: { screenName, templateId, outputs, framework },
        style: { width: 900, height: 550 },
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  // ── Add prompt node ───────────────────────────────────────────────────
  const addPromptNode = useCallback(() => {
    const id = crypto.randomUUID();

    let position = { x: 100, y: 100 };

    if (reactFlowInstance.current) {
      const viewport = reactFlowInstance.current.getViewport();
      position = {
        x: (-viewport.x + window.innerWidth / 2 - 150) / viewport.zoom,
        y: (-viewport.y + window.innerHeight / 2 - 100) / viewport.zoom,
      };
    }

    const newNode: Node = {
      id,
      type: "prompt",
      position,
      data: { prompt: "" },
      style: { width: 300, height: 200 },
    };

    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  // ── Add coder node ───────────────────────────────────────────────────
  const addCoderNode = useCallback((coderId?: string) => {
    const id = crypto.randomUUID();

    let position = { x: 100, y: 100 };

    if (reactFlowInstance.current) {
      const viewport = reactFlowInstance.current.getViewport();
      position = {
        x: (-viewport.x + window.innerWidth / 2 - 300) / viewport.zoom,
        y: (-viewport.y + window.innerHeight / 2 - 200) / viewport.zoom,
      };
    }

    const newNode: Node = {
      id,
      type: "coder",
      position,
      data: { targetScreenName: "", coderId: coderId ?? "claude" },
      style: { width: 640, height: 420 },
    };

    setNodes((nds) => [...nds, newNode]);
  }, [setNodes]);

  // ── Run assembled app ─────────────────────────────────────────────────
  const handleRunApp = useCallback(() => {
    const screenNodes = nodes.filter((n) => n.type === "screen");
    const nodeMap = new Map(screenNodes.map((n) => [n.id, n]));

    const appEdges = edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source_screen: (nodeMap.get(e.source)!.data as Record<string, unknown>)
          .screenName as string,
        source_handle: e.sourceHandle ?? "",
        target_screen: (nodeMap.get(e.target)!.data as Record<string, unknown>)
          .screenName as string,
      }));

    if (appEdges.length === 0) return;

    const targetSet = new Set(appEdges.map((e) => e.target_screen));
    const sources = appEdges.map((e) => e.source_screen);
    const startScreen =
      sources.find((s) => !targetSet.has(s)) ?? appEdges[0].source_screen;

    const edgesJson = JSON.stringify(appEdges);

    setNodes((nds) => {
      const runners = nds.filter((n) => n.type === "runner");
      for (const runner of runners) {
        invoke("kill_terminal", { id: runner.id }).catch(console.error);
      }
      return nds.filter((n) => n.type !== "runner");
    });

    const runnerId = crypto.randomUUID();
    let position = { x: 200, y: 200 };

    if (reactFlowInstance.current) {
      const viewport = reactFlowInstance.current.getViewport();
      position = {
        x: (-viewport.x + window.innerWidth / 2 - 300) / viewport.zoom,
        y: (-viewport.y + window.innerHeight / 2 - 200) / viewport.zoom,
      };
    }

    const runnerNode: Node = {
      id: runnerId,
      type: "runner",
      position,
      data: { edgesJson, startScreen },
      selected: true,
      style: { width: 800, height: 500 },
    };

    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => ({ ...n, selected: false })).concat(runnerNode)
      );
    }, 100);
  }, [nodes, edges, setNodes]);

  // ── Eject standalone project ──────────────────────────────────────────
  const handleEjectCode = useCallback(() => {
    const screenNodes = nodes.filter((n) => n.type === "screen");
    const nodeMap = new Map(screenNodes.map((n) => [n.id, n]));

    const appEdges = edges
      .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e) => ({
        source_screen: (nodeMap.get(e.source)!.data as Record<string, unknown>)
          .screenName as string,
        source_handle: e.sourceHandle ?? "",
        target_screen: (nodeMap.get(e.target)!.data as Record<string, unknown>)
          .screenName as string,
      }));

    if (appEdges.length === 0) return;

    const targetSet = new Set(appEdges.map((e) => e.target_screen));
    const sources = appEdges.map((e) => e.source_screen);
    const startScreen =
      sources.find((s) => !targetSet.has(s)) ?? appEdges[0].source_screen;

    const edgesJson = JSON.stringify(appEdges);

    invoke("eject_project", {
      outputDir: "~/Desktop/feral-export",
      edgesJson,
      startScreen,
    })
      .then((path) => {
        console.log("[Feral] Ejected to:", path);
      })
      .catch((err) => {
        console.error("[Feral] Eject failed:", err);
      });
  }, [nodes, edges]);

  // Can run if there are screen-to-screen edges
  const canRun =
    edges.filter((e) => {
      const src = nodes.find((n) => n.id === e.source);
      const tgt = nodes.find((n) => n.id === e.target);
      return src?.type === "screen" && tgt?.type === "screen";
    }).length > 0;

  return (
    <div className="w-screen h-screen bg-feral-bg flex">
      <div className="flex-1 min-w-0 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            reactFlowInstance.current = instance;
          }}
          deleteKeyCode={["Backspace", "Delete"]}
          colorMode="dark"
          fitView={false}
          minZoom={0.2}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          panOnScroll
          panOnScrollMode={PanOnScrollMode.Free}
          zoomOnScroll={false}
          zoomOnPinch
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="rgba(255, 255, 255, 0.05)"
            gap={24}
            size={1.5}
          />
          <Controls showInteractive={false} />
        </ReactFlow>

        <Toolbar
          onRunApp={handleRunApp}
          onEjectCode={handleEjectCode}
          onAddPrompt={addPromptNode}
          onAddCoder={addCoderNode}
          onOpenTemplates={() => setTemplatesOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          canRun={canRun}
          justSaved={justSaved}
        />
      </div>

      <TemplateGallery
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onSpawn={addScreenNode}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
