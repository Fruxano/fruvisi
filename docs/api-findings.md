# Hermes API notes (verified against Hermes 0.18.2)

Findings from building FruVisi, verified against a running instance
(dev container `hermes-org-dev`, image `v2026.7.7.2` = app version 0.18.2).

## Formerly open questions (both resolved)

- MoA presets: names come from `GET /api/model/moa` (keys of `presets`) — the wizard uses exactly that.
- `POST /api/profiles`: schema `{name, description?, no_skills?, clone_from?}` — used by the wizard in production.

## Findings

### Plugin system (verified against the instance)

- **The plugin root needs a `plugin.yaml`** (`name`, `version`, `description`), otherwise the CLI/`hermes plugins enable` does not know the plugin (`hermes_cli/plugins_cmd.py: _read_manifest_info`). The dashboard part lives in `<root>/dashboard/` (manifest.json, dist/, plugin_api.py).
- **User plugins are gated** (security fix #46435): they only appear in `/api/dashboard/plugins` once they are listed in `config.yaml → plugins.enabled`. Enable via `hermes plugins enable fruvisi` (writes `plugins.enabled` + `plugins.entries.fruvisi.allow_tool_override: false`).
- **Backend routes are only mounted at dashboard startup** → after enabling or changing `plugin_api.py`, restart once. UI-only changes are picked up by an authenticated `GET /api/dashboard/plugins/rescan`.
- **Nav grouping:** the dashboard automatically sorts ALL plugin tabs into the sidebar section "Plugins". `tab.position` only controls the order within the section. No extra configuration needed.
- **Auth (0.18.2, June 2026 hardening):** no unauthenticated public bind anymore; `--insecure`/`HERMES_DASHBOARD_INSECURE` is ignored. The Docker image starts the dashboard as an s6 service (`HOME=/opt/data`, user `hermes`, `HERMES_HOME=/opt/data`); basic auth via `config.yaml → dashboard.basic_auth.username + password_hash` (hash: `python -c "from plugins.dashboard_auth.basic import hash_password; ..."` inside `/opt/hermes`).
- **Login API for scripts/curl:** `POST /auth/password-login` with `{"provider":"basic","username":...,"password":...}` → session cookie. `GET /api/dashboard/plugins` is public but only lists bundled plugins without a cookie.
- Assets: `GET /dashboard-plugins/fruvisi/dist/index.js` (after enabling). Plugin API: `/api/plugins/fruvisi/*`.

### Profile API (code inspection `web_server.py`, Hermes 0.18.2)

A complete REST API exists — **the wizard can create profiles natively:**

- `GET /api/profiles` — list; `POST /api/profiles` — **create**
- `GET/POST /api/profiles/active` — active profile
- `PUT /api/profiles/{name}/model`, `/description`, `/soul` — set fields
- `POST /api/profiles/{name}/describe-auto`, `GET /api/profiles/{name}/setup-command`
- `DELETE /api/profiles/{name}`
- `GET /api/profiles/sessions`

### Kanban API (official docs, verified against the instance)

Bundled plugin `plugins/kanban/`, activated via `hermes kanban init` (creates `~/.hermes/kanban.db`).
All endpoints under `/api/plugins/kanban/`:

- `GET /board?tenant=<name>` — board grouped by status columns
- `GET /tasks/:id`, `POST /tasks`, `PATCH /tasks/:id` (status/assignee/priority), `POST /tasks/bulk`
- `POST /tasks/:id/comments`, `/specify`, `/decompose`
- `GET /profiles` — **installed profiles with descriptions**
- `POST /links`, `DELETE /links?parent_id=&child_id=` — dependencies
- `GET /workers/active` — running workers
- `WS /events?since=<event_id>&token=<session-token>` — live updates

Task fields: `title, body, assignee (= profile name), status (triage|todo|ready|running|blocked|done|archived), priority, tenant, workspace, parent_ids, scheduled_at, goal_mode, task_runs, task_events`.

→ The native API is fully sufficient for task assignment: `PATCH /tasks/:id {assignee}`. No separate task store needed (confirmed).

**Verified pitfalls:**
- `PATCH /tasks/:id` ignores `null` fields (`if payload.assignee is not None`). **Removing an assignment = `{"assignee": ""}`** (empty string → `payload.assignee or None`).
- Run `hermes kanban init` inside the Docker container **as the `hermes` user** (`docker exec -u hermes -e HOME=/opt/data …`) — a `kanban.db*` created as root causes `Permission denied` on the lock file.
- Restart the dashboard once after `kanban init`: the kanban API routes need the DB at mount time, otherwise all `/api/plugins/kanban/*` routes return 500.
