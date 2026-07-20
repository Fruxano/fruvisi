import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { HermesProfile, Avatar, Department, Group } from "../lib/types";
import { textOn } from "../lib/types";
import type { TaskStats, GroupTab } from "../lib/graph";
import { colorFor, initialsFor, isMoa } from "../lib/graph";
import { useT } from "../lib/i18n";

export const TASK_DRAG_MIME = "application/x-agent-org-task";

interface AgentCardData {
  profile: HermesProfile;
  /** Free spelling for the card (technical profile name stays lowercase) */
  displayName?: string;
  role?: string;
  description?: string;
  /** The profile OpenRouter fallback model (undefined = no fallback) */
  fallbackModel?: string;
  department?: Department;
  group?: Group;
  tab?: GroupTab;
  avatar?: Avatar;
  pinned?: boolean;
  isTop?: boolean;
  showInitials?: boolean;
  /** Spotlight state (group bar): direct member, family member or dimmed */
  spot?: "direct" | "family" | "dim";
  /** Ring color of the active spotlight */
  spotColor?: string;
  tasks?: TaskStats;
  onAssignTask?: (taskId: string, profile: string) => void;
  [key: string]: unknown;
}

function shortModel(model: string): string {
  const last = (model || "").split("/").pop() || model;
  return last.length > 26 ? last.slice(0, 24) + "…" : last;
}

export function AgentCard({ data }: NodeProps) {
  const t = useT();
  const { profile, displayName, description, fallbackModel, department, group, tab, avatar, pinned, isTop, showInitials, spot, spotColor, tasks, onAssignTask } =
    data as AgentCardData;
  const color = avatar?.color || department?.color || colorFor(profile.name);
  const initials = avatar?.initials || initialsFor(displayName || profile.name);
  const moa = isMoa(profile);
  const [dropActive, setDropActive] = useState(false);

  // Composed shadows: inner group ring (tab color), golden aura for the
  // top agent (replaces the crown), subtle base shadow.
  const shadows: string[] = [];
  if (tab) shadows.push(`inset 0 0 0 1.5px ${tab.color}66`);
  if (isTop) shadows.push("0 0 0 1px #f59e0b99", "0 0 26px 4px #f59e0b45");
  shadows.push("0 2px 6px rgba(0, 0, 0, 0.3)");

  // Spotlight: members get a ring (solid = direct, dashed = via a subgroup
  // of the family), everyone else dims. Purely visual — positions and layout
  // stay untouched.
  const spotStyle =
    spot === "direct" ? { outline: `2.5px solid ${spotColor}`, outlineOffset: 3 }
    : spot === "family" ? { outline: `2.5px dashed ${spotColor}`, outlineOffset: 3 }
    : spot === "dim" ? { opacity: 0.28 }
    : {};

  return (
    <div
      className={"ao-card" + (dropActive ? " ao-card-drop" : "") + (isTop ? " ao-card-top" : "")}
      style={{
        borderTopColor: color,
        boxShadow: shadows.join(", "),
        // Let the accent color subtly bleed into the card background
        background: `linear-gradient(165deg, color-mix(in srgb, ${color} 7%, var(--color-card)) 0%, var(--color-card) 55%)`,
        ...spotStyle,
      }}
      title={(isTop ? t.topAgentTitle + (description ? " — " : "") : "") + (description || "") || undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(TASK_DRAG_MIME)) setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        setDropActive(false);
        const taskId = e.dataTransfer.getData(TASK_DRAG_MIME);
        if (taskId && onAssignTask) {
          e.preventDefault();
          onAssignTask(taskId, profile.name);
        }
      }}
    >
      {/* Group tab on the outer left edge: main group = square + aura,
          subgroup = pointed flag in the family shade. The card interior is
          reserved for the agent color. */}
      {tab ? (
        <span
          className={"ao-gtab" + (tab.main ? " ao-gtab-main" : " ao-gtab-flag")}
          style={{
            background: tab.color,
            color: textOn(tab.color),
            boxShadow: tab.main ? `0 0 0 2px ${tab.color}40, 0 0 9px 2px ${tab.color}59` : undefined,
          }}
          title={tab.title}
        >
          {tab.notation}
        </span>
      ) : null}
      {!isTop ? <Handle type="target" position={Position.Top} className="ao-handle" /> : null}
      {pinned ? <span className="ao-pin" title={t.pinnedTitle}>📌</span> : null}
      <div className="ao-card-row">
        {(avatar?.showInitials ?? showInitials !== false) ? (
          <div className="ao-avatar" style={{ background: color }}>{initials}</div>
        ) : (
          <div className="ao-color-dot" style={{ background: color }} />
        )}
        {/* Deliberately NO title/description line anymore (v1.3.8): long native
            descriptions were only truncated here. Title/description live on as
            data (structure notes, tooltip); the card stays tidy. */}
        <div className="ao-card-main">
          <div className="ao-name" title={displayName ? profile.name : undefined}>{displayName || profile.name}</div>
        </div>
      </div>
      <div className="ao-badges">
        {/* MoA agents also show the selected MoA preset — with several presets
            a bare "MoA" would not be distinguishable. */}
        <span className={"ao-badge " + (moa ? "ao-badge-moa" : "ao-badge-model")} title={moa ? profile.model : undefined}>
          {moa
            ? "MoA" + (profile.model && profile.model !== "moa" ? " · " + shortModel(profile.model) : "")
            : shortModel(profile.model)}
        </span>
        {department ? (
          <span className="ao-badge ao-badge-dept" style={{ borderColor: department.color, color: department.color }}>
            {department.label}
          </span>
        ) : null}
        {tab && group ? (
          <span className="ao-badge" style={{ borderColor: tab.familyColor, color: tab.familyColor }} title={tab.title}>
            ⫘ {tab.notation} {group.label}
          </span>
        ) : null}
        {tasks && tasks.open > 0 ? (
          <span className={"ao-badge " + (tasks.running > 0 ? "ao-badge-running" : "ao-badge-tasks")}>
            {tasks.running > 0 ? `${tasks.running} ${t.running} · ` : ""}{tasks.open} {t.open}
          </span>
        ) : null}
        {fallbackModel ? (
          <span className="ao-badge ao-badge-fb" title={t.fallbackBadgeTitle(fallbackModel)}>⇄ FB</span>
        ) : null}
        {profile.gateway_running ? <span className="ao-badge ao-badge-live">{t.active}</span> : null}
      </div>
      <Handle type="source" position={Position.Bottom} className="ao-handle" />
    </div>
  );
}
