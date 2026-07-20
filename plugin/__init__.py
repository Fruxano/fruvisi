# FruVisi agent tools: make the org chart controllable via chat (Telegram,
# Discord & every Hermes gateway). The user speaks naturally ("switch the
# FruVisi preset to project X"), the model picks the matching tool.
#
# The tools read/write the same topology.json as the dashboard (atomic via
# tmp+rename, last writer wins) and enforce the same rules: pins, cycle
# protection, explicitly designated top agent.

import json
import os
import re
import tempfile
from pathlib import Path

PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#f43f5e"]


# -- Store (identical semantics to dashboard/plugin_api.py) -------------------

def _hermes_home() -> Path:
    try:
        from hermes_cli.config import get_hermes_home  # type: ignore
        return Path(get_hermes_home())
    except Exception:
        env = os.environ.get("HERMES_HOME")
        return Path(env) if env else Path.home() / ".hermes"


def _topology_file() -> Path:
    d = _hermes_home() / "fruvisi"
    d.mkdir(parents=True, exist_ok=True)
    return d / "topology.json"


def _default_doc() -> dict:
    return {
        "version": 1,
        "activePreset": "standard",
        "presets": {
            "standard": {
                "label": "Standard",
                "departments": [],
                "groups": [],
                "nodes": {},
                "hidden": [],
                "topAgent": None,
                "showInitials": True,
            }
        },
    }


def _load() -> dict:
    f = _topology_file()
    if not f.exists():
        return _default_doc()
    doc = json.loads(f.read_text(encoding="utf-8"))
    for p in doc.get("presets", {}).values():
        p.setdefault("departments", [])
        p.setdefault("groups", [])
        p.setdefault("nodes", {})
        p.setdefault("hidden", [])
        p.setdefault("topAgent", None)
    return doc


def _save(doc: dict) -> None:
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


def _active(doc: dict) -> dict:
    return doc["presets"].setdefault(doc.get("activePreset", "standard"), _default_doc()["presets"]["standard"])


def _slugify(label: str) -> str:
    s = label.lower()
    # German umlaut transliteration on purpose — labels may be German.
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "entry"


def _node(preset: dict, profile: str) -> dict:
    return preset["nodes"].setdefault(profile, {"parent": None, "department": None, "position": None})


def _node_groups(node: dict) -> list:
    """Read group ids migration-safe (legacy field `group` -> list)."""
    if isinstance(node.get("groups"), list):
        return node["groups"]
    return [node["group"]] if node.get("group") else []


def _profile_names() -> list:
    try:
        from hermes_cli import profiles as profiles_mod  # type: ignore
        return [p.name for p in profiles_mod.list_profiles()]
    except Exception:
        return []


def _check_profile(name: str) -> str | None:
    known = _profile_names()
    if known and name not in known:
        return f"Unknown profile '{name}'. Existing profiles: {', '.join(known)}"
    return None


def _find_entry(items: list, ref: str) -> dict | None:
    ref_l = ref.strip().lower()
    for it in items:
        if it.get("id", "").lower() == ref_l or it.get("label", "").lower() == ref_l:
            return it
    return None


# -- G numbers (fixed numbers, family notation G2 / G2.1) ---------------------

def _family_root(groups: list, gid: str) -> dict | None:
    by_id = {g["id"]: g for g in groups}
    cur = by_id.get(gid)
    seen = set()
    while cur and cur.get("parent") and cur["parent"] in by_id and cur["id"] not in seen:
        seen.add(cur["id"])
        cur = by_id[cur["parent"]]
    return cur


def _smallest_free(used: list) -> int:
    """Smallest free number >= 1 — numbers of deleted groups are reused."""
    s = set(used)
    n = 1
    while n in s:
        n += 1
    return n


def _next_main_num(groups: list) -> int:
    return _smallest_free([g.get("num") or 0 for g in groups if not g.get("parent")])


def _next_sub_num(groups: list, family_id: str) -> int:
    return _smallest_free([
        g.get("num") or 0
        for g in groups
        if g.get("parent") and (_family_root(groups, g["id"]) or {}).get("id") == family_id
    ])


def _ensure_nums(groups: list) -> None:
    """Number legacy data without fixed numbers once (same as the dashboard)."""
    for g in groups:
        if not g.get("parent") and not g.get("num"):
            g["num"] = _next_main_num(groups)
    for g in groups:
        if g.get("parent") and not g.get("num"):
            root = _family_root(groups, g["id"])
            g["num"] = _next_sub_num(groups, root["id"]) if root else _next_main_num(groups)


