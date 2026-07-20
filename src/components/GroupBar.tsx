import { useMemo, useState } from "react";
import { C } from "../lib/sdk";
import type { Preset, Group, HermesProfile } from "../lib/types";
import { nodeGroup, groupAncestors, groupNotation, familyRoot } from "../lib/types";
import { groupDisplayColor } from "../lib/graph";
import { useT } from "../lib/i18n";

export interface SpotState {
  id: string;
  locked: boolean;
}

interface GroupBarProps {
  preset: Preset;
  profiles: HermesProfile[];
  spot: SpotState | null;
  onPreview: (gid: string | null) => void;
  onToggle: (gid: string) => void;
}

/** How many main-group chips are shown before "+N more" kicks in. */
const MAX_MAINS = 10;

/**
 * Group bar above the chart: one chip per main group (sorted by G number),
 * subgroups expandable per family, search across names and G numbers, small
 * legend. Hovering/clicking a chip toggles the spotlight — a pure visual
 * layer, chart positions stay untouched. Scales to many groups: subgroups
 * are collapsed by default, "+N more" kicks in above MAX_MAINS main groups,
 * and search filters everything flat.
 */
export function GroupBar({ preset, profiles, spot, onPreview, onToggle }: GroupBarProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  const groups = preset.groups || [];

  /** Visible members per group (incl. all subgroups of the family/subtree). */
  const counts = useMemo(() => {
    const hidden = new Set(preset.hidden || []);
    const map = new Map<string, number>();
    for (const p of profiles) {
      if (hidden.has(p.name)) continue;
      const gid = nodeGroup(preset.nodes[p.name]);
      if (!gid) continue;
      for (const owner of [gid, ...groupAncestors(groups, gid)]) {
        map.set(owner, (map.get(owner) || 0) + 1);
      }
    }
    return map;
  }, [preset, profiles, groups]);

  if (groups.length === 0) return null;

  const mains = groups.filter((g) => !g.parent).sort((a, b) => (a.num || 0) - (b.num || 0));
  const subsOf = (mainId: string) =>
    groups
      .filter((g) => g.parent && familyRoot(groups, g.id)?.id === mainId)
      .sort((a, b) => (a.num || 0) - (b.num || 0));

  const q = query.trim().toLowerCase();
  const matches = (g: Group) =>
    g.label.toLowerCase().includes(q) || groupNotation(groups, g).toLowerCase().includes(q);

  const chip = (g: Group, sub: boolean) => {
    const color = groupDisplayColor(groups, g);
    const family = familyRoot(groups, g.id);
    const strong = family?.color || g.color;
    const active = spot?.id === g.id && spot.locked;
    const subs = sub ? [] : subsOf(g.id);
    const isOpen = expanded.has(g.id);
    return (
      <span key={g.id} className="ao-gchip-wrap">
        <button
          className={"ao-gchip" + (sub ? " ao-gchip-sub" : "") + (active ? " ao-gchip-on" : "")}
          style={{ borderColor: strong, color: strong, background: active ? `${strong}22` : undefined }}
          title={sub && family ? `${family.label} ▸ ${g.label}` : g.label}
          onMouseEnter={() => onPreview(g.id)}
          onMouseLeave={() => onPreview(null)}
          onClick={() => onToggle(g.id)}
        >
          {sub ? <span className="ao-gchip-arrow">↳</span> : null}
          <span
            className="ao-gdot"
            style={{ background: color, boxShadow: sub ? undefined : `0 0 0 2px ${color}40` }}
          />
          <span className="ao-gnum">{groupNotation(groups, g)}</span>
          {g.label} · {counts.get(g.id) || 0}
        </button>
        {subs.length > 0 ? (
          <button
            className="ao-gexpand"
            title={isOpen ? t.collapseSubs : t.expandSubs(subs.length)}
            onClick={() => {
              const next = new Set(expanded);
              if (isOpen) next.delete(g.id);
              else next.add(g.id);
              setExpanded(next);
            }}
          >
            {isOpen ? "▾" : "▸"}{subs.length}
          </button>
        ) : null}
      </span>
    );
  };

  // Search active: flat result list (main and subgroups mixed).
  const searchResults = q ? groups.filter(matches) : [];
  const visibleMains = showAll ? mains : mains.slice(0, MAX_MAINS);
  const hiddenCount = mains.length - visibleMains.length;

  return (
    <div className="ao-groupbar">
      <div className="ao-groupbar-row">
        <span className="ao-groupbar-title">{t.groups}</span>
        {groups.length > 6 ? (
          <C.Input
            className="ao-gsearch"
            value={query}
            placeholder={t.searchGroups}
            onChange={(e: any) => setQuery(e.target.value)}
          />
        ) : null}
        {q ? (
          searchResults.length > 0
            ? searchResults.map((g) => chip(g, Boolean(g.parent)))
            : <span className="ao-hint">{t.noGroupMatch}</span>
        ) : (
          <>
            {visibleMains.map((g) => chip(g, false))}
            {hiddenCount > 0 ? (
              <button className="ao-gexpand" onClick={() => setShowAll(true)}>+{hiddenCount} {t.moreGroups}</button>
            ) : null}
            {showAll && mains.length > MAX_MAINS ? (
              <button className="ao-gexpand" onClick={() => setShowAll(false)}>{t.lessGroups}</button>
            ) : null}
          </>
        )}
        <button
          className="ao-gexpand ao-glegend-btn"
          title={t.legendTitle}
          onClick={() => setLegendOpen(!legendOpen)}
        >?</button>
      </div>
      {!q ? (
        [...expanded]
          .filter((id) => visibleMains.some((m) => m.id === id))
          .map((id) => (
            <div key={id} className="ao-groupbar-row ao-groupbar-subrow">
              {subsOf(id).map((g) => chip(g, true))}
              {subsOf(id).length === 0 ? <span className="ao-hint">{t.noSubs}</span> : null}
            </div>
          ))
      ) : null}
      {legendOpen ? (
        <div className="ao-glegend">
          <div>{t.legendMain}</div>
          <div>{t.legendSub}</div>
          <div>{t.legendSpot}</div>
          <div>{t.legendNumbers}</div>
        </div>
      ) : null}
    </div>
  );
}
