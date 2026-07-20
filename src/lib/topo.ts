import type { TopologyDoc, Preset, OrgNode, Avatar, Group } from "./types";
import { EMPTY_PRESET, groupAncestors, nodeGroups, familyRoot, nextMainNum, nextSubNum } from "./types";

/** Immutable helpers: every mutation returns a new TopologyDoc. */

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "preset";
}

function withPreset(doc: TopologyDoc, mutate: (p: Preset) => Preset): TopologyDoc {
  const current = doc.presets[doc.activePreset] || EMPTY_PRESET;
  return {
    ...doc,
    presets: { ...doc.presets, [doc.activePreset]: mutate(current) },
  };
}

function withNode(doc: TopologyDoc, profile: string, mutate: (n: OrgNode) => OrgNode): TopologyDoc {
  return withPreset(doc, (p) => {
    const existing: OrgNode = p.nodes[profile] || { parent: null, department: null, position: null };
    return { ...p, nodes: { ...p.nodes, [profile]: mutate(existing) } };
  });
}

export function activePreset(doc: TopologyDoc): Preset {
  return doc.presets[doc.activePreset] || EMPTY_PRESET;
}

export function setPosition(doc: TopologyDoc, profile: string, pos: { x: number; y: number }): TopologyDoc {
  if (activePreset(doc).nodes[profile]?.pinned) return doc;
  return withNode(doc, profile, (n) => ({ ...n, position: { x: Math.round(pos.x), y: Math.round(pos.y) } }));
}

/** true if `ancestor` appears in the chain above `profile` (cycle protection). */
function isAncestor(preset: Preset, ancestor: string, profile: string): boolean {
  let cur: string | null | undefined = preset.nodes[profile]?.parent;
  const guard = new Set<string>();
  while (cur) {
    if (cur === ancestor) return true;
    if (guard.has(cur)) return false;
    guard.add(cur);
    cur = preset.nodes[cur]?.parent;
  }
  return false;
}

/** Is `profile` the EXPLICITLY designated top agent? No automatism:
 *  cutting lines never changes the role; only setTopAgent(null) or swapAgents. */
export function isTopAgent(preset: Preset, profile: string): boolean {
  return Boolean(preset.topAgent) && preset.topAgent === profile;
}

/** Designate the top agent (null = release the role). Designating removes
 *  any existing parent (the top is a root by definition). */
export function setTopAgent(doc: TopologyDoc, profile: string | null): TopologyDoc {
  return withPreset(doc, (p) => {
    if (!profile) return { ...p, topAgent: null };
    const existing: OrgNode = p.nodes[profile] || { parent: null, department: null, position: null };
    return {
      ...p,
      topAgent: profile,
      nodes: { ...p.nodes, [profile]: { ...existing, parent: null } },
    };
  });
}

/** Set the parent agent. Unchanged on self/cycle connections, pinned
 *  targets, or when the designated top agent would be re-parented. */
export function setParent(doc: TopologyDoc, profile: string, parent: string | null): TopologyDoc {
  if (parent === profile) return doc;
  const p = activePreset(doc);
  if (p.nodes[profile]?.pinned) return doc;
  if (parent && isTopAgent(p, profile)) return doc; // top agent: only via swap or releasing the role
  if (parent && isAncestor(p, profile, parent)) return doc; // would create a cycle
  return withNode(doc, profile, (n) => ({ ...n, parent }));
}

export function setDepartment(doc: TopologyDoc, profile: string, department: string | null): TopologyDoc {
  if (activePreset(doc).nodes[profile]?.pinned) return doc;
  return withNode(doc, profile, (n) => ({ ...n, department }));
}

/** Set the group (one group per agent, as in the dropdown; null = none).
 *  Subgroup membership also covers the parent group. */
export function setGroup(doc: TopologyDoc, profile: string, groupId: string | null): TopologyDoc {
  if (activePreset(doc).nodes[profile]?.pinned) return doc;
  return withNode(doc, profile, (n) => ({ ...n, groups: groupId ? [groupId] : [], group: undefined }));
}