def _notation(groups: list, g: dict) -> str:
    if not g.get("parent"):
        return f"G{g.get('num', '?')}"
    root = _family_root(groups, g["id"]) or {}
    return f"G{root.get('num', '?')}.{g.get('num', '?')}"


def _find_group(groups: list, ref: str) -> dict | None:
    """Find a group by id, name or G number ('G2', 'g2.1', '2.1')."""
    _ensure_nums(groups)
    hit = _find_entry(groups, ref)
    if hit:
        return hit
    ref_l = ref.strip().lower().lstrip("g")
    for g in groups:
        if _notation(groups, g).lower().lstrip("g") == ref_l:
            return g
    return None


def _is_ancestor(preset: dict, ancestor: str, profile: str) -> bool:
    cur = preset["nodes"].get(profile, {}).get("parent")
    seen = set()
    while cur:
        if cur == ancestor:
            return True
        if cur in seen:
            return False
        seen.add(cur)
        cur = preset["nodes"].get(cur, {}).get("parent")
    return False


# -- Tool handlers ------------------------------------------------------------

def _handle_overview(args: dict, **kw) -> str:
    doc = _load()
    p = _active(doc)
    lines = [f"FruVisi preset: {p.get('label')} (active out of {len(doc['presets'])} presets)"]
    others = [q.get("label", k) for k, q in doc["presets"].items() if k != doc.get("activePreset")]
    if others:
        lines.append("Other presets: " + ", ".join(others) + " (switch with fruvisi_switch_preset)")
    lines.append(f"Top agent: {p.get('topAgent') or '— not designated —'}")
    if p["departments"]:
        lines.append("Areas: " + ", ".join(d["label"] for d in p["departments"]))
    if p["groups"]:
        _ensure_nums(p["groups"])
        for g in p["groups"]:
            members = [k for k, v in p["nodes"].items() if g["id"] in _node_groups(v)]
            nest = f" (subgroup of {g['parent']})" if g.get("parent") else ""
            lines.append(f"Group {_notation(p['groups'], g)} '{g['label']}'{nest}: {', '.join(members) or '(empty)'}")
    hidden = set(p.get("hidden", []))
    for name, node in sorted(p["nodes"].items()):
        if name in hidden:
            continue
        parts = [f"-> reports to {node.get('parent')}" if node.get("parent") else "-> root"]
        if node.get("role"):
            parts.append(f"title: {node['role']}")
        if node.get("department"):
            dep = next((d["label"] for d in p["departments"] if d["id"] == node["department"]), node["department"])
            parts.append(f"area: {dep}")
        lines.append(f"  {name} {' · '.join(parts)}")
    if hidden:
        lines.append("Not in preset: " + ", ".join(sorted(hidden)))
    return "\n".join(lines)


def _handle_create_group(args: dict, **kw) -> str:
    label = (args.get("label") or "").strip()
    if not label:
        return "Error: 'label' is missing."
    doc = _load()
    p = _active(doc)
    gid = _slugify(label)
    if any(g["id"] == gid for g in p["groups"]):
        return f"Group '{label}' already exists."
    _ensure_nums(p["groups"])
    color = (args.get("color") or "").strip() or PALETTE[len(p["groups"]) % len(PALETTE)]
    parent_ref = (args.get("parent") or "").strip()
    parent_id = None
    if parent_ref:
        parent = _find_group(p["groups"], parent_ref)
        if not parent:
            return f"Parent group '{parent_ref}' not found. Existing: {', '.join(x['label'] for x in p['groups']) or '(none)'}"
        parent_id = parent["id"]
    # Fixed number as in the dashboard: main group G<n>, subgroup family-wide G<F>.<n>.
    if parent_id:
        root = _family_root(p["groups"] + [{"id": gid, "parent": parent_id}], gid)
        num = _next_sub_num(p["groups"], root["id"]) if root else _next_main_num(p["groups"])
    else:
        num = _next_main_num(p["groups"])
    entry = {"id": gid, "label": label, "color": color, "parent": parent_id, "num": num}
    p["groups"].append(entry)
    _save(doc)
    nr = _notation(p["groups"], entry)
    suffix = f" as a subgroup of '{parent_ref}'" if parent_id else ""
    note = "" if parent_id else f" (color {color})"
    return f"Group {nr} '{label}' created{suffix}{note}. Assign members with fruvisi_assign_group — the number ('{nr}') works too."


