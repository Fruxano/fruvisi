export interface HermesProfile {
  name: string;
  path: string;
  is_default: boolean;
  model: string;
  provider: string;
  description: string;
  skill_count: number;
  gateway_running: boolean;
}

export interface Avatar {
  color?: string;
  initials?: string;
  /** Override the initials display for this agent only; undefined = preset setting */
  showInitials?: boolean;
}

export interface OrgNode {
  /** Profile name of the parent agent, or null for root nodes */
  parent: string | null;
  /** Area id (free-form label, no corporate structure implied) */
  department: string | null;
  /** Group ids (multiple membership possible) */
  groups?: string[];
  /** @deprecated legacy field (single group) — migrated to `groups` on load */
  group?: string | null;
  /** Manual position; null => auto layout (dagre) */
  position: { x: number; y: number } | null;
  avatar?: Avatar;
  /** Display name on the card (free spelling incl. capitals) —
   *  the technical profile name stays lowercase as Hermes requires. */
  displayName?: string;
  /** Title in the chart (free text, e.g. "coordination" or "research") */
  role?: string;
  /** Free description in the chart (independent of the profile description) */
  description?: string;
  /** Pinned: no moving, no re-parenting, no area/group changes */
  pinned?: boolean;
}

export interface Department {
  id: string;
  label: string;
  color: string;
}

export interface Group {
  id: string;
  label: string;
  /** Family color (only effective on main groups; subgroups inherit shades) */
  color: string;
  /** @deprecated relic of the old frame model (v1.2.0) — tolerated, unused */
  pinned?: boolean;
  /** Subgroup of (group id) */
  parent?: string | null;
  /** Stable number: main groups count G1, G2, ...; subgroups family-wide
   *  G<family>.1, G<family>.2, ... Existing groups are never renumbered;
   *  numbers of deleted groups are reused (smallest free). */
  num?: number;
}

export interface Preset {
  label: string;
  departments: Department[];
  groups: Group[];
  nodes: Record<string, OrgNode>;
  hidden: string[];
  /** Explicitly designated top agent. null = deliberately none;
   *  undefined (legacy data) is migrated once from the structure on load. */
  topAgent?: string | null;
  /** Show the avatar initials circle on the cards (default: true) */
  showInitials?: boolean;
}

export interface TopologyDoc {
  version: number;
  activePreset: string;
  presets: Record<string, Preset>;
  /** Switching presets writes active/inactive markers into the Hermes profile descriptions (default: true) */
  syncOnSwitch?: boolean;
  /** Default fallback model (OpenRouter), e.g. "@preset/glm-novita" — used
   *  wherever the fallback is enabled with just a checkbox. Empty/undefined = no default. */
  fallbackDefault?: string;
}

export const EMPTY_PRESET: Preset = {
  label: "Standard",
  departments: [],
  groups: [],
  nodes: {},
  hidden: [],
};

/** One-time migration for legacy data: adopt the unique root-with-subordinates. */
function structuralTop(nodes: Record<string, OrgNode>, hidden: string[]): string | null {
  const hiddenSet = new Set(hidden);
  const roots = Object.keys(nodes).filter(
    (k) =>
      !hiddenSet.has(k) &&
      !nodes[k].parent &&
      Object.entries(nodes).some(([c, v]) => c !== k && v.parent === k && !hiddenSet.has(c)),
  );
  return roots.length === 1 ? roots[0] : null;
}

/** Lift older topology.json states (single group, no topAgent etc.) to the current schema. */
export function normalizeDoc(doc: TopologyDoc): TopologyDoc {
  const presets: Record<string, Preset> = {};
  for (const [key, p] of Object.entries(doc.presets || {})) {
    const nodes: Record<string, OrgNode> = {};
    for (const [name, n] of Object.entries(p.nodes || {})) {
      // Migration: single group (group) -> multiple groups (groups)
      const groups = Array.isArray(n.groups) ? n.groups : n.group ? [n.group] : [];
      const { group: _legacy, ...rest } = n;
      nodes[name] = { ...rest, groups };
    }
    const hidden = p.hidden || [];
    // Migration: groups without a fixed number get one once, in array order
    // (main groups G1, G2, ...; subgroups family-wide G<F>.1, ...).
    const groups: Group[] = (p.groups || []).map((g) => ({ parent: null, ...g }));
    for (const g of groups) {
      if (!g.parent && !g.num) g.num = nextMainNum(groups);
    }
    for (const g of groups) {
      if (g.parent && !g.num) {
        const root = familyRoot(groups, g.id);
        g.num = root ? nextSubNum(groups, root.id) : nextMainNum(groups);
      }
    }
    presets[key] = {
      label: p.label || key,
      departments: p.departments || [],
      groups,
      nodes,
      hidden,
      // undefined = never set -> migrate once from the structure; null stays null (deliberately released)
      topAgent: p.topAgent !== undefined ? p.topAgent : structuralTop(nodes, hidden),
      showInitials: p.showInitials !== false,
    };
  }
  return {
    version: doc.version || 1,
    activePreset: doc.activePreset,
    presets,
    syncOnSwitch: doc.syncOnSwitch !== false,
    fallbackDefault: doc.fallbackDefault || undefined,
  };
}

