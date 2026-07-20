# FruVisi v1.3.9 — Installation

Visual organization dashboard for Hermes Agent (Nous Research): structure
your agents as an org chart (areas, numbered groups, pins, a designated top
agent), switch whole team lineups with **functional presets** (switching
toggles the active cast in Hermes), set an OpenRouter fallback per agent,
distribute kanban tasks by drag & drop, and export the drawn structure as
a routing signal into the profile descriptions.

**Chat control** (Telegram, Discord & every Hermes gateway): the plugin
registers six operational tools (`fruvisi_overview`, `fruvisi_list_presets`,
`fruvisi_switch_preset`, `fruvisi_add_to_preset`, `fruvisi_remove_from_preset`,
`fruvisi_apply_structure`). Just talk to your bot naturally, e.g. "switch
the FruVisi preset to project X" — the model picks the tool itself. The
dashboard's rules (pins, cycle protection, top agent) apply here too.

Requirements: Hermes v0.15+ with dashboard plugin support (tested with 0.18.2).
For the fallback feature: `OPENROUTER_API_KEY` in the instance's env.

## Install via the Hermes CLI (recommended)

Hermes ships a Git-based plugin installer — one command on the server, no
package copying needed:

```bash
hermes plugins install Fruxano/fruvisi/plugin --enable
```

Then restart the dashboard (API routes and agent tools mount at startup).
Update later with `hermes plugins update fruvisi`.

**Docker** (official image): run the same command inside the container as the
Hermes user, then restart:

```bash
docker exec -u 10000 -e HOME=/opt/data <container> \
  hermes plugins install Fruxano/fruvisi/plugin --enable
docker restart <container>
```

`10000` is the Hermes UID in the official image — verify with
`docker exec <container> stat -c %u /opt/data`.

## Installer script (alternative, with backup)

Prefer a guided install that backs up your config, profiles and plugins
first — or have no GitHub access from the server? Copy this package folder
to your server (e.g. via scp), then:

```bash
sudo bash install.sh
```

The script auto-detects whether Hermes runs as a Docker container (official
image) or natively under `~/.hermes`, creates a backup, copies the plugin,
enables it and restarts the dashboard.

**Docker note:** the restart affects the whole Hermes container — the agent
is offline for a few seconds.

Afterwards: log in to the Hermes dashboard → sidebar → **Plugins → FruVisi**.

## Manual install

1. Copy the `plugin/` folder to `<HERMES_HOME>/plugins/fruvisi/`
   (Docker: `<data dir>/plugins/fruvisi/`, where the data dir is the host
   path of the `/opt/data` mount). Adjust ownership to the Hermes user
   (`chown -R <uid>:<gid>`).
2. Enable it: `hermes plugins enable fruvisi`
   (Docker: `docker exec -u <uid> -e HOME=/opt/data <container> bash -c
   'cd /opt/data && . /opt/hermes/.venv/bin/activate && hermes plugins enable fruvisi'`)
3. Restart the dashboard (Docker: `docker restart <container>`).

## Rollback / uninstall

```bash
hermes plugins remove fruvisi         # or via docker exec as above;
                                      # `disable` instead keeps the files
rm -rf <HERMES_HOME>/fruvisi          # optional: chart data
# restart the dashboard
```

FruVisi's own data lives under `<HERMES_HOME>/fruvisi/` (topology.json)
and can be deleted as well if desired. The Hermes core, profiles and
kanban are untouched by uninstalling.

## What the plugin does (transparency)

- Its **only own storage** is `<HERMES_HOME>/fruvisi/topology.json`
  (chart layout, presets). No shell calls, no reading of keys/secrets,
  no external network requests, no telemetry.
- Changes to native data happen only through official Hermes functions
  and only on user action: profile creation (wizard), profile descriptions
  ("apply structure" and the preset sync with active/INACTIVE markers),
  kanban assignments — plus, as the single config exception, the documented
  `fallback_providers` key in the respective profile's config.yaml for the
  fallback feature (written via Hermes' own load_config/save_config path).
- The frontend is fully bundled (no CDN loading).
