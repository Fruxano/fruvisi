import type { Node, Edge } from "@xyflow/react";
import type { HermesProfile, Preset, Group } from "./types";
import { nodeGroup, familyRoot, groupNotation, subgroupShade } from "./types";
import type { KanbanTask } from "./api";
import { layoutGraph } from "./layout";

export interface TaskStats {
  open: number;
  running: number;
}

/** Group tab on the outer card edge: the only permanent group marker
 *  in the chart (frames were removed in v1.2.1). */
export interface GroupTab {
  /** "G2" (main group) or "G2.1" (subgroup) */
  notation: string;
  /** Tab color: family color (main group) or shade (subgroup) */
  color: string;
  /** Strong family color — for readable badges/rings */
  familyColor: string;
  /** true = main-group member: square tab with aura; false = flag */
  main: boolean;
  /** Group name (tooltip), incl. the family chain for subgroups */
  title: string;
}

const CLOSED_STATUSES = new Set(["done", "archived"]);

/** Aggregate open/running tasks per assignee from the board list. */
export function taskStatsByAssignee(tasks: KanbanTask[]): Map<string, TaskStats> {
  const map = new Map<string, TaskStats>();
  for (const t of tasks) {
    if (!t.assignee || CLOSED_STATUSES.has(t.status)) continue;
    const s = map.get(t.assignee) || { open: 0, running: 0 };
    s.open += 1;
    if (t.status === "running") s.running += 1;
    map.set(t.assignee, s);
  }
  return map;
}

/** Deterministic avatar color from the profile name (fallback without config). */
export function colorFor(name: string): string {
  const palette = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f43f5e"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function initialsFor(name: string): string {
  const parts = name.replace(/[-_]+/g, " ").trim().split(/\s+/);
  const chars = parts.length >= 2 ? [parts[0][0], parts[1][0]] : [name[0], name[1] || ""];
  return chars.join("").toUpperCase();
}

export function isMoa(profile: HermesProfile): boolean {
  const m = (profile.model || "").toLowerCase();
  const p = (profile.provider || "").toLowerCase();
  return p === "moa" || m.startsWith("moa/") || m.includes("mixture");
}

/** Display color of a group: main group = own color, subgroup = family shade. */
export function groupDisplayColor(groups: Group[], g: Group): string {
  if (!g.parent) return g.color;
  const root = familyRoot(groups, g.id);
  return subgroupShade(root?.color || g.color, g.num || 1);
}

/** Tab data for the group of an agent (undefined = no group). */
export function tabFor(groups: Group[], gid: string | null): GroupTab | undefined {
  if (!gid) return undefined;
  const g = groups.find((x) => x.id === gid);
  if (!g) return undefined;
  const root = familyRoot(groups, g.id);
  return {
    notation: groupNotation(groups, g),
    color: groupDisplayColor(groups, g),
    familyColor: root?.color || g.color,
    main: !g.parent,
    title: g.parent && root ? `${root.label} ▸ ${g.label}` : g.label,
  };
}

/** Merge profiles + preset topology into React Flow nodes/edges.
 *  Hidden agents do NOT appear in the chart — they live in the fixed
 *  bar above the board and come back by drag. */
export function buildGraph(
  profiles: HermesProfile[],
  preset: Preset,
  taskStats?: Map<string, TaskStats>,
): { nodes: Node[]; edges: Edge[] } {
  const hidden = new Set(preset.hidden || []);
  const visible = profiles.filter((p) => !hidden.has(p.name));
  const byName = new Set(visible.map((p) => p.name));
  const deptById = new Map((preset.departments || []).map((d) => [d.id, d]));
  const groupById = new Map((preset.groups || []).map((g) => [g.id, g]));

  /** Explicitly designated top agent: no target handle, nothing above it.
   *  No structural automatism — cutting lines never changes the role. */
  const isTop = (name: string): boolean => preset.topAgent === name;

  const makeNode = (profile: HermesProfile): Node => {
    const orgNode = preset.nodes[profile.name];
    const dept = orgNode?.department ? deptById.get(orgNode.department) : undefined;
    const gid = nodeGroup(orgNode);
    const group = gid ? groupById.get(gid) : undefined;
    return {
      id: profile.name,
      type: "agent",
      position: orgNode?.position ?? { x: 0, y: 0 },
      draggable: !orgNode?.pinned,
      data: {
        profile,
        displayName: orgNode?.displayName,
        role: orgNode?.role,
        description: orgNode?.description,
        department: dept,
        group,
        tab: tabFor(preset.groups, gid),
        avatar: orgNode?.avatar,
        pinned: Boolean(orgNode?.pinned),
        isTop: isTop(profile.name),
        showInitials: preset.showInitials !== false,
        manualPosition: Boolean(orgNode?.position),
        tasks: taskStats?.get(profile.name),
      },
    };
  };

  const visibleNodes: Node[] = visible.map((p) => makeNode(p));

  const edges: Edge[] = [];
  for (const profile of visible) {
    const parent = preset.nodes[profile.name]?.parent;
    if (parent && byName.has(parent)) {
      edges.push({
        id: `${parent}->${profile.name}`,
        source: parent,
        target: profile.name,
        type: "smoothstep",
      });
    }
  }

  return { nodes: layoutGraph(visibleNodes, edges), edges };
}