def _group_label(preset: dict, gid: str) -> str:
    return next((x["label"] for x in preset["groups"] if x["id"] == gid), gid)


def _handle_assign_group(args: dict, **kw) -> str:
    profile = (args.get("profile") or "").strip()
    group_ref = (args.get("group") or "").strip()
    remove = bool(args.get("remove"))
    if not profile:
        return "Error: 'profile' is missing."
    err = _check_profile(profile)
    if err:
        return err
    doc = _load()
    p = _active(doc)
    node = _node(p, profile)
    if node.get("pinned"):
        return f"'{profile}' is pinned — assignment locked until unpinned in the dashboard."
    groups = _node_groups(node)
    if remove or not group_ref or group_ref.lower() in ("none", "-"):
        node["groups"] = []
        node.pop("group", None)
        _save(doc)
        return f"'{profile}' removed from its group."
    g = _find_group(p["groups"], group_ref)
    if not g:
        return f"Group '{group_ref}' not found. Existing: {', '.join(_notation(p['groups'], x) + ' ' + x['label'] for x in p['groups']) or '(none)'} — create one with fruvisi_create_group."
    if groups == [g["id"]]:
        return f"'{profile}' is already a member of '{g['label']}'."
    # One group per agent (as in the dashboard dropdown); a previous group is
    # replaced. Subgroup membership also covers the parent group.
    previous = _group_label(p, groups[0]) if groups else None
    node["groups"] = [g["id"]]
    node.pop("group", None)
    _save(doc)
    nr = _notation(p["groups"], g)
    parent = g.get("parent")
    nest = f" (subgroup of '{_group_label(p, parent)}')" if parent else ""
    note = f" Previously: '{previous}'." if previous else ""
    return f"'{profile}' now works in group {nr} '{g['label']}'{nest}.{note}"


def _handle_create_area(args: dict, **kw) -> str:
    label = (args.get("label") or "").strip()
    if not label:
        return "Error: 'label' is missing."
    doc = _load()
    p = _active(doc)
    aid = _slugify(label)
    if any(d["id"] == aid for d in p["departments"]):
        return f"Area '{label}' already exists."
    color = (args.get("color") or "").strip() or PALETTE[len(p["departments"]) % len(PALETTE)]
    p["departments"].append({"id": aid, "label": label, "color": color})
    _save(doc)
    return f"Area '{label}' created (color {color}). Assign agents with fruvisi_assign_area."


def _handle_assign_area(args: dict, **kw) -> str:
    profile = (args.get("profile") or "").strip()
    area_ref = (args.get("area") or "").strip()
    if not profile:
        return "Error: 'profile' is missing."
    err = _check_profile(profile)
    if err:
        return err
    doc = _load()
    p = _active(doc)
    node = _node(p, profile)
    if node.get("pinned"):
        return f"'{profile}' is pinned — assignment locked."
    if not area_ref or area_ref.lower() in ("none", "-"):
        node["department"] = None
        _save(doc)
        return f"'{profile}' removed from its area."
    d = _find_entry(p["departments"], area_ref)
    if not d:
        return f"Area '{area_ref}' not found. Existing: {', '.join(x['label'] for x in p['departments']) or '(none)'} — create one with fruvisi_create_area."
    node["department"] = d["id"]
    _save(doc)
    return f"'{profile}' now belongs to area '{d['label']}'."


def _handle_set_parent(args: dict, **kw) -> str:
    profile = (args.get("profile") or "").strip()
    parent = (args.get("parent") or "").strip()
    if not profile:
        return "Error: 'profile' is missing."
    err = _check_profile(profile)
    if err:
        return err
    doc = _load()
    p = _active(doc)
    node = _node(p, profile)
    if node.get("pinned"):
        return f"'{profile}' is pinned — re-parenting locked."
    if p.get("topAgent") == profile and parent:
        return f"'{profile}' is the designated top agent — nobody stands above it. Release the role first (dashboard) or swap positions."
    if not parent or parent.lower() in ("none", "-", "root"):
        node["parent"] = None
        _save(doc)
        return f"'{profile}' is now standalone (root)."
    if parent == profile:
        return "An agent cannot report to itself."
    err = _check_profile(parent)
    if err:
        return err
    if _is_ancestor(p, profile, parent):
        return f"Not possible: '{parent}' sits below '{profile}' — that would create a cycle."
    node["parent"] = parent
    _save(doc)
    return f"'{profile}' now reports to '{parent}'."


