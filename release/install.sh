#!/usr/bin/env bash
# FruVisi installer — installs the dashboard plugin into an existing Hermes
# instance (Docker container from the official image OR a native install
# under ~/.hermes). Run as root or with Docker privileges:
#
#   sudo bash install.sh
#
# What the script does:
#   1. Find Hermes (Docker container or ~/.hermes)
#   2. Back up config.yaml, profiles/ and plugins/
#   3. Copy the plugin to <HERMES_HOME>/plugins/fruvisi
#   4. Enable the plugin (hermes plugins enable fruvisi)
#   5. Restart the dashboard (Docker: brief container restart!)
#   6. Verify the installation
#
# Rollback: see INSTALL.md (delete the folder, disable the plugin, restart).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$HERE/plugin"
# Repo layout: install.sh lives in release/, plugin/ one level up.
[ -f "$PLUGIN_SRC/plugin.yaml" ] || PLUGIN_SRC="$HERE/../plugin"

fail() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

[ -f "$PLUGIN_SRC/plugin.yaml" ] || fail "Plugin source not found (expected: plugin/ next to install.sh or in the repo root). Run the script from the package folder or a repo clone."

# -- 1. Find Hermes -----------------------------------------------------------
CONTAINER=""
if command -v docker >/dev/null 2>&1; then
  CONTAINER="$(docker ps --format '{{.Names}}\t{{.Image}}' | awk -F'\t' '$2 ~ /hermes-agent/ {print $1; exit}')"
fi

if [ -n "$CONTAINER" ]; then
  info "Hermes Docker container found: $CONTAINER"
  DATA_DIR="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Source}}{{end}}{{end}}' "$CONTAINER")"
  [ -n "$DATA_DIR" ] && [ -d "$DATA_DIR" ] || fail "Container data folder not found (mount /opt/data)."
  info "Hermes data folder: $DATA_DIR"
else
  DATA_DIR="$HOME/.hermes"
  [ -d "$DATA_DIR" ] || fail "Neither a Hermes Docker container nor $DATA_DIR found."
  info "Native Hermes install: $DATA_DIR"
fi

# -- 2. Backup ----------------------------------------------------------------
BK="/root/backups/fruvisi-install-$(date +%Y%m%d-%H%M%S).tar.gz"
mkdir -p "$(dirname "$BK")" 2>/dev/null || BK="$HOME/fruvisi-install-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BK" -C "$DATA_DIR" $(cd "$DATA_DIR" && ls -d config.yaml profiles plugins 2>/dev/null) 2>/dev/null || true
[ -f "$BK" ] && info "Backup created: $BK" || info "Note: backup skipped (nothing to back up found)."

# -- 3. Copy the plugin -------------------------------------------------------
DEST="$DATA_DIR/plugins/fruvisi"
if [ -d "$DEST" ]; then
  info "Existing FruVisi installation found — updating it."
  rm -rf "$DEST"
fi
mkdir -p "$DATA_DIR/plugins"
cp -r "$PLUGIN_SRC" "$DEST"
if [ -n "$CONTAINER" ]; then
  # Set ownership container-side: the UID of the Hermes user inside the
  # container is authoritative, not the host UID (avoids mismatches e.g.
  # on NFS/Windows).
  CUID="$(docker exec "$CONTAINER" stat -c %u /opt/data)"
  CGID="$(docker exec "$CONTAINER" stat -c %g /opt/data)"
  docker exec -u 0 "$CONTAINER" chown -R "$CUID:$CGID" /opt/data/plugins/fruvisi 2>/dev/null || true
else
  chown -R "$(stat -c %u "$DATA_DIR"):$(stat -c %g "$DATA_DIR")" "$DEST" 2>/dev/null || true
fi
info "Plugin copied to: $DEST"

# -- 4. Enable ----------------------------------------------------------------
if [ -n "$CONTAINER" ]; then
  docker exec -u "$CUID" -e HOME=/opt/data "$CONTAINER" \
    bash -c 'cd /opt/data && . /opt/hermes/.venv/bin/activate && hermes plugins enable fruvisi' \
    >/dev/null 2>&1 || fail "Enabling inside the container failed (hermes plugins enable fruvisi)."
else
  hermes plugins enable fruvisi >/dev/null 2>&1 || fail "Enabling failed (is 'hermes' on PATH?)."
fi
info "Plugin enabled (plugins.enabled: fruvisi)."

# -- 5. Restart the dashboard -------------------------------------------------
if [ -n "$CONTAINER" ]; then
  info "Restarting the container (Hermes is offline for a few seconds)…"
  docker restart "$CONTAINER" >/dev/null
  sleep 20
else
  echo ""
  echo "  Please restart the dashboard once (e.g. 'hermes dashboard' or the"
  echo "  systemd service) so the backend routes are loaded."
  echo ""
fi

# -- 6. Verify ----------------------------------------------------------------
if [ -n "$CONTAINER" ]; then
  if grep -q "Mounted plugin API routes: /api/plugins/fruvisi/" "$DATA_DIR/logs/gui.log" 2>/dev/null; then
    info "Verified: FruVisi routes are mounted."
  else
    info "Note: mount log line not found (yet) — the dashboard may need a few seconds."
  fi
fi

echo ""
echo "✔ FruVisi is installed."
echo "  Log in to the Hermes dashboard → sidebar → Plugins → FruVisi."
echo "  Backup for emergencies: $BK"
