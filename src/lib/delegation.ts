import { SDK } from "./sdk";
import type { HermesProfile, Preset } from "./types";
import { nodeGroups, groupNotation } from "./types";

/**
 * Delegation export: writes the chart structure (hierarchy, area, groups)
 * into the native profile descriptions. Hermes uses the description as the
 * routing signal when distributing kanban tasks (the kanban decomposer reads
 * `hermes profile describe`). The FruVisi part is separated from the
 * user-written part by a marker and replaced on every apply.
 *
 * Notes are written in English on purpose: the decomposer prompt is English,
 * and one language keeps UI sync and chat-tool sync consistent.
 */

const MARKER = "[FruVisi-Structure]";
/** Older block markers — still recognized so existing descriptions migrate
 *  cleanly (old block replaced instead of duplicated). */
const LEGACY_MARKERS = ["[FruVisi-Struktur]"];

function structureNote(name: string, preset: Preset): string {
  const node = preset.nodes[name] || { parent: null, department: null, position: null };
  const deptLabel = node.department
    ? preset.departments.find((d) => d.id === node.department)?.label
    : undefined;
  const groupDefs = nodeGroups(node)
    .map((gid) => preset.groups.find((g) => g.id === gid))
    .filter((g): g is NonNullable<typeof g> => Boolean(g));
  // Subgroup context for routing: name the parent group as well.
  const parentLabelOf = (gid: string): string | undefined => {
    const parent = preset.groups.find((g) => g.id === gid)?.parent;
    return parent ? preset.groups.find((g) => g.id === parent)?.label : undefined;
  };
  const subordinates = Object.entries(preset.nodes)
    .filter(([k, v]) => k !== name && v.parent === name && !preset.hidden.includes(k))
    .map(([k]) => k);
  const coworkersOf = (gid: string) =>
    Object.entries(preset.nodes)
      .filter(([k, v]) => k !== name && nodeGroups(v).includes(gid) && !preset.hidden.includes(k))
      .map(([k]) => k);

  const isTop = preset.topAgent === name;
  const parts: string[] = [];
  if (node.role) parts.push(`Title: ${node.role}`);
  if (deptLabel) parts.push(`Area: ${deptLabel}`);
  parts.push(node.parent ? `Reports to: ${node.parent}` : isTop ? "Top instance of the organization" : "No parent instance");
  if (subordinates.length) parts.push(`Delegates to: ${subordinates.join(", ")}`);
  for (const g of groupDefs) {
    const coworkers = coworkersOf(g.id);
    const parent = parentLabelOf(g.id);
    const nr = groupNotation(preset.groups, g);
    const groupName = parent
      ? `Group "${g.label}" (${nr}, subgroup of "${parent}")`
      : `Group "${g.label}" (${nr})`;
    parts.push(
      coworkers.length
        ? `${groupName}: works in parallel with ${coworkers.join(", ")} on the same matter`
        : groupName,
    );
  }
  return parts.join(" · ");
}

/** Marker text for non-members of the active preset. The kanban decomposer
 *  routes purely by descriptions — this takes the agent out of the routing. */
function inactiveNote(preset: Preset): string {
  return `INACTIVE — not part of the active preset "${preset.label}". Do not assign tasks to this agent.`;
}

/** The existing description without a previous FruVisi block (any marker generation). */
function baseDescription(existing: string): string {
  let idx = -1;
  for (const m of [MARKER, ...LEGACY_MARKERS]) {
    const i = existing.indexOf(m);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  return (idx >= 0 ? existing.slice(0, idx) : existing).trim();
}

/**
 * Applies the active preset to ALL profiles: members get their structure note
 * (hierarchy, area, groups), non-members (agents hidden in the preset) an
 * INACTIVE marker — so after a preset switch only the selected cast works.
 * Returns the number of updated profiles.
 */
export async function applyStructure(
  profiles: HermesProfile[],
  preset: Preset,
): Promise<number> {
  let updated = 0;
  for (const p of profiles) {
    const member = !preset.hidden.includes(p.name);
    const note = member ? structureNote(p.name, preset) : inactiveNote(preset);
    const base = baseDescription(p.description || "");
    const next = base ? `${base}\n${MARKER} ${note}` : `${MARKER} ${note}`;
    if (next === (p.description || "").trim()) continue;
    await SDK.fetchJSON(`/api/profiles/${encodeURIComponent(p.name)}/description`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: next }),
    });
    updated++;
  }
  return updated;
}
