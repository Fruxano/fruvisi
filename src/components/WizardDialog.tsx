import { useEffect, useMemo, useState } from "react";
import { C } from "../lib/sdk";
import type { HermesProfile, Preset, TopologyDoc } from "../lib/types";
import { groupTree, groupNotation } from "../lib/types";
import { createProfile, setProfileModel, setProfileFallback, getModelProviders, getMoaPresetNames, type ModelProvider } from "../lib/api";
import { useT } from "../lib/i18n";
import * as topo from "../lib/topo";

type ModelMode = "fixed" | "moa";

interface WizardProps {
  profiles: HermesProfile[];
  preset: Preset;
  doc: TopologyDoc;
  onChange: (doc: TopologyDoc) => void;
  onCreated: (name: string) => void;
  onClose: () => void;
}

/** Free spelling for the input field (capitals allowed) — the card shows it
 *  as the display name. Hermes itself enforces lowercase profile names
 *  (verified: the server turns 'Test-Upper' into 'test-upper'). */
function sanitizeDisplay(v: string): string {
  return v.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
}

/** Technical profile name: lowercase as Hermes requires. */
function profileIdOf(display: string): string {
  return display.toLowerCase();
}

/** Wizard: creates a native Hermes profile and places it in the org chart. */
export function WizardDialog({ profiles, preset, doc, onChange, onCreated, onClose }: WizardProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");
  const [group, setGroup] = useState("");
  const [parent, setParent] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("fixed");
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [providerSlug, setProviderSlug] = useState("");
  const [model, setModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [moaPresets, setMoaPresets] = useState<string[]>([]);
  const [moaPreset, setMoaPreset] = useState("");
  const [noSkills, setNoSkills] = useState(false);
  const [fbEnabled, setFbEnabled] = useState(false);
  const [fbModel, setFbModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getModelProviders()
      .then((p) => setProviders(p.filter((x) => x.slug !== "moa")))
      .catch(() => setProviders([]));
    getMoaPresetNames()
      .then((names) => { setMoaPresets(names); if (names.length) setMoaPreset(names[0]); })
      .catch(() => setMoaPresets([]));
  }, []);

  const providerModels = useMemo(
    () => providers.find((p) => p.slug === providerSlug)?.models || [],
    [providers, providerSlug],
  );

  const hidden = new Set(preset.hidden || []);
  const parentOptions = profiles.filter((p) => !hidden.has(p.name));
  const profileId = profileIdOf(name);
  const nameTaken = profiles.some((p) => p.name === profileId);
  const effectiveModel = customModel.trim() || model;
  /** If the new agent itself runs on OpenRouter, an OpenRouter fallback is
   *  pointless (same credits, same outage) — hide the option. */
  const isOpenRouterMain = modelMode === "fixed" && providerSlug === "openrouter";
  const fbDefault = (doc.fallbackDefault || "").trim();
  const effectiveFbModel = fbModel.trim() || fbDefault;
  const canSubmit =
    !!profileId && !nameTaken && !busy &&
    (modelMode !== "fixed" || !!effectiveModel) &&
    (modelMode !== "moa" || !!moaPreset) &&
    (isOpenRouterMain || !fbEnabled || !!effectiveFbModel);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createProfile({
        name: profileId,
        description: description.trim() || role.trim() || undefined,
        no_skills: noSkills,
      });
      if (modelMode === "fixed") {
        await setProfileModel(profileId, providerSlug || "auto", effectiveModel);
      } else {
        await setProfileModel(profileId, "moa", moaPreset);
      }
      if (!isOpenRouterMain && fbEnabled && effectiveFbModel) {
        await setProfileFallback(profileId, [{ provider: "openrouter", model: effectiveFbModel }]);
      }
      let next = doc;
      next = topo.setParent(next, profileId, parent || null);
      next = topo.setDepartment(next, profileId, department || null);
      next = topo.setGroup(next, profileId, group || null);
      if (role.trim()) next = topo.setRole(next, profileId, role.trim());
      // Adopt the free spelling as display name (only when it differs)
      if (name !== profileId) next = topo.setDisplayName(next, profileId, name);
      onChange(next);
      onCreated(profileId);
    } catch (err: any) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  return (
    <div className="ao-modal-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="ao-modal">
        <div className="ao-panel-head">
          <span className="ao-panel-title">{t.wizardTitle}</span>
          <C.Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>✕</C.Button>
        </div>

        <div className="ao-field">
          <C.Label>{t.profileName}</C.Label>
          <C.Input
            value={name}
            placeholder="z.B. Dev-Clara"
            onChange={(e: any) => setName(sanitizeDisplay(e.target.value))}
          />
          {nameTaken ? <p className="ao-hint ao-error-text">{t.profileExists}</p> : null}
          {!nameTaken && name && name !== profileId ? (
            <p className="ao-hint">{t.profileIdHint(profileId)}</p>
          ) : null}
        </div>

        <div className="ao-grid-2">
          <div className="ao-field">
            <C.Label>{t.chartTitle}</C.Label>
            <C.Input value={role} placeholder={t.chartTitlePlaceholder} onChange={(e: any) => setRole(e.target.value)} />
          </div>
          <div className="ao-field">
            <C.Label>{t.department}</C.Label>
            <select className="ao-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">{t.noneM}</option>
              {preset.departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>

        <div className="ao-field">
          <C.Label>{t.profileDescription}</C.Label>
          <C.Input
            value={description}
            placeholder={t.profileDescriptionPlaceholder}
            onChange={(e: any) => setDescription(e.target.value)}
          />
        </div>

        <div className="ao-grid-2">
          <div className="ao-field">
            <C.Label>{t.parentAgent}</C.Label>
            <select className="ao-select" value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t.noParentOption}</option>
              {parentOptions.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </div>
          <div className="ao-field">
            <C.Label>{t.group}</C.Label>
            <select className="ao-select" value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">{t.noneF}</option>
              {groupTree(preset.groups).map(({ group: g, depth }) => (
                <option key={g.id} value={g.id}>
                  {"   ".repeat(depth) + (depth > 0 ? "↳ " : "") + groupNotation(preset.groups, g) + " · " + g.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="ao-field">
          <C.Label>{t.modelLabel}</C.Label>
          <div className="ao-radio-row">
            <label className="ao-radio"><input type="radio" checked={modelMode === "fixed"} onChange={() => setModelMode("fixed")} /> {t.fixedModel}</label>
            <label className="ao-radio"><input type="radio" checked={modelMode === "moa"} onChange={() => setModelMode("moa")} /> {t.moaPreset}</label>
          </div>
          {modelMode === "fixed" ? (
            <div className="ao-model-pick">
              <select className="ao-select" value={providerSlug} onChange={(e) => { setProviderSlug(e.target.value); setModel(""); }}>
                <option value="">{t.providerAuto}</option>
                {providers.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
              </select>
              {providerModels.length > 0 ? (
                <select className="ao-select" value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">{t.chooseModel}</option>
                  {providerModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : null}
              <C.Input
                value={customModel}
                placeholder={t.customModelPlaceholder}
                onChange={(e: any) => setCustomModel(e.target.value)}
              />
            </div>
          ) : null}
          {modelMode === "moa" ? (
            moaPresets.length > 0 ? (
              <select className="ao-select" value={moaPreset} onChange={(e) => setMoaPreset(e.target.value)}>
                {moaPresets.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : <p className="ao-hint">{t.noMoaPresets}</p>
          ) : null}
        </div>

        {!isOpenRouterMain ? (
          <div className="ao-field">
            <label className="ao-radio">
              <input type="checkbox" checked={fbEnabled} onChange={(e) => setFbEnabled(e.target.checked)} />
              {fbDefault ? t.fallbackWizardToggleDefault(fbDefault) : t.fallbackWizardToggle}
            </label>
            {fbEnabled ? (
              <>
                <C.Input
                  value={fbModel}
                  placeholder={fbDefault ? t.fallbackOverridePlaceholder(fbDefault) : t.fallbackModelPlaceholder}
                  onChange={(e: any) => setFbModel(e.target.value)}
                />
                <p className="ao-hint">{t.fallbackHint}</p>
              </>
            ) : null}
          </div>
        ) : null}

        <label className="ao-radio">
          <input type="checkbox" checked={noSkills} onChange={(e) => setNoSkills(e.target.checked)} />
          {t.noSkills}
        </label>

        {error ? <p className="ao-error-text">{t.errorPrefix} {error}</p> : null}

        <div className="ao-modal-actions">
          <C.Button variant="outline" disabled={busy} onClick={onClose}>{t.cancel}</C.Button>
          <C.Button disabled={!canSubmit} onClick={submit}>{busy ? t.creating : t.createAgent}</C.Button>
        </div>
      </div>
    </div>
  );
}
