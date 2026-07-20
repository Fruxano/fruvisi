import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type Connection,
  type ReactFlowInstance,
} from "@xyflow/react";
import { C } from "../lib/sdk";
import { getProfiles, getTopology, putTopology, getKanbanTasks, assignKanbanTask, deleteProfile, getAllFallbacks, type KanbanTask, type FallbackStatus } from "../lib/api";
import { EMPTY_PRESET, nodeGroup, groupAncestors, familyRoot, type HermesProfile, type TopologyDoc, type Preset } from "../lib/types";
import { buildGraph, taskStatsByAssignee, colorFor } from "../lib/graph";
import { nudgeCard } from "../lib/collide";
import { NODE_WIDTH, NODE_HEIGHT } from "../lib/layout";
import { useT } from "../lib/i18n";
import { applyStructure } from "../lib/delegation";
import * as topo from "../lib/topo";
import { AgentCard } from "./AgentCard";
import { GroupBar, type SpotState } from "./GroupBar";
import { Inspector } from "./Inspector";
import { PresetBar, type ApplyState } from "./PresetBar";
import { TaskDock } from "./TaskDock";
import { WizardDialog } from "./WizardDialog";

const nodeTypes = { agent: AgentCard };
type SaveState = "idle" | "saving" | "saved" | "error";

/** MIME type for dragging hidden agents back out of the fixed bar. */
const HIDDEN_DRAG_MIME = "application/x-fruvisi-hidden";

