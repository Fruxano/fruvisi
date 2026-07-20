"""FruVisi backend: topology/preset store under $HERMES_HOME/fruvisi/.

Its own write surface is topology.json (atomic via tmp+rename).
ONE deliberate, narrowly scoped exception since v1.3.0: the fallback routes
set exclusively the documented ``fallback_providers`` key in the respective
profile's config.yaml — via Hermes' official write path (load_config/
save_config + HERMES_HOME override), the same one the native endpoint
PUT /api/profiles/{name}/model uses. All other Hermes configs stay untouched.
"""

import json
import os
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

router = APIRouter()


def _hermes_home() -> Path:
    try:
        from hermes_cli.config import get_hermes_home  # type: ignore
        return Path(get_hermes_home())
    except Exception:
        env = os.environ.get("HERMES_HOME")
        return Path(env) if env else Path.home() / ".hermes"


def _data_dir() -> Path:
    d = _hermes_home() / "fruvisi"
    legacy = _hermes_home() / "agent-org"
    if not d.exists() and legacy.exists():
        # One-time migration from the old plugin name agent-org.
        legacy.rename(d)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _topology_file() -> Path:
    return _data_dir() / "topology.json"


DEFAULT_DOC = {
    "version": 1,
    "activePreset": "standard",
    "presets": {
        "standard": {
            "label": "Standard",
            "departments": [],
            "nodes": {},
            "hidden": [],
        }
    },
}


class TopologyBody(BaseModel):
    version: int
    activePreset: str
    presets: dict
    # Switching presets syncs active/inactive into the profile descriptions
    # (v1.2.6). Without this field pydantic would drop the setting on PUT.
    syncOnSwitch: bool = True
    # Default fallback model (v1.3.1), e.g. "@preset/glm-novita".
    fallbackDefault: Optional[str] = None


@router.get("/ping")
async def ping():
    return {"ok": True, "plugin": "fruvisi"}


@router.get("/topology")
async def get_topology():
    f = _topology_file()
    if not f.exists():
        return DEFAULT_DOC
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"topology.json unreadable: {exc}")


# -- Per-profile fallback (v1.3.0) --------------------------------------------
#
# Hermes' fallback chain (``fallback_providers``: list of {provider, model,
# base_url?, api_mode?}) kicks in on rate limits (429), overload (529),
# service errors (503) and connection failures — per profile, because every
# profile has its own config.yaml. There is no native REST API for it (only
# the interactive ``hermes fallback`` CLI), hence these plugin routes.


class FallbackEntry(BaseModel):
    # extra="allow": hand-maintained chain entries may carry further Hermes
    # fields (e.g. ``key_env`` for custom endpoints) — those must not be
    # dropped silently when passing them through (v1.3.2).
    model_config = ConfigDict(extra="allow")

    provider: str
    model: str
    base_url: Optional[str] = None
    api_mode: Optional[str] = None


class FallbackBody(BaseModel):
    entries: List[FallbackEntry]


def _profile_dir(name: str) -> Path:
    try:
        from hermes_cli import profiles as profiles_mod  # type: ignore
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"hermes_cli not available: {exc}")
    canon = profiles_mod.normalize_profile_name(name)
    if not profiles_mod.profile_exists(canon):
        raise HTTPException(status_code=404, detail=f"profile '{name}' does not exist")
    return profiles_mod.get_profile_dir(canon)


@router.get("/fallbacks")
async def get_all_fallbacks():
    """Fallback status of ALL profiles in one call (for the card badges).

    Returns only profiles with a non-empty chain: {name: {provider, model, entries}}.
    """
    try:
        from hermes_cli import profiles as profiles_mod  # type: ignore
        all_profiles = profiles_mod.list_profiles()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"hermes_cli not available: {exc}")
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override  # type: ignore
    from hermes_cli.config import load_config  # type: ignore
    from hermes_cli.fallback_config import get_fallback_chain  # type: ignore
    out = {}
    for p in all_profiles:
        token = set_hermes_home_override(str(p.path))
        try:
            chain = get_fallback_chain(load_config())
        except Exception:
            chain = []
        finally:
            reset_hermes_home_override(token)
        if chain:
            out[p.name] = {
                "provider": chain[0].get("provider"),
                "model": chain[0].get("model"),
                "entries": len(chain),
            }
    return {"fallbacks": out}


@router.get("/profiles/{name}/fallback")
async def get_profile_fallback(name: str):
    """Effective fallback chain of a profile (incl. the legacy ``fallback_model`` format)."""
    profile_dir = _profile_dir(name)
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override  # type: ignore
    from hermes_cli.config import load_config  # type: ignore
    from hermes_cli.fallback_config import get_fallback_chain  # type: ignore
    token = set_hermes_home_override(str(profile_dir))
    try:
        chain = get_fallback_chain(load_config())
    finally:
        reset_hermes_home_override(token)
    return {"entries": chain}


@router.put("/profiles/{name}/fallback")
async def put_profile_fallback(name: str, body: FallbackBody):
    """Set a profile's fallback chain (empty list = fallback off).

    Writes ONLY ``fallback_providers`` and clears the legacy
    ``fallback_model`` key (the given list is the whole chain —
    same migration direction as ``hermes fallback add``).
    """
    if len(body.entries) > 5:
        raise HTTPException(status_code=422, detail="at most 5 fallback entries")
    entries = []
    for e in body.entries:
        raw = e.model_dump(exclude_none=True)
        provider = str(raw.get("provider") or "").strip()
        model = str(raw.get("model") or "").strip()
        if not provider or not model:
            raise HTTPException(status_code=422, detail="provider and model are required")
        # Carry unknown extra fields (key_env etc.) through unchanged.
        entry = {k: v for k, v in raw.items() if k not in ("provider", "model", "base_url", "api_mode")}
        entry["provider"] = provider
        entry["model"] = model
        base_url = str(raw.get("base_url") or "").strip()
        if base_url:
            entry["base_url"] = base_url.rstrip("/")
        api_mode = str(raw.get("api_mode") or "").strip()
        if api_mode:
            entry["api_mode"] = api_mode
        entries.append(entry)
    profile_dir = _profile_dir(name)
    from hermes_constants import set_hermes_home_override, reset_hermes_home_override  # type: ignore
    from hermes_cli.config import load_config, save_config  # type: ignore
    token = set_hermes_home_override(str(profile_dir))
    try:
        cfg = load_config()
        if entries:
            cfg["fallback_providers"] = entries
        else:
            cfg.pop("fallback_providers", None)
        cfg.pop("fallback_model", None)
        save_config(cfg)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"config.yaml not writable: {exc}")
    finally:
        reset_hermes_home_override(token)
    return {"ok": True, "entries": entries}


@router.put("/topology")
async def put_topology(body: TopologyBody):
    if body.activePreset not in body.presets:
        raise HTTPException(status_code=422, detail="activePreset does not exist in presets")
    doc = body.model_dump()
    f = _topology_file()
    fd, tmp = tempfile.mkstemp(dir=str(f.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, f)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return doc