export function setRole(doc: TopologyDoc, profile: string, role: string): TopologyDoc {
  return withNode(doc, profile, (n) => ({ ...n, role: role || undefined }));
}

/** Display name of the card (free spelling; empty = show the profile name). */
export function setDisplayName(doc: TopologyDoc, profile: string, displayName: string): TopologyDoc {
  return withNode(doc, profile, (n) => ({ ...n, displayName: displayName || undefined }));
}

export function setDescription(doc: TopologyDoc, profile: string, description: string): TopologyDoc {
  return withNode(doc, profile, (n) => ({ ...n, description: description || undefined }));
}

export function setPinned(doc: TopologyDoc, profile: string, pinned: boolean): TopologyDoc {
  return withNode(doc, profile, (n) => ({ ...n, pinned: pinned || undefined }));
}

export function setAvatar(doc: TopologyDoc, profile: string, avatar: Avatar | undefined): TopologyDoc {
  return withNode(doc, profile, (n) => ({ ...n, avatar }));
}

/** Hiding releases all assignments: the agent's own parent + group are
 *  removed and subordinates are released (become roots). A later re-show
 *  then never collides with a structure that changed in the meantime. */
export function hideProfile(doc: TopologyDoc, profile: string): TopologyDoc {
  return withPreset(doc, (p) => {
    const nodes: Record<string, OrgNode> = {};
    for (const [k, v] of Object.entries(p.nodes)) {
      if (k === profile) nodes[k] = { ...v, parent: null, groups: [], group: undefined, position: null };
      else nodes[k] = v.parent === profile ? { ...v, parent: null } : v;
    }
    return {
      ...p,
      nodes,
      hidden: p.hidden.includes(profile) ? p.hidden : [...p.hidden, profile],
      // A hidden top agent makes no sense -> release the role.
      topAgent: p.topAgent === profile ? null : p.topAgent,
    };
  });
}

/** Remove an agent from the topology entirely — across ALL presets (profiles are global).
 *  Subordinates are released, the top-agent role dissolved, hidden lists cleaned.
 *  The caller deletes the native profile itself via the Hermes API. */
export function removeAgent(doc: TopologyDoc, profile: string): TopologyDoc {
  const presets: Record<string, Preset> = {};
  for (const [key, p] of Object.entries(doc.presets)) {
    const nodes: Record<string, OrgNode> = {};
    for (const [k, v] of Object.entries(p.nodes)) {
      if (k === profile) continue;
      nodes[k] = v.parent === profile ? { ...v, parent: null } : v;
    }
    presets[key] = {
      ...p,
      nodes,
      topAgent: p.topAgent === profile ? null : p.topAgent,
      hidden: p.hidden.filter((h) => h !== profile),
    };
  }
  return { ...doc, presets };
}

export function showProfile(doc: TopologyDoc, profile: string): TopologyDoc {
  return withPreset(doc, (p) => ({ ...p, hidden: p.hidden.filter((h) => h !== profile) }));
}

export function clearPositions(doc: TopologyDoc): TopologyDoc {
  return withPreset(doc, (p) => {
    const nodes: Record<string, OrgNode> = {};
    for (const [k, v] of Object.entries(p.nodes)) nodes[k] = { ...v, position: null };
    return { ...p, nodes };
  });
}

export function addDepartment(doc: TopologyDoc, label: string, color: string): TopologyDoc {
  const id = slugify(label);
  return withPreset(doc, (p) => {
    if (p.departments.some((d) => d.id === id)) return p;
    return { ...p, departments: [...p.departments, { id, label, color }] };
  });
}

/** Rename an area: only the label changes, the id (and with it every
 *  agent assignment) stays stable — nothing needs to be re-assigned. */
export function renameDepartment(doc: TopologyDoc, id: string, label: string): TopologyDoc {
  return withPreset(doc, (p) => ({
    ...p,
    departments: p.departments.map((d) => (d.id === id ? { ...d, label } : d)),
  }));
}