def _handle_set_top(args: dict, **kw) -> str:
    profile = (args.get("profile") or "").strip()
    if not profile:
        return "Error: 'profile' is missing."
    if profile.lower() in ("none", "-"):
        doc = _load()
        p = _active(doc)
        previous = p.get("topAgent")
        p["topAgent"] = None
        _save(doc)
        return f"Top-agent role released{f' (previously: {previous})' if previous else ''}."
    err = _check_profile(profile)
    if err:
        return err
    doc = _load()
    p = _active(doc)
    node = _node(p, profile)
    node["parent"] = None
    p["topAgent"] = profile
    _save(doc)
    return f"'{profile}' is now the top agent of the organization."


# -- Preset switch with Hermes sync (v1.2.7) ----------------------------------
#
# Python port of the delegation export from src/lib/delegation.ts: on preset
# switch ALL profile descriptions are aligned with the active preset — members
# get their structure note, non-members (agents hidden in the preset) an
# INACTIVE marker. The kanban decomposer routes purely by descriptions; the
# marker takes the agent out of the routing. Written via the official
# write_profile_meta function (profile.yaml), no Hermes configs touched.
#
MARKER = "[FruVisi-Structure]"
# Older block markers — still recognized so existing descriptions migrate
# cleanly (old block replaced instead of duplicated).
LEGACY_MARKERS = ["[FruVisi-Struktur]"]


def _base_description(existing: str) -> str:
    """The existing description without a previous FruVisi block (any marker generation)."""
    idx = -1
    for m in [MARKER, *LEGACY_MARKERS]:
        i = existing.find(m)
        if i >= 0 and (idx < 0 or i < idx):
            idx = i
    return (existing[:idx] if idx >= 0 else existing).strip()


def _inactive_note(preset_label: str) -> str:
    return (
        f'INACTIVE — not part of the active preset "{preset_label}". '
        "Do not assign tasks to this agent."
    )


def _structure_note(p: dict, name: str) -> str:
    """Structure note of a preset member (mirror of delegation.ts)."""
    node = p["nodes"].get(name) or {}
    hidden = set(p.get("hidden", []))
    parts = []
    if node.get("role"):
        parts.append(f"Title: {node['role']}")
    if node.get("department"):
        dep = next((d["label"] for d in p["departments"] if d["id"] == node["department"]), node["department"])
        parts.append(f"Area: {dep}")
    if node.get("parent"):
        parts.append(f"Reports to: {node['parent']}")
    elif p.get("topAgent") == name:
        parts.append("Top instance of the organization")
    else:
        parts.append("No parent instance")
    subs = [k for k, v in p["nodes"].items() if k != name and v.get("parent") == name and k not in hidden]
    if subs:
        parts.append("Delegates to: " + ", ".join(subs))
    _ensure_nums(p["groups"])
    for gid in _node_groups(node):
        g = next((x for x in p["groups"] if x["id"] == gid), None)
        if not g:
            continue
        nr = _notation(p["groups"], g)
        parent_label = _group_label(p, g["parent"]) if g.get("parent") else None
        gname = (
            f'Group "{g["label"]}" ({nr}, subgroup of "{parent_label}")'
            if parent_label
            else f'Group "{g["label"]}" ({nr})'
        )
        coworkers = [k for k, v in p["nodes"].items() if k != name and gid in _node_groups(v) and k not in hidden]
        parts.append(
            f"{gname}: works in parallel with {', '.join(coworkers)} on the same matter" if coworkers else gname
        )
    return " · ".join(parts)


def _sync_profiles(doc: dict) -> tuple[int, int, int, list]:
    """Align all profile descriptions with the active preset.

    Returns (updated, members, inactive, failed_names).
    Raises RuntimeError when the Hermes profiles are not reachable.
    """
    try:
        from hermes_cli import profiles as profiles_mod
        all_profiles = profiles_mod.list_profiles()
    except Exception as exc:
        raise RuntimeError(f"Hermes profiles not reachable: {exc}")
    p = _active(doc)
    hidden = set(p.get("hidden", []))
    label = p.get("label", "?")
    updated, members, inactive, failed = 0, 0, 0, []
    for prof in all_profiles:
        member = prof.name not in hidden
        members += 1 if member else 0
        inactive += 0 if member else 1
        note = _structure_note(p, prof.name) if member else _inactive_note(label)
        existing = (prof.description or "").strip()
        base = _base_description(existing)
        next_desc = f"{base}\n{MARKER} {note}" if base else f"{MARKER} {note}"
        if next_desc == existing:
            continue
        try:
            profiles_mod.write_profile_meta(profiles_mod.get_profile_dir(prof.name), description=next_desc)
            updated += 1
        except Exception:
            failed.append(prof.name)
    return updated, members, inactive, failed