/** All ancestors of a group (for permission checks and cycle protection). */
export function groupAncestors(groups: Group[], id: string): string[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out: string[] = [];
  let cur = byId.get(id)?.parent;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    out.push(cur);
    guard.add(cur);
    cur = byId.get(cur)?.parent;
  }
  return out;
}

/** Group ids of a node (migration-safe read). The FIRST one is the home group. */
export function nodeGroups(n: OrgNode | undefined): string[] {
  if (!n) return [];
  return Array.isArray(n.groups) ? n.groups : n.group ? [n.group] : [];
}

/** Group of a node (one per agent; legacy data with several: the first one counts). */
export function nodeGroup(n: OrgNode | undefined): string | null {
  const g = nodeGroups(n);
  return g.length ? g[0] : null;
}

/** Root of a group's family (topmost main group) — the group itself on cycles. */
export function familyRoot(groups: Group[], id: string): Group | undefined {
  const byId = new Map(groups.map((g) => [g.id, g]));
  let cur = byId.get(id);
  const guard = new Set<string>();
  while (cur && cur.parent && byId.has(cur.parent) && !guard.has(cur.id)) {
    guard.add(cur.id);
    cur = byId.get(cur.parent);
  }
  return cur;
}

/** Notation "G2" (main group) or "G2.1" (subgroup, numbered family-wide). */
export function groupNotation(groups: Group[], g: Group): string {
  if (!g.parent) return `G${g.num ?? "?"}`;
  const root = familyRoot(groups, g.id);
  return `G${root?.num ?? "?"}.${g.num ?? "?"}`;
}

/** Smallest free number >= 1 (numbers of deleted groups are reused;
 *  existing groups keep their number as long as they exist). */
function smallestFree(used: number[]): number {
  const set = new Set(used);
  let n = 1;
  while (set.has(n)) n++;
  return n;
}

/** Next main-group number: smallest free (G1, G2, ... without permanent gaps). */
export function nextMainNum(groups: Group[]): number {
  return smallestFree(groups.filter((g) => !g.parent).map((g) => g.num || 0));
}

/** Next subgroup number within a family (across all depths): smallest free. */
export function nextSubNum(groups: Group[], familyId: string): number {
  return smallestFree(
    groups
      .filter((g) => g.parent && familyRoot(groups, g.id)?.id === familyId)
      .map((g) => g.num || 0),
  );
}

/** Color shading for subgroups: family color mixed towards white,
 *  three cyclic steps by number — light enough to distinguish,
 *  close enough to read as one family. */
export function subgroupShade(familyColor: string, num: number): string {
  const hex = familyColor.replace("#", "");
  if (hex.length !== 6) return familyColor;
  const ratio = 0.3 + 0.15 * ((Math.max(1, num) - 1) % 3);
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * ratio).toString(16).padStart(2, "0");
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`;
}

/** Readable text color on a tab surface (light/dark by luminance). */
export function textOn(color: string): string {
  const hex = color.replace("#", "");
  if (hex.length !== 6) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#1f2937" : "#ffffff";
}

/** Groups in tree order (parents before their subgroups) with depth —
 *  for hierarchical dropdowns. Orphaned/cyclic entries are appended at the end. */
export function groupTree(groups: Group[]): { group: Group; depth: number }[] {
  const out: { group: Group; depth: number }[] = [];
  const seen = new Set<string>();
  const ids = new Set(groups.map((g) => g.id));
  const walk = (parent: string | null, depth: number) => {
    for (const g of groups) {
      const p = g.parent && ids.has(g.parent) ? g.parent : null;
      if (p !== parent || seen.has(g.id)) continue;
      seen.add(g.id);
      out.push({ group: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const g of groups) if (!seen.has(g.id)) out.push({ group: g, depth: 0 });
  return out;
}