/** Rename a group: label-only, id/number/assignments/subgroups stay. */
export function renameGroup(doc: TopologyDoc, id: string, label: string): TopologyDoc {
  return withPreset(doc, (p) => ({
    ...p,
    groups: p.groups.map((g) => (g.id === id ? { ...g, label } : g)),
  }));
}

export function removeDepartment(doc: TopologyDoc, id: string): TopologyDoc {
  return withPreset(doc, (p) => {
    const nodes: Record<string, OrgNode> = {};
    for (const [k, v] of Object.entries(p.nodes)) {
      nodes[k] = v.department === id ? { ...v, department: null } : v;
    }
    return { ...p, departments: p.departments.filter((d) => d.id !== id), nodes };
  });
}

export function addGroup(doc: TopologyDoc, label: string, color: string, parent: string | null = null): TopologyDoc {
  const id = slugify(label);
  return withPreset(doc, (p) => {
    if (p.groups.some((g) => g.id === id)) return p;
    const validParent = parent && p.groups.some((g) => g.id === parent) ? parent : null;
    // Fixed number at creation: main group -> next free G number,
    // subgroup -> next free number of the family (across all depths).
    const num = validParent
      ? nextSubNum(p.groups, familyRoot(p.groups, validParent)!.id)
      : nextMainNum(p.groups);
    return { ...p, groups: [...p.groups, { id, label, color, parent: validParent, num }] };
  });
}

/** All descendants of a group (direct + deeper). */
function descendantsOf(groups: Group[], id: string): string[] {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.parent && out.has(g.parent) && !out.has(g.id)) {
        out.add(g.id);
        grew = true;
      }
    }
  }
  out.delete(id);
  return [...out];
}

/** Set the subgroup relation (null = standalone). Cycles are ignored.
 *  If the group changes family (or switches main/sub level), it and its
 *  descendants get fresh numbers in the target — numbers stay unique per family. */
export function setGroupParent(doc: TopologyDoc, id: string, parent: string | null): TopologyDoc {
  return withPreset(doc, (p) => {
    if (parent === id) return p;
    if (parent && !p.groups.some((g) => g.id === parent)) return p;
    if (parent && groupAncestors(p.groups, parent).includes(id)) return p; // would create a cycle
    const before = p.groups.find((g) => g.id === id);
    if (!before || (before.parent ?? null) === parent) return p;

    const oldRoot = familyRoot(p.groups, id)?.id;
    const groups = p.groups.map((g) => (g.id === id ? { ...g, parent } : g));
    const newRoot = familyRoot(groups, id)?.id;
    const levelChanged = Boolean(before.parent) !== Boolean(parent);
    if (oldRoot === newRoot && !levelChanged) return { ...p, groups }; // move within the family

    const moved = [id, ...descendantsOf(groups, id)];
    // Release the old numbers of the moved groups first — otherwise they
    // block themselves during renumbering in the target family.
    for (const gid of moved) {
      const idx = groups.findIndex((g) => g.id === gid);
      groups[idx] = { ...groups[idx], num: 0 };
    }
    for (const gid of moved) {
      const idx = groups.findIndex((g) => g.id === gid);
      const g = groups[idx];
      const num = g.parent ? nextSubNum(groups, familyRoot(groups, g.id)!.id) : nextMainNum(groups);
      groups[idx] = { ...g, num };
    }
    return { ...p, groups };
  });
}

export function setShowInitials(doc: TopologyDoc, show: boolean): TopologyDoc {
  return withPreset(doc, (p) => ({ ...p, showInitials: show }));
}

export function removeGroup(doc: TopologyDoc, id: string): TopologyDoc {
  return withPreset(doc, (p) => {
    const removed = p.groups.find((g) => g.id === id);
    const nodes: Record<string, OrgNode> = {};
    for (const [k, v] of Object.entries(p.nodes)) {
      const groups = nodeGroups(v).filter((g) => g !== id);
      nodes[k] = { ...v, groups, group: undefined };
    }
    // Children move up to the parent of the deleted group; if that makes them
    // main groups they get fresh G numbers (the old subgroup number does not
    // count for the main counter). Deeper descendants keep their numbers.
    const childIds = new Set(p.groups.filter((g) => g.parent === id).map((g) => g.id));
    const groups = p.groups
      .filter((g) => g.id !== id)
      .map((g) => (g.parent === id ? { ...g, parent: removed?.parent ?? null } : g));
    if (removed && !removed.parent) {
      for (const g of groups) {
        if (childIds.has(g.id) && !g.parent) {
          g.num = nextMainNum(groups.map((x) => (x.id === g.id ? { ...x, num: 0 } : x)));
        }
      }
    }
    return { ...p, groups, nodes };
  });
}