def _sync_summary(doc: dict) -> str:
    """Run the sync and summarize it as a sentence (for tool responses)."""
    try:
        updated, members, inactive, failed = _sync_profiles(doc)
    except RuntimeError as exc:
        return f"Hermes sync failed: {exc}"
    msg = f"Lineup: {members} members active, {inactive} set to INACTIVE ({updated} profile descriptions updated)."
    if failed:
        msg += f" Failed for: {', '.join(failed)}."
    return msg


def _handle_add_to_preset(args: dict, **kw) -> str:
    profile = (args.get("profile") or "").strip()
    if not profile:
        return "Error: 'profile' is missing."
    err = _check_profile(profile)
    if err:
        return err
    doc = _load()
    p = _active(doc)
    if profile not in p.get("hidden", []):
        return f"'{profile}' is already a member of preset '{p.get('label')}'."
    p["hidden"] = [h for h in p["hidden"] if h != profile]
    _node(p, profile)  # ensure the entry exists (position comes from auto layout)
    _save(doc)
    head = f"'{profile}' is now a member of preset '{p.get('label')}'."
    if doc.get("syncOnSwitch", True) is False:
        return f"{head} Hermes sync is disabled — use fruvisi_apply_structure if needed."
    return f"{head} {_sync_summary(doc)}"


def _handle_remove_from_preset(args: dict, **kw) -> str:
    profile = (args.get("profile") or "").strip()
    if not profile:
        return "Error: 'profile' is missing."
    err = _check_profile(profile)
    if err:
        return err
    doc = _load()
    p = _active(doc)
    if profile in p.get("hidden", []):
        return f"'{profile}' is already not a member of preset '{p.get('label')}'."
    node = p["nodes"].get(profile)
    if node and node.get("pinned"):
        return f"'{profile}' is pinned — unpin it in the dashboard first."
    # Same as the dashboard (hideProfile): release own assignments, free
    # subordinates, dissolve the top-agent role — re-adding then never
    # collides with a structure that changed in the meantime.
    if node:
        node["parent"] = None
        node["groups"] = []
        node.pop("group", None)
        node["position"] = None
    for k, v in p["nodes"].items():
        if k != profile and v.get("parent") == profile:
            v["parent"] = None
    if p.get("topAgent") == profile:
        p["topAgent"] = None
    p.setdefault("hidden", []).append(profile)
    _save(doc)
    head = f"'{profile}' is no longer a member of preset '{p.get('label')}'."
    if doc.get("syncOnSwitch", True) is False:
        return f"{head} Hermes sync is disabled — use fruvisi_apply_structure if needed."
    return f"{head} {_sync_summary(doc)}"


def _handle_apply_structure(args: dict, **kw) -> str:
    doc = _load()
    p = _active(doc)
    return f"Structure of preset '{p.get('label')}' applied. {_sync_summary(doc)}"


def _handle_list_presets(args: dict, **kw) -> str:
    doc = _load()
    names = _profile_names()
    lines = ["FruVisi presets:"]
    for key, p in doc["presets"].items():
        mark = " <- active" if key == doc.get("activePreset") else ""
        hidden = set(p.get("hidden", []))
        if names:
            n_members = len([n for n in names if n not in hidden])
            info = f"{n_members} members, {len(names) - n_members} not in the preset"
        else:
            info = f"{len(p.get('nodes', {}))} entries"
        lines.append(f"- {p.get('label', key)} [{key}]: {info}{mark}")
    lines.append("Switch with fruvisi_switch_preset (name or key).")
    return "\n".join(lines)


