import { useEffect, useRef, useState } from "react";
import { C } from "../lib/sdk";
import type { TopologyDoc, Preset } from "../lib/types";
import { groupNotation } from "../lib/types";
import { useT } from "../lib/i18n";
import * as topo from "../lib/topo";

export type ApplyState = "idle" | "busy" | "error" | number;

interface PresetBarProps {
  doc: TopologyDoc;
  preset: Preset;
  /** All existing profile names — empty presets start without members. */
  profileNames: string[];
  hiddenCount: number;
  showHidden: boolean;
  saveState: "idle" | "saving" | "saved" | "error";
  applyState: ApplyState;
  onChange: (doc: TopologyDoc) => void;
  onNewAgent: () => void;
  onToggleShowHidden: (v: boolean) => void;
  onSaveNow: () => void;
  onApplyStructure: () => void;
}

/** Header: preset switcher, preset management, areas & groups, hidden agents, delegation. */
export function PresetBar({ doc, preset, profileNames, hiddenCount, showHidden, saveState, applyState, onChange, onNewAgent, onToggleShowHidden, onSaveNow, onApplyStructure }: PresetBarProps) {
  const t = useT();
  const [mode, setMode] = useState<"none" | "new" | "manage">("none");
  const [newLabel, setNewLabel] = useState("");
  const [renameLabel, setRenameLabel] = useState(preset.label);
  const [deptLabel, setDeptLabel] = useState("");
  const [deptColor, setDeptColor] = useState("#0ea5e9");
  const [groupLabel, setGroupLabel] = useState("");
  const [groupColor, setGroupColor] = useState("#8b5cf6");
  const [fbDefault, setFbDefault] = useState(doc.fallbackDefault || "");
  /** Renaming areas/groups: label-only, ids and with them all agent
   *  assignments stay untouched. */
  const [editTarget, setEditTarget] = useState<{ kind: "dept" | "group"; id: string } | null>(null);
  const [editLabel, setEditLabel] = useState("");
  /** Delete flow: pick target -> named confirmation -> visible feedback. */
  const [deleteKey, setDeleteKey] = useState(doc.activePreset);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletedMsg, setDeletedMsg] = useState<string | null>(null);
  const deletedTimer = useRef<number | null>(null);

  useEffect(() => () => { if (deletedTimer.current) window.clearTimeout(deletedTimer.current); }, []);

  const startEdit = (kind: "dept" | "group", id: string, label: string) => {
    setEditTarget({ kind, id });
    setEditLabel(label);
  };

  const commitEdit = () => {
    if (!editTarget) return;
    const label = editLabel.trim();
    if (label) {
      onChange(
        editTarget.kind === "dept"
          ? topo.renameDepartment(doc, editTarget.id, label)
          : topo.renameGroup(doc, editTarget.id, label),
      );
    }
    setEditTarget(null);
  };

  const createPreset = (duplicate: boolean) => {
    const label = newLabel.trim();
    if (!label) return;
    onChange(topo.addPreset(doc, label, duplicate, profileNames));
    setNewLabel("");
    setMode("none");
  };

  // Guard the chosen delete target (the preset might be gone by now).
  const deleteTarget = doc.presets[deleteKey] ? deleteKey : doc.activePreset;
  const deleteLabel = doc.presets[deleteTarget]?.label || deleteTarget;
  const onlyOnePreset = Object.keys(doc.presets).length <= 1;

  const doDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onChange(topo.deletePreset(doc, deleteTarget));
    setConfirmDelete(false);
    setDeleteKey(doc.activePreset === deleteTarget ? "" : doc.activePreset);
    setDeletedMsg(t.presetDeleted(deleteLabel));
    if (deletedTimer.current) window.clearTimeout(deletedTimer.current);
    deletedTimer.current = window.setTimeout(() => setDeletedMsg(null), 5000);
  };

  const applyLabel =
    applyState === "busy" ? t.applyStructureBusy
    : applyState === "error" ? t.applyStructureError
    : typeof applyState === "number" ? t.applyStructureDone(applyState)
    : t.applyStructure;

  return (
    <div className="ao-toolbar">
      <div className="ao-toolbar-left">
        <span className="ao-title">{t.presetWord}</span>
        <select
          className="ao-select ao-preset-select"
          value={doc.activePreset}
          onChange={(e) => onChange(topo.setActivePresetKey(doc, e.target.value))}
          title={t.presetSwitch}
        >
          {Object.entries(doc.presets).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
        <C.Button variant="outline" size="sm" onClick={() => setMode(mode === "new" ? "none" : "new")}>
          {t.newPreset}
        </C.Button>
        <C.Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRenameLabel(preset.label);
            setConfirmDelete(false);
            setDeletedMsg(null);
            setDeleteKey(doc.activePreset);
            setFbDefault(doc.fallbackDefault || "");
            setEditTarget(null);
            setMode(mode === "manage" ? "none" : "manage");
          }}
        >
          {t.manage}
        </C.Button>
        <C.Button size="sm" onClick={onNewAgent}>{t.newAgent}</C.Button>
        <C.Button variant="outline" size="sm" title={t.autoLayoutTitle}
          onClick={() => onChange(topo.clearPositions(doc))}>
          {t.autoLayout}
        </C.Button>
        <C.Button variant="outline" size="sm" title={t.applyStructureTitle} disabled={applyState === "busy"} onClick={onApplyStructure}>
          {applyLabel}
        </C.Button>
        {hiddenCount > 0 ? (
          <label className="ao-radio" title={t.showHiddenTitle}>
            <input type="checkbox" checked={showHidden} onChange={(e) => onToggleShowHidden(e.target.checked)} />
            {t.showHidden(hiddenCount)}
          </label>
        ) : null}
      </div>
      <div className="ao-toolbar-right">
        <span className={"ao-save ao-save-" + saveState}>
          {saveState === "saving" ? t.saving : saveState === "saved" ? t.saved : saveState === "error" ? t.saveError : ""}
        </span>
        <C.Button variant="outline" size="sm" title={t.saveTitle} onClick={onSaveNow}>
          {t.save}
        </C.Button>
      </div>

      {mode === "new" ? (
        <div className="ao-toolbar-detail">
          <C.Input
            value={newLabel}
            placeholder={t.newPresetPlaceholder}
            onChange={(e: any) => setNewLabel(e.target.value)}
          />
          <C.Button size="sm" onClick={() => createPreset(true)}>{t.duplicateCurrent}</C.Button>
          <C.Button size="sm" variant="outline" title={t.createEmptyTitle} onClick={() => createPreset(false)}>{t.createEmpty}</C.Button>
        </div>
      ) : null}

      {mode === "manage" ? (
        <div className="ao-toolbar-detail ao-manage">
          {/* -- Preset: rename & delete ----------------------------------- */}
          <div className="ao-manage-section">
            <div className="ao-manage-head">{t.sectionPreset}</div>
            <div className="ao-manage-row">
              <C.Label>{t.renamePreset}</C.Label>
              <C.Input
                value={renameLabel}
                onChange={(e: any) => setRenameLabel(e.target.value)}
                onBlur={() => renameLabel.trim() && onChange(topo.renamePreset(doc, renameLabel.trim()))}
              />
            </div>
            <div className="ao-manage-row">
              <C.Label>{t.deletePreset}</C.Label>
              <select
                className="ao-select"
                value={deleteTarget}
                title={t.deleteWhichTitle}
                disabled={onlyOnePreset}
                onChange={(e) => { setDeleteKey(e.target.value); setConfirmDelete(false); }}
              >
                {Object.entries(doc.presets).map(([key, p]) => (
                  <option key={key} value={key}>{p.label}</option>
                ))}
              </select>
              <C.Button
                size="sm"
                variant={confirmDelete ? "destructive" : "outline"}
                disabled={onlyOnePreset}
                onClick={doDelete}
              >
                {confirmDelete ? t.reallyDeleteNamed(deleteLabel) : t.deletePreset}
              </C.Button>
              {confirmDelete ? (
                <C.Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>{t.cancel}</C.Button>
              ) : null}
              {deletedMsg ? <span className="ao-feedback">{deletedMsg}</span> : null}
            </div>
            <p className="ao-hint">{onlyOnePreset ? t.lastPresetHint : t.deletePresetHint}</p>
          </div>

          {/* -- Areas ----------------------------------------------------- */}
          <div className="ao-manage-section">
            <div className="ao-manage-head">{t.departments}</div>
            {preset.departments.length > 0 ? (
              <div className="ao-depts">
                {preset.departments.map((d) =>
                  editTarget?.kind === "dept" && editTarget.id === d.id ? (
                    <span key={d.id} className="ao-editchip">
                      <C.Input
                        autoFocus
                        value={editLabel}
                        onChange={(e: any) => setEditLabel(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e: any) => {
                          if (e.key === "Enter") commitEdit();
                          if (e.key === "Escape") setEditTarget(null);
                        }}
                      />
                    </span>
                  ) : (
                    <span key={d.id} className="ao-dept-chip" style={{ borderColor: d.color, color: d.color }}>
                      {d.label}
                      <button className="ao-dept-x" title={t.renameEntityTitle} onClick={() => startEdit("dept", d.id, d.label)}>✎</button>
                      <button className="ao-dept-x" title={t.removeDepartment} onClick={() => onChange(topo.removeDepartment(doc, d.id))}>✕</button>
                    </span>
                  ),
                )}
              </div>
            ) : null}
            <div className="ao-addrow">
              <C.Input
                value={deptLabel}
                placeholder={t.newDepartment}
                onChange={(e: any) => setDeptLabel(e.target.value)}
              />
              <input
                type="color"
                className="ao-color"
                value={deptColor}
                onChange={(e) => setDeptColor(e.target.value)}
                title={t.newDepartmentColor}
              />
              <C.Button
                size="sm"
                disabled={!deptLabel.trim()}
                onClick={() => { onChange(topo.addDepartment(doc, deptLabel.trim(), deptColor)); setDeptLabel(""); }}
              >+</C.Button>
            </div>
          </div>

          {/* -- Groups ---------------------------------------------------- */}
          <div className="ao-manage-section">
            <div className="ao-manage-head">{t.groups}</div>
            {preset.groups.length > 0 ? (
              <div className="ao-group-rows">
                {preset.groups.map((g) => (
                  <div key={g.id} className="ao-group-row">
                    {editTarget?.kind === "group" && editTarget.id === g.id ? (
                      <span className="ao-editchip">
                        <C.Input
                          autoFocus
                          value={editLabel}
                          onChange={(e: any) => setEditLabel(e.target.value)}
                          onBlur={commitEdit}
                          onKeyDown={(e: any) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditTarget(null);
                          }}
                        />
                      </span>
                    ) : (
                      <span className="ao-dept-chip" style={{ borderColor: g.color, color: g.color }}>
                        ⫘ {groupNotation(preset.groups, g)} · {g.label}
                        <button className="ao-dept-x" title={t.renameEntityTitle} onClick={() => startEdit("group", g.id, g.label)}>✎</button>
                        <button className="ao-dept-x" title={t.removeGroup} onClick={() => onChange(topo.removeGroup(doc, g.id))}>✕</button>
                      </span>
                    )}
                    <select
                      className="ao-select"
                      value={g.parent || ""}
                      title={t.subgroupOf}
                      onChange={(e) => onChange(topo.setGroupParent(doc, g.id, e.target.value || null))}
                    >
                      <option value="">{t.standalone}</option>
                      {preset.groups.filter((x) => x.id !== g.id).map((x) => (
                        <option key={x.id} value={x.id}>{t.subgroupOf} {groupNotation(preset.groups, x)} · {x.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="ao-addrow">
              <C.Input
                value={groupLabel}
                placeholder={t.newGroup}
                onChange={(e: any) => setGroupLabel(e.target.value)}
              />
              <input
                type="color"
                className="ao-color"
                value={groupColor}
                onChange={(e) => setGroupColor(e.target.value)}
                title={t.newGroupColor}
              />
              <C.Button
                size="sm"
                disabled={!groupLabel.trim()}
                onClick={() => { onChange(topo.addGroup(doc, groupLabel.trim(), groupColor)); setGroupLabel(""); }}
              >+</C.Button>
            </div>
            <p className="ao-hint">{t.groupHint}</p>
          </div>

          {/* -- Display & Hermes sync ------------------------------------- */}
          <div className="ao-manage-section">
            <div className="ao-manage-head">{t.sectionDisplay}</div>
            <label className="ao-radio">
              <input
                type="checkbox"
                checked={preset.showInitials !== false}
                onChange={(e) => onChange(topo.setShowInitials(doc, e.target.checked))}
              />
              {t.showInitialsToggle}
            </label>
            <label className="ao-radio">
              <input
                type="checkbox"
                checked={doc.syncOnSwitch !== false}
                onChange={(e) => onChange(topo.setSyncOnSwitch(doc, e.target.checked))}
              />
              {t.syncOnSwitchToggle}
            </label>
            <p className="ao-hint">{t.syncOnSwitchHint}</p>
            <div className="ao-manage-row">
              <C.Label>{t.fallbackDefaultLabel}</C.Label>
              <C.Input
                value={fbDefault}
                placeholder={t.fallbackDefaultPlaceholder}
                onChange={(e: any) => setFbDefault(e.target.value)}
                onBlur={() => onChange(topo.setFallbackDefault(doc, fbDefault))}
              />
            </div>
            <p className="ao-hint">{t.fallbackDefaultHint}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