const DEFAULT_NODE: OrgNode = { parent: null, department: null, position: null };

/**
 * Swap two agents structurally: slot properties (parent, subordinates, area,
 * group, position, title, pin) change owner; agent-bound properties (avatar,
 * description) stay with the agent. This allows safely replacing the top
 * agent (demotion): the previous top agent takes over the old slot of the
 * other — including its pins, if set.
 */
export function swapAgents(doc: TopologyDoc, a: string, b: string): TopologyDoc {
  if (a === b) return doc;
  return withPreset(doc, (p) => {
    const na = p.nodes[a] || DEFAULT_NODE;
    const nb = p.nodes[b] || DEFAULT_NODE;
    const mapParent = (x: string | null | undefined): string | null =>
      x === a ? b : x === b ? a : (x ?? null);

    const nodes: Record<string, OrgNode> = {};
    for (const [k, v] of Object.entries(p.nodes)) {
      if (k === a || k === b) continue;
      nodes[k] = { ...v, parent: mapParent(v.parent) };
    }
    nodes[a] = { ...nb, parent: mapParent(nb.parent), avatar: na.avatar, description: na.description, displayName: na.displayName };
    nodes[b] = { ...na, parent: mapParent(na.parent), avatar: nb.avatar, description: nb.description, displayName: nb.displayName };
    // The top-agent role belongs to the slot and moves with it.
    const topAgent = p.topAgent === a ? b : p.topAgent === b ? a : p.topAgent;
    return { ...p, nodes, topAgent };
  });
}

export function renamePreset(doc: TopologyDoc, label: string): TopologyDoc {
  return withPreset(doc, (p) => ({ ...p, label }));
}

export function setActivePresetKey(doc: TopologyDoc, key: string): TopologyDoc {
  if (!doc.presets[key]) return doc;
  return { ...doc, activePreset: key };
}

/** New preset (empty or a copy of the active one), activated immediately.
 *  "Empty" means since v1.2.6: WITHOUT members — all existing profiles start
 *  hidden (not in the preset) and are added by dragging from the bar. */
export function addPreset(doc: TopologyDoc, label: string, duplicate: boolean, allProfiles: string[] = []): TopologyDoc {
  let key = slugify(label);
  while (doc.presets[key]) key = key + "-2";
  const base = duplicate
    ? JSON.parse(JSON.stringify(activePreset(doc))) as Preset
    : { ...EMPTY_PRESET, departments: [], nodes: {}, hidden: [...allProfiles], topAgent: null };
  return {
    ...doc,
    activePreset: key,
    presets: { ...doc.presets, [key]: { ...base, label } },
  };
}

/** Setting: switching presets syncs active/inactive into the Hermes profiles. */
export function setSyncOnSwitch(doc: TopologyDoc, on: boolean): TopologyDoc {
  return { ...doc, syncOnSwitch: on };
}

/** Setting: default fallback model (OpenRouter); empty = no default. */
export function setFallbackDefault(doc: TopologyDoc, model: string): TopologyDoc {
  return { ...doc, fallbackDefault: model.trim() || undefined };
}

export function deletePreset(doc: TopologyDoc, key: string): TopologyDoc {
  const keys = Object.keys(doc.presets);
  if (keys.length <= 1 || !doc.presets[key]) return doc;
  const presets = { ...doc.presets };
  delete presets[key];
  const nextActive = doc.activePreset === key ? Object.keys(presets)[0] : doc.activePreset;
  return { ...doc, presets, activePreset: nextActive };
}