def _handle_switch_preset(args: dict, **kw) -> str:
    ref = (args.get("preset") or "").strip()
    doc = _load()
    avail = ", ".join(f"'{p.get('label', k)}'" for k, p in doc["presets"].items())
    if not ref:
        return f"Error: 'preset' is missing. Existing presets: {avail}"
    ref_l = ref.lower()
    key = next(
        (k for k, p in doc["presets"].items() if k.lower() == ref_l or (p.get("label") or "").lower() == ref_l),
        None,
    )
    if not key:
        return f"Preset '{ref}' not found. Existing presets: {avail}"
    was_active = doc.get("activePreset") == key
    doc["activePreset"] = key
    _save(doc)
    label = doc["presets"][key].get("label", key)
    head = (
        f"Preset '{label}' was already active."
        if was_active
        else f"Preset switched: '{label}' is now active."
    )
    if doc.get("syncOnSwitch", True) is False:
        return f"{head} Hermes sync is disabled in the FruVisi settings — only the view was switched."
    try:
        updated, members, inactive, failed = _sync_profiles(doc)
    except RuntimeError as exc:
        return f"{head} But: {exc}"
    parts = [head, f"Lineup: {members} members active, {inactive} set to INACTIVE ({updated} profile descriptions updated)."]
    if failed:
        parts.append(f"Failed for: {', '.join(failed)}.")
    return " ".join(parts)


# -- Registration -------------------------------------------------------------
#
# Deliberately ONLY the six operational tools (token budget: every registered
# tool travels with name/description/schema in the system prompt of EVERY
# turn). The six structural tools (create_group, assign_group, create_area,
# assign_area, set_parent, set_top_agent) are NOT registered anymore —
# structures are built in the dashboard or via a coding agent. The handlers
# above are kept: re-activation = re-add the tuple here + dashboard restart.

_TOOLS = [
    (
        "fruvisi_overview",
        "Show the current FruVisi org chart: active preset, top agent, areas, groups, reporting lines and hidden agents. Use when the user asks about the agent organization/org chart structure.",
        {"type": "object", "properties": {}, "required": []},
        _handle_overview,
        "🗂️",
    ),
    (
        "fruvisi_add_to_preset",
        "Add an agent profile to the active FruVisi preset (team lineup). Unless sync is disabled, all profile descriptions are updated immediately so the agent becomes active for kanban routing.",
        {
            "type": "object",
            "properties": {
                "profile": {"type": "string", "description": "Hermes profile name, e.g. 'dev-anna'."},
            },
            "required": ["profile"],
        },
        _handle_add_to_preset,
        "➕",
    ),
    (
        "fruvisi_remove_from_preset",
        "Remove an agent profile from the active FruVisi preset (hides it and clears its assignments; subordinates are released). Unless sync is disabled, the agent's description gets an INACTIVE marker immediately so it stops receiving kanban tasks. Pinned agents are protected.",
        {
            "type": "object",
            "properties": {
                "profile": {"type": "string", "description": "Hermes profile name, e.g. 'dev-anna'."},
            },
            "required": ["profile"],
        },
        _handle_remove_from_preset,
        "➖",
    ),
    (
        "fruvisi_apply_structure",
        "Write the active FruVisi preset into all Hermes profile descriptions NOW: members get their structure note (hierarchy, area, groups), non-members an INACTIVE marker. Use after chart changes via chat, or when sync-on-switch is disabled.",
        {"type": "object", "properties": {}, "required": []},
        _handle_apply_structure,
        "📝",
    ),
    (
        "fruvisi_list_presets",
        "List all FruVisi presets (label, key, member count) and show which one is active. Use when the user asks which presets/team lineups exist.",
        {"type": "object", "properties": {}, "required": []},
        _handle_list_presets,
        "🗂️",
    ),
    (
        "fruvisi_switch_preset",
        "Switch the active FruVisi preset (team lineup) by name or key. Unless sync is disabled in the dashboard settings, this also updates ALL Hermes profile descriptions: preset members get their structure note, all other agents an INACTIVE marker — so kanban tasks are only routed to the selected preset's cast. Use when the user wants to switch/activate a preset, project setup or team lineup.",
        {
            "type": "object",
            "properties": {
                "preset": {"type": "string", "description": "Preset name or key, e.g. 'Project X' or 'project-x'."},
            },
            "required": ["preset"],
        },
        _handle_switch_preset,
        "🔁",
    ),
]


def register(ctx) -> None:
    """Plugin entry point: register the FruVisi tools with the agent."""
    for name, description, params, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="fruvisi",
            schema={"name": name, "description": description, "parameters": params},
            handler=handler,
            description=description,
            emoji=emoji,
        )
