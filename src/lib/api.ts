import { SDK } from "./sdk";
import { normalizeDoc, type HermesProfile, type TopologyDoc } from "./types";

const BASE = "/api/plugins/fruvisi";

export async function getProfiles(): Promise<HermesProfile[]> {
  const res = await SDK.api.getProfiles();
  return (res && res.profiles) || [];
}

export async function getTopology(): Promise<TopologyDoc> {
  const doc = await SDK.fetchJSON(`${BASE}/topology`);
  return normalizeDoc(doc);
}

export async function putTopology(doc: TopologyDoc): Promise<TopologyDoc> {
  return SDK.fetchJSON(`${BASE}/topology`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
}

export interface CreateProfileBody {
  name: string;
  description?: string;
  no_skills?: boolean;
  clone_from?: string | null;
}

export async function createProfile(body: CreateProfileBody): Promise<{ ok: boolean; name: string }> {
  return SDK.fetchJSON("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteProfile(name: string): Promise<any> {
  return SDK.fetchJSON(`/api/profiles/${encodeURIComponent(name)}`, { method: "DELETE" });
}

export async function setProfileModel(name: string, provider: string, model: string): Promise<any> {
  return SDK.fetchJSON(`/api/profiles/${encodeURIComponent(name)}/model`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model }),
  });
}

// -- Per-profile fallback (FruVisi backend, v1.3.0) --
// Hermes chain `fallback_providers` in the profile config.yaml: kicks in on
// rate limits/overload/connection errors. The UI manages one OpenRouter
// entry; foreign (e.g. hand-maintained) entries are preserved.

export interface FallbackEntry {
  provider: string;
  model: string;
  base_url?: string;
  api_mode?: string;
}

export interface FallbackStatus {
  provider: string;
  model: string;
  entries: number;
}

/** Fallback status of all profiles in one call (card badges). */
export async function getAllFallbacks(): Promise<Record<string, FallbackStatus>> {
  const res = await SDK.fetchJSON(`${BASE}/fallbacks`);
  return (res && res.fallbacks) || {};
}

export async function getProfileFallback(name: string): Promise<FallbackEntry[]> {
  const res = await SDK.fetchJSON(`${BASE}/profiles/${encodeURIComponent(name)}/fallback`);
  return (res && res.entries) || [];
}

export async function setProfileFallback(name: string, entries: FallbackEntry[]): Promise<any> {
  return SDK.fetchJSON(`${BASE}/profiles/${encodeURIComponent(name)}/fallback`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

export interface ModelProvider {
  slug: string;
  name: string;
  models: string[];
  authenticated?: boolean;
}

export async function getModelProviders(): Promise<ModelProvider[]> {
  const res = await SDK.fetchJSON("/api/model/options");
  return (res && res.providers) || [];
}

export async function getMoaPresetNames(): Promise<string[]> {
  const res = await SDK.fetchJSON("/api/model/moa");
  return Object.keys((res && res.presets) || {});
}

// -- Native kanban (/api/plugins/kanban/) — read/assign only, no own task store --

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: string;
  priority: number;
}

export async function getKanbanTasks(): Promise<KanbanTask[]> {
  const res = await SDK.fetchJSON("/api/plugins/kanban/board");
  const cols = (res && res.columns) || [];
  const tasks: KanbanTask[] = [];
  for (const col of cols) for (const t of col.tasks || []) tasks.push(t);
  return tasks;
}

export async function assignKanbanTask(id: string, assignee: string | null): Promise<any> {
  // The kanban PATCH ignores null fields; an empty string means "remove assignment"
  // (plugin_api.py: `payload.assignee or None`).
  return SDK.fetchJSON(`/api/plugins/kanban/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assignee: assignee ?? "" }),
  });
}

export async function createKanbanTask(title: string, assignee: string | null): Promise<any> {
  return SDK.fetchJSON("/api/plugins/kanban/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(assignee ? { title, assignee } : { title }),
  });
}
