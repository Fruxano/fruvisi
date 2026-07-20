import { useEffect, useState } from "react";
import { C } from "../lib/sdk";
import type { HermesProfile, Preset, TopologyDoc } from "../lib/types";
import { nodeGroups, groupTree, groupNotation } from "../lib/types";
import { colorFor, initialsFor, isMoa } from "../lib/graph";
import { assignKanbanTask, createKanbanTask, getProfileFallback, setProfileFallback, type KanbanTask, type FallbackEntry } from "../lib/api";
import { useT } from "../lib/i18n";
import * as topo from "../lib/topo";

const PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f43f5e"];

interface InspectorProps {
  profile: HermesProfile;
  profiles: HermesProfile[];
  preset: Preset;
  doc: TopologyDoc;
  tasks: KanbanTask[];
  onTasksChanged: () => void;
  onChange: (doc: TopologyDoc) => void;
  onDelete: (name: string) => Promise<void>;
  onClose: () => void;
  /** The profile fallback changed — reload the card badges. */
  onFallbackChanged?: () => void;
}

/** Right panel: properties of the selected agent. */
export function Inspector({ profile, profiles, preset, doc, tasks, onTasksChanged, onChange, onDelete, onClose, onFallbackChanged }: InspectorProps) {
  const t = useT();
  const node = preset.nodes[profile.name] || { parent: null, department: null, position: null };
  const [displayName, setDisplayNameInput] = useState(node.displayName || "");
  const [initials, setInitials] = useState(node.avatar?.initials || "");
  const [newTask, setNewTask] = useState("");
  const [taskBusy, setTaskBusy] = useState(false);
  const [swapWith, setSwapWith] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const myGroups = nodeGroups(node);

  /** The profile's OpenRouter fallback (FruVisi manages ONE OpenRouter
   *  entry; foreign chain entries are preserved on save). If the agent itself
   *  runs on OpenRouter the option is hidden — existing leftover entries get
   *  a remove button instead. */
  const isOpenRouterAgent = (profile.provider || "").toLowerCase() === "openrouter";
  const fbDefault = (doc.fallbackDefault || "").trim();
  const [fbModel, setFbModel] = useState("");
  const [fbOthers, setFbOthers] = useState<FallbackEntry[]>([]);
  /** Checkbox ticked but no model typed yet (only possible without a default). */
  const [fbPending, setFbPending] = useState(false);
  const [fbState, setFbState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setFbState("loading");
    setFbPending(false);
    getProfileFallback(profile.name)
      .then((entries) => {
        if (!alive) return;
        const or = entries.find((e) => e.provider === "openrouter" && !e.base_url);
        setFbModel(or?.model || "");
        setFbOthers(entries.filter((e) => e !== or));
        setFbState("idle");
      })
      .catch(() => { if (alive) setFbState("error"); });
    return () => { alive = false; };
  }, [profile.name]);

  /** Saves `model` as the OpenRouter entry (empty = remove), rest stays. */
  const commitFallback = (model: string, others: FallbackEntry[] = fbOthers) => {
    if (fbState === "loading" || fbState === "saving") return;
    const m = model.trim();
    const entries = (m ? [{ provider: "openrouter", model: m }] : []).concat(others);
    setFbState("saving");
    setProfileFallback(profile.name, entries)
      .then(() => {
        setFbState("saved");
        onFallbackChanged?.();
        window.setTimeout(() => setFbState((s) => (s === "saved" ? "idle" : s)), 2500);
      })
      .catch(() => setFbState("error"));
  };

  const fbActive = Boolean(fbModel.trim()) || fbPending;

  const toggleFallback = (on: boolean) => {
    if (on) {
      if (fbDefault) { setFbModel(fbDefault); commitFallback(fbDefault); }
      else setFbPending(true);
    } else {
      setFbModel("");
      setFbPending(false);
      commitFallback("");
    }
  };

  const blurFallback = () => {
    const m = fbModel.trim();
    if (!m) { setFbPending(false); commitFallback(""); return; }
    commitFallback(m);
  };

  /** Clean up the entire leftover chain of an OpenRouter agent. */
  const removeAllFallback = () => {
    setFbModel("");
    setFbOthers([]);
    setFbPending(false);
    commitFallback("", []);
  };

  const isHidden = preset.hidden.includes(profile.name);
  const pinned = Boolean(node.pinned);
  const topAgent = topo.isTopAgent(preset, profile.name);
  const locked = pinned && !topAgent;
  const presetInitialsDefault = preset.showInitials !== false;
  const initialsOn = node.avatar?.showInitials ?? presetInitialsDefault;

  const myTasks = tasks
    .filter((x) => x.assignee === profile.name)
    .sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));

  const swapCandidates = profiles.filter((p) => p.name !== profile.name && !preset.hidden.includes(p.name));

  const commitDisplayName = () => onChange(topo.setDisplayName(doc, profile.name, displayName.trim()));
  const commitInitials = () => {
    const v = initials.trim().toUpperCase().slice(0, 3);
    onChange(topo.setAvatar(doc, profile.name, { ...node.avatar, initials: v || undefined }));
  };

  const addTask = async () => {
    const title = newTask.trim();
    if (!title || taskBusy) return;
    setTaskBusy(true);
    try {
      await createKanbanTask(title, profile.name);
      setNewTask("");
      onTasksChanged();
    } finally {
      setTaskBusy(false);
    }
  };

  return (
    <div className="ao-panel">
      <div className="ao-panel-head">
        <span className="ao-panel-title">
          {profile.name}
          {topAgent ? <span className="ao-top-tag" title={t.topAgentTitle}>{t.topAgent}</span> : null}
          {locked ? " 📌" : null}
        </span>
        <C.Button variant="ghost" size="sm" onClick={onClose}>✕</C.Button>
      </div>

      {isHidden ? (
        <C.Button onClick={() => onChange(topo.showProfile(doc, profile.name))}>
          {t.backToChart}
        </C.Button>
      ) : null}

      <div className="ao-field">
        <C.Label>{t.displayNameLabel}</C.Label>
        <C.Input
          value={displayName}
          placeholder={t.displayNamePlaceholder}
          onChange={(e: any) => setDisplayNameInput(e.target.value)}
          onBlur={commitDisplayName}
          onKeyDown={(e: any) => e.key === "Enter" && commitDisplayName()}
        />
      </div>

      {/* Title/description fields deliberately removed (v1.3.8): single-line
          inputs were unreadable for longer texts; descriptive text belongs in
          the native profile editor (linked below). The chart title is still
          set in the wizard and flows into the structure notes. */}

      {/* Structure fields only for visible agents — hiding releases all
          assignments. Stacked instead of two columns (v1.3.9): long (subgroup)
          names overflowed the panel in the narrow grid. */}
      {!isHidden && (preset.departments.length > 0 || preset.groups.length > 0) ? (
        <div className="ao-stack">
          {preset.departments.length > 0 ? (
            <div className="ao-field">
              <C.Label>{t.department}</C.Label>
              <select
                className="ao-select"
                value={node.department || ""}
                disabled={locked}
                onChange={(e) => onChange(topo.setDepartment(doc, profile.name, e.target.value || null))}
              >
                <option value="">{t.noneM}</option>
                {preset.departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
            </div>
          ) : null}
          {preset.groups.length > 0 ? (
            <div className="ao-field">
              <C.Label>{t.group}</C.Label>
              {/* One group per agent (dropdown as in v1.1.0), subgroups indented —
                  subgroup members also belong to the parent group. */}
              <select
                className="ao-select"
                value={myGroups[0] || ""}
                disabled={locked}
                onChange={(e) => onChange(topo.setGroup(doc, profile.name, e.target.value || null))}
              >
                <option value="">{t.noneF}</option>
                {groupTree(preset.groups).map(({ group: g, depth }) => (
                  <option key={g.id} value={g.id}>
                    {"   ".repeat(depth) + (depth > 0 ? "↳ " : "") + groupNotation(preset.groups, g) + " · " + g.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
      {!isHidden && myGroups.length > 0 && isMoa(profile) ? <p className="ao-hint">{t.moaGroupHint}</p> : null}

      {!isHidden ? (
        <div className="ao-field">
          <C.Label>{t.parent}</C.Label>
          <select
            className="ao-select"
            value={node.parent || ""}
            disabled={locked || topAgent}
            onChange={(e) => onChange(topo.setParent(doc, profile.name, e.target.value || null))}
          >
            <option value="">{t.rootOption}</option>
            {swapCandidates.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          {!locked && !topAgent ? <p className="ao-hint">{t.parentHint}</p> : null}
          {locked ? <p className="ao-hint">{t.lockedHint}</p> : null}
          {topAgent ? <p className="ao-hint">{t.topAgentHint}</p> : null}
        </div>
      ) : null}

      {!isHidden ? (
        <div className="ao-inline">
          {!topAgent ? (
            <C.Button
              variant="outline"
              size="sm"
              onClick={() => onChange(topo.setPinned(doc, profile.name, !pinned))}
            >
              {pinned ? t.unpin : t.pin}
            </C.Button>
          ) : null}
          <C.Button
            variant="outline"
            size="sm"
            title={t.topAgentTitle}
            onClick={() => onChange(topo.setTopAgent(doc, topAgent ? null : profile.name))}
          >
            {topAgent ? t.dissolveTop : t.makeTop}
          </C.Button>
        </div>
      ) : null}

      {!isHidden && swapCandidates.length > 0 ? (
        <div className="ao-field">
          <C.Label>{t.swapWith}</C.Label>
          <div className="ao-inline">
            <select className="ao-select" value={swapWith} onChange={(e) => setSwapWith(e.target.value)}>
              <option value="">{t.chooseAgent}</option>
              {swapCandidates.map((p) => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
            <C.Button
              size="sm"
              variant="outline"
              disabled={!swapWith}
              onClick={() => { onChange(topo.swapAgents(doc, profile.name, swapWith)); setSwapWith(""); }}
            >
              {t.swap}
            </C.Button>
          </div>
          <p className="ao-hint">{t.swapHint}</p>
        </div>
      ) : null}

      <div className="ao-field">
        <C.Label>{t.avatarColor}</C.Label>
        <div className="ao-swatches">
          <button
            className={"ao-swatch ao-swatch-auto" + (!node.avatar?.color ? " ao-swatch-active" : "")}
            title={t.autoColor + " (" + colorFor(profile.name) + ")"}
            onClick={() => onChange(topo.setAvatar(doc, profile.name, { ...node.avatar, color: undefined }))}
          >A</button>
          {PALETTE.map((c) => (
            <button
              key={c}
              className={"ao-swatch" + ((node.avatar?.color || "") === c ? " ao-swatch-active" : "")}
              style={{ background: c }}
              title={c}
              onClick={() => onChange(topo.setAvatar(doc, profile.name, { ...node.avatar, color: c }))}
            />
          ))}
          <input
            type="color"
            className="ao-color"
            value={node.avatar?.color || colorFor(profile.name)}
            title={t.customColor}
            onChange={(e) => onChange(topo.setAvatar(doc, profile.name, { ...node.avatar, color: e.target.value }))}
          />
        </div>
      </div>

      <label className="ao-radio">
        <input
          type="checkbox"
          checked={initialsOn}
          onChange={(e) => {
            // Collision-free with the preset setting: only store the override
            // when it differs from the preset default — otherwise back to "follows preset".
            const v = e.target.checked;
            onChange(topo.setAvatar(doc, profile.name, {
              ...node.avatar,
              showInitials: v === presetInitialsDefault ? undefined : v,
            }));
          }}
        />
        {t.initialsThisAgent}
      </label>

      {initialsOn ? (
        <div className="ao-field">
          <C.Label>{t.avatarInitials}</C.Label>
          <C.Input
            value={initials}
            placeholder={initialsFor(profile.name)}
            maxLength={3}
            onChange={(e: any) => setInitials(e.target.value)}
            onBlur={commitInitials}
            onKeyDown={(e: any) => e.key === "Enter" && commitInitials()}
          />
        </div>
      ) : null}

      <div className="ao-field ao-meta">
        <div><span className="ao-muted">{t.model}</span> {isMoa(profile) ? "MoA" : profile.model || "—"}</div>
        <div><span className="ao-muted">{t.provider}</span> {profile.provider || "—"}</div>
        <div><span className="ao-muted">{t.skills}</span> {profile.skill_count}</div>
      </div>

      {!isOpenRouterAgent ? (
        <div className="ao-field">
          <div className="ao-inline">
            <label className="ao-radio">
              <input
                type="checkbox"
                checked={fbActive}
                disabled={fbState === "loading"}
                onChange={(e) => toggleFallback(e.target.checked)}
              />
              {fbDefault ? t.fallbackToggleDefault(fbDefault) : t.fallbackLabel}
            </label>
            <span className={"ao-save ao-save-" + (fbState === "saved" ? "saved" : fbState === "error" ? "error" : "idle")}>
              {fbState === "saving" ? t.saving : fbState === "saved" ? t.saved : fbState === "error" ? t.fallbackError : ""}
            </span>
          </div>
          {fbActive ? (
            <C.Input
              value={fbModel}
              disabled={fbState === "loading"}
              placeholder={fbDefault ? t.fallbackOverridePlaceholder(fbDefault) : t.fallbackModelPlaceholder}
              onChange={(e: any) => setFbModel(e.target.value)}
              onBlur={blurFallback}
              onKeyDown={(e: any) => e.key === "Enter" && blurFallback()}
            />
          ) : null}
          {fbActive ? <p className="ao-hint">{t.fallbackHint}</p> : null}
          {fbOthers.length > 0 ? <p className="ao-hint">{t.fallbackOthersHint(fbOthers.length)}</p> : null}
        </div>
      ) : fbState !== "loading" && (fbModel.trim() || fbOthers.length > 0) ? (
        <div className="ao-field">
          <p className="ao-hint">{t.fallbackOpenRouterAgentHint} {t.fallbackLeftoverHint}</p>
          <div className="ao-inline">
            <C.Button size="sm" variant="outline" onClick={removeAllFallback}>
              {t.fallbackRemove}
            </C.Button>
            <span className={"ao-save ao-save-" + (fbState === "saved" ? "saved" : fbState === "error" ? "error" : "idle")}>
              {fbState === "saving" ? t.saving : fbState === "saved" ? t.saved : fbState === "error" ? t.fallbackError : ""}
            </span>
          </div>
        </div>
      ) : null}

      <a className="ao-profile-link" href="/profiles" title={t.editProfileTitle}>
        <C.Button variant="outline" size="sm">{t.editProfile}</C.Button>
      </a>

      <C.Separator />

      <div className="ao-field">
        <C.Label>{t.tasks(myTasks.filter((x) => x.status !== "done" && x.status !== "archived").length)}</C.Label>
        <div className="ao-task-list">
          {myTasks.length === 0 ? <p className="ao-hint">{t.noTasks}</p> : null}
          {myTasks.map((x) => (
            <div key={x.id} className={"ao-task" + (x.status === "done" || x.status === "archived" ? " ao-task-done" : "")} title={x.body || x.title}>
              <span className={"ao-status ao-status-" + x.status}>{x.status}</span>
              <span className="ao-task-title">{x.title}</span>
              <button
                className="ao-task-x"
                title={t.unassign}
                onClick={async () => { await assignKanbanTask(x.id, null); onTasksChanged(); }}
              >✕</button>
            </div>
          ))}
        </div>
        <div className="ao-inline">
          <C.Input
            value={newTask}
            placeholder={t.newTask}
            onChange={(e: any) => setNewTask(e.target.value)}
            onKeyDown={(e: any) => e.key === "Enter" && addTask()}
          />
          <C.Button size="sm" disabled={!newTask.trim() || taskBusy} onClick={addTask}>+</C.Button>
        </div>
      </div>

      <C.Separator />
      {!isHidden ? (
        <C.Button
          variant="outline"
          onClick={() => { onChange(topo.hideProfile(doc, profile.name)); onClose(); }}
        >
          {t.hide}
        </C.Button>
      ) : null}

      {!profile.is_default ? (
        <div className="ao-field">
          <C.Button
            variant={confirmDelete ? "destructive" : "outline"}
            disabled={deleteBusy}
            onClick={async () => {
              if (!confirmDelete) { setConfirmDelete(true); return; }
              setDeleteBusy(true);
              try {
                await onDelete(profile.name);
              } finally {
                setDeleteBusy(false);
                setConfirmDelete(false);
              }
            }}
          >
            {deleteBusy ? "…" : confirmDelete ? t.deleteAgentConfirm : "🗑 " + t.deleteAgent}
          </C.Button>
          {confirmDelete ? <p className="ao-hint ao-error-text">{t.deleteAgentHint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