export function OrgPage() {
  const t = useT();
  const [profiles, setProfiles] = useState<HermesProfile[] | null>(null);
  const [doc, setDoc] = useState<TopologyDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [kanbanAvailable, setKanbanAvailable] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  /** Fallback status per profile (card badge "⇄ FB"). */
  const [fallbacks, setFallbacks] = useState<Record<string, FallbackStatus>>({});

  const refreshFallbacks = useCallback(() => {
    getAllFallbacks().then(setFallbacks).catch(() => undefined);
  }, []);

  useEffect(() => { refreshFallbacks(); }, [refreshFallbacks]);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const saveTimer = useRef<number | null>(null);
  /** Last built graph as the basis of the chart bounds (stable while dragging). */
  const extentBase = useRef<Node[]>([]);
  /** Group-bar spotlight: hover = preview, click = lock. */
  const [spot, setSpot] = useState<SpotState | null>(null);
  const spotRef = useRef<SpotState | null>(null);
  spotRef.current = spot;
  /** React Flow instance for coordinate conversion when dropping from the bar. */
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    Promise.all([getProfiles(), getTopology()])
      .then(([p, d]) => { setProfiles(p); setDoc(d); })
      .catch((err) => setError(String(err)));
  }, []);

  const refreshTasks = useCallback(() => {
    getKanbanTasks()
      .then((x) => { setTasks(x); setKanbanAvailable(true); })
      .catch(() => setKanbanAvailable(false)); // kanban plugin missing/inactive -> chart keeps working without tasks
  }, []);

  // Load kanban tasks and refresh every 10s while the page is open.
  useEffect(() => {
    refreshTasks();
    const iv = window.setInterval(refreshTasks, 10_000);
    return () => window.clearInterval(iv);
  }, [refreshTasks]);

  const assignTask = useCallback(
    (taskId: string, profileName: string) => {
      assignKanbanTask(taskId, profileName).then(refreshTasks).catch(() => undefined);
    },
    [refreshTasks],
  );

  const preset: Preset = useMemo(
    () => (doc ? doc.presets[doc.activePreset] || EMPTY_PRESET : EMPTY_PRESET),
    [doc],
  );

  /** Spotlight fields for an agent card (pure visuals, no position effect). */
  const spotFields = useCallback(
    (nodeId: string, s: SpotState | null, p: Preset) => {
      if (!s) return { spot: undefined, spotColor: undefined };
      const gid = nodeGroup(p.nodes[nodeId]);
      const direct = gid === s.id;
      const family = !direct && gid ? groupAncestors(p.groups, gid).includes(s.id) : false;
      const target = p.groups.find((g) => g.id === s.id);
      const color = target ? (familyRoot(p.groups, target.id)?.color || target.color) : undefined;
      return { spot: direct ? "direct" : family ? "family" : "dim", spotColor: color };
    },
    [],
  );

  // Derive the graph from profiles + active preset (doc positions win).
  // Any active spotlight is applied from the ref so it survives task-polling
  // rebuilds without hover changes triggering rebuilds here.
  useEffect(() => {
    if (!profiles || !doc) return;
    const g = buildGraph(profiles, preset, taskStatsByAssignee(tasks));
    extentBase.current = g.nodes; // basis for the chart bounds (stable while dragging)
    setNodes(g.nodes.map((n) => ({
      ...n,
      deletable: false,
      data: {
        ...n.data,
        ...spotFields(n.id, spotRef.current, preset),
        fallbackModel: fallbacks[n.id]?.model,
        onAssignTask: assignTask,
      },
    })));
    setEdges(g.edges);
  }, [profiles, doc, preset, tasks, assignTask, spotFields, fallbacks]);

  // Spotlight changes (hover/click in the group bar): only update the visual
  // fields of existing nodes — positions stay untouched, and NO graph rebuild
  // happens (no flicker, no position reset).
  useEffect(() => {
    setNodes((nds) => nds.map((n) => {
      const f = spotFields(n.id, spot, preset);
      if ((n.data as any).spot === f.spot && (n.data as any).spotColor === f.spotColor) return n;
      return { ...n, data: { ...n.data, ...f } };
    }));
  }, [spot, preset, spotFields]);

  const savedFade = useRef<number | null>(null);

  const persist = useCallback((d: TopologyDoc) => {
    putTopology(d)
      .then(() => {
        setSaveState("saved");
        if (savedFade.current) window.clearTimeout(savedFade.current);
        savedFade.current = window.setTimeout(() => setSaveState("idle"), 2500);
      })
      .catch(() => setSaveState("error"));
  }, []);

  /** Apply the preset to ALL profiles: members get their structure note,
   *  non-members the inactive marker (routing signal for the decomposer). */
  const syncStructure = useCallback((d: TopologyDoc) => {
    if (!profiles) return;
    const p = d.presets[d.activePreset] || EMPTY_PRESET;
    setApplyState("busy");
    applyStructure(profiles, p)
      .then((n) => {
        setApplyState(n);
        getProfiles().then(setProfiles).catch(() => undefined);
        window.setTimeout(() => setApplyState("idle"), 4000);
      })
      .catch(() => {
        setApplyState("error");
        window.setTimeout(() => setApplyState("idle"), 4000);
      });
  }, [profiles]);

  /** Change the doc + debounced save. If this switches the active preset
   *  (switcher, creation, deleting the active one), the lineup is synced to
   *  Hermes immediately — unless disabled under "Manage". */
  const changeDoc = useCallback((next: TopologyDoc) => {
    const switched = doc !== null && next.activePreset !== doc.activePreset;
    setDoc(next);
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => persist(next), 600);
    if (switched && next.syncOnSwitch !== false) syncStructure(next);
  }, [persist, doc, syncStructure]);

  /** Manual save: run a pending debounced save immediately. */
  const saveNow = useCallback(() => {
    if (!doc) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveState("saving");
    persist(doc);
  }, [doc, persist]);

  /** Manual delegation export: same logic as the sync on preset switch. */
  const onApplyStructure = useCallback(() => {
    if (doc) syncStructure(doc);
  }, [doc, syncStructure]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  /**
   * Drop position of a SINGLE card: it only slides minimally off other
   * cards (nothing stacks exactly on top). Surrounding cards never move —
   * there is no collision solver and no "magnetic" behavior; cards are
   * completely freely placeable.
   */
  const placeCard = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      const others = nodes.filter((n) => n.id !== id).map((n) => n.position);
      return nudgeCard(pos, others);
    },
    [nodes],
  );

  const onNodeDragStop = useCallback(
    (_e: unknown, node: Node) => {
      if (!doc || node.type !== "agent") return;
      changeDoc(topo.setPosition(doc, node.id, placeCard(node.id, node.position)));
    },
    [doc, changeDoc, placeCard],
  );

  /** Drop from the hidden bar: re-show the card at the mouse position. */
  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      const name = e.dataTransfer.getData(HIDDEN_DRAG_MIME);
      if (!name || !doc || !rf) return;
      e.preventDefault();
      const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const pos = placeCard(name, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
      changeDoc(topo.setPosition(topo.showProfile(doc, name), name, pos));
    },
    [doc, rf, placeCard, changeDoc],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!doc || !conn.source || !conn.target) return;
      const next = topo.setParent(doc, conn.target, conn.source);
      if (next !== doc) changeDoc(next);
    },
    [doc, changeDoc],
  );

  /** Delete an agent for good: native profile (Hermes API) + topology cleanup across all presets. */
  const onDeleteAgent = useCallback(
    async (name: string) => {
      if (!doc) return;
      await deleteProfile(name);
      setSelected(null);
      changeDoc(topo.removeAgent(doc, name));
      getProfiles().then(setProfiles).catch(() => undefined);
    },
    [doc, changeDoc],
  );

  /**
   * Growing chart area: pan and drag bounds follow the bounding box of the
   * content plus buffers. Dragging a card to the edge grows the area after
   * dropping (ratchet) — there is no infinite empty canvas.
   *
   * IMPORTANT: deliberately NOT tied to live node positions — otherwise the
   * bounds are recalculated on every drag frame and React Flow clamps and
   * re-renders permanently (flicker). The basis is the last built graph
   * (doc positions); the area only grows after dropping (ratchet).
   */
  const [extents, setExtents] = useState(() => ({
    translate: [[-2400, -1500], [2400, 2100]] as [[number, number], [number, number]],
    node: [[-2100, -1200], [2100, 1800]] as [[number, number], [number, number]],
  }));
  useEffect(() => {
    const real = extentBase.current.filter((n) => n.type === "agent");
    if (real.length === 0) return;
    const minX = Math.min(...real.map((n) => n.position.x));
    const minY = Math.min(...real.map((n) => n.position.y));
    const maxX = Math.max(...real.map((n) => n.position.x + NODE_WIDTH));
    const maxY = Math.max(...real.map((n) => n.position.y + NODE_HEIGHT));
    // Generous build buffers: much more room to the sides and bottom than to
    // the top so the organization can grow in width (ratchet: after every
    // drop at the edge the area keeps growing).
    const MOVE_X = 2100;    // build buffer left/right
    const MOVE_TOP = 500;   // build buffer to the top (usually only the apex sits there)
    const MOVE_BOTTOM = 1600; // build buffer to the bottom
    const PAN = 300;        // extra view buffer while panning
    setExtents({
      translate: [
        [minX - MOVE_X - PAN, minY - MOVE_TOP - PAN],
        [maxX + MOVE_X + PAN, maxY + MOVE_BOTTOM + PAN],
      ],
      node: [
        [minX - MOVE_X, minY - MOVE_TOP],
        [maxX + MOVE_X, maxY + MOVE_BOTTOM],
      ],
    });
  }, [profiles, doc, preset]);

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (!doc || deleted.length === 0) return;
      let next = doc;
      for (const e of deleted) next = topo.setParent(next, e.target, null);
      if (next !== doc) changeDoc(next);
    },
    [doc, changeDoc],
  );

  /** Clicking a line removes the connection directly (restore via dropdown/handle). */
  const onEdgeClick = useCallback(
    (e: any, edge: Edge) => {
      e?.stopPropagation?.();
      if (!doc) return;
      const next = topo.setParent(doc, edge.target, null);
      if (next !== doc) changeDoc(next);
    },
    [doc, changeDoc],
  );

  if (error) {
    return (
      <div className="ao-page">
        <C.Card>
          <C.CardHeader><C.CardTitle>FruVisi</C.CardTitle></C.CardHeader>
          <C.CardContent><p className="text-sm text-destructive">{t.loadError} {error}</p></C.CardContent>
        </C.Card>
      </div>
    );
  }

  if (!profiles || !doc) {
    return <div className="ao-page"><p className="ao-muted">{t.loading}</p></div>;
  }

  const selectedProfile = selected ? profiles.find((p) => p.name === selected) || null : null;
  const hiddenExisting = preset.hidden.filter((h) => profiles.some((p) => p.name === h));

  return (
    <div className="ao-page">
      <PresetBar
        doc={doc}
        preset={preset}
        profileNames={profiles.map((p) => p.name)}
        hiddenCount={hiddenExisting.length}
        showHidden={showHidden}
        saveState={saveState}
        applyState={applyState}
        onChange={changeDoc}
        onNewAgent={() => setWizardOpen(true)}
        onToggleShowHidden={setShowHidden}
        onSaveNow={saveNow}
        onApplyStructure={onApplyStructure}
      />
      <GroupBar
        preset={preset}
        profiles={profiles}
        spot={spot}
        onPreview={(gid) => setSpot((s) => (s?.locked ? s : gid ? { id: gid, locked: false } : null))}
        onToggle={(gid) => setSpot((s) => (s?.id === gid && s.locked ? null : { id: gid, locked: true }))}
      />
      {/* Fixed hidden bar (no longer a chart element): grab a card and drag
          it to the desired position on the board — it becomes visible there. */}
      {showHidden && hiddenExisting.length > 0 ? (
        <div className="ao-toolbar-detail ao-hiddenbar">
          <span className="ao-hiddenbar-title">{t.hiddenArea(hiddenExisting.length)}</span>
          {hiddenExisting.map((name) => {
            const n = preset.nodes[name];
            const color = n?.avatar?.color || colorFor(name);
            // In which other presets is this agent active (not hidden)?
            const activeIn = Object.entries(doc.presets)
              .filter(([key, p]) => key !== doc.activePreset && !(p.hidden || []).includes(name))
              .map(([, p]) => p.label);
            const chipTitle = activeIn.length
              ? `${t.hiddenChipTitle} · ${t.activeInPresets(activeIn.join(", "))}`
              : t.hiddenChipTitle;
            return (
              <span
                key={name}
                className="ao-hiddenchip"
                draggable
                title={chipTitle}
                onDragStart={(e) => {
                  e.dataTransfer.setData(HIDDEN_DRAG_MIME, name);
                  e.dataTransfer.effectAllowed = "move";
                }}
              >
                <span className="ao-color-dot" style={{ background: color }} />
                {n?.displayName || name}
                <button
                  className="ao-dept-x"
                  title={t.backToChartTitle}
                  onClick={() => changeDoc(topo.showProfile(doc, name))}
                >↩</button>
              </span>
            );
          })}
          <span className="ao-hint">{t.hiddenBarHint}</span>
        </div>
      ) : null}
      <div className="ao-body">
        <div
          className={"ao-canvas" + (spot ? " ao-spot-on" : "")}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(HIDDEN_DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={onCanvasDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onInit={setRf}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onEdgeClick={onEdgeClick}
            onNodeClick={(_e, node) => setSelected(node.id)}
            onPaneClick={() => { setSelected(null); setSpot(null); }}
            deleteKeyCode={["Backspace", "Delete"]}
            connectionRadius={40}
            connectOnClick={false}
            translateExtent={extents.translate}
            nodeExtent={extents.node}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1.2 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable
            nodesConnectable
            elementsSelectable
          >
            <Background gap={24} />
            {/* bottom right so the task dock (bottom left) does not cover them */}
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
          {kanbanAvailable ? <TaskDock tasks={tasks} onTasksChanged={refreshTasks} /> : null}
        </div>
        {selectedProfile ? (
          <Inspector
            profile={selectedProfile}
            profiles={profiles}
            preset={preset}
            doc={doc}
            tasks={tasks}
            onTasksChanged={refreshTasks}
            onChange={changeDoc}
            onDelete={onDeleteAgent}
            onClose={() => setSelected(null)}
            onFallbackChanged={refreshFallbacks}
          />
        ) : null}
      </div>
      {wizardOpen ? (
        <WizardDialog
          profiles={profiles}
          preset={preset}
          doc={doc}
          onChange={changeDoc}
          onCreated={(name) => {
            setWizardOpen(false);
            setSelected(name);
            getProfiles().then(setProfiles).catch(() => undefined);
            refreshFallbacks();
          }}
          onClose={() => setWizardOpen(false)}
        />
      ) : null}
    </div>
  );
}
