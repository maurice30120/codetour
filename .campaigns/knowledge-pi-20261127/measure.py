"""Summarise the campaign runs from the artifacts they left behind.

Reads, for each run: the .tour file, the creation journal entry, the Pi session
transcript, the TE ledger row and the TE knowledge events of both TE homes
(`knowledge/` and `off/`). Prints one JSON blob on stdout; nothing is written to
the repositories.
"""
import datetime
import glob
import json
import pathlib

root = pathlib.Path(__file__).resolve().parents[2]
d = pathlib.Path(__file__).resolve().parent
plan = [
    ("W1", "knowledge", "A", "high"),
    ("W2", "knowledge", "B", "off"),
    ("01", "off", "A", "off"),
    ("02", "knowledge", "A", "off"),
    ("03", "knowledge", "B", "off"),
    ("04", "off", "B", "off"),
    ("05", "knowledge", "A", "off"),
    ("06", "off", "A", "off"),
    ("07", "off", "B", "off"),
    ("08", "knowledge", "B", "off"),
]

ledger, events = {}, {}
for home in ("knowledge", "off"):
    for pi in glob.glob(str(d / home / "repos" / "*" / "pi")):
        pi = pathlib.Path(pi)
        for line in (pi / "ledger.jsonl").read_text().splitlines() if (pi / "ledger.jsonl").exists() else []:
            row = json.loads(line)
            ledger[row.get("session_id")] = row
        if (pi / "events.jsonl").exists():
            for line in (pi / "events.jsonl").read_text().splitlines():
                row = json.loads(line)
                events.setdefault(row.get("session_id"), []).append(row)

journals = {}
for base in (root / ".tours" / ".log" / "creations", root / "codetour" / ".tours" / ".log" / "creations"):
    for path in glob.glob(str(base / "*.json")):
        row = json.loads(pathlib.Path(path).read_text())
        journals.setdefault(row.get("sessionId"), []).append(row)


def stamp(value):
    if isinstance(value, (int, float)):
        return value / 1000.0 if value > 1e11 else value
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


sessions = {}
for path in glob.glob(str(d / "sessions" / "*.jsonl")):
    records = [json.loads(line) for line in open(path)]
    info = next((r for r in records if r.get("type") == "session_info"), {})
    name = (info.get("name") or "").replace("knowledge-pi-20261127-", "")
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0, "cost": 0.0}
    tools, files, prompts = {}, [], 0
    stamps = [s for s in (stamp(r.get("timestamp")) for r in records) if s]
    for r in records:
        m = r.get("message") or {}
        if not m:
            continue
        if m.get("role") == "user":
            prompts += 1
        for block in m.get("content") or []:
            if block.get("type") == "toolCall":
                tools[block.get("name")] = tools.get(block.get("name"), 0) + 1
                arg = block.get("arguments") or {}
                if block.get("name") == "read" and isinstance(arg.get("path"), str):
                    files.append(arg["path"].replace(str(root) + "/", ""))
        u = m.get("usage")
        if u:
            for k in ("input", "output", "cacheRead", "cacheWrite"):
                usage[k] += u.get(k) or 0
            usage["total"] += u.get("totalTokens") or 0
            usage["cost"] += (u.get("cost") or {}).get("total") or 0
    entry = {
        "session_id": next((r.get("id") for r in records if r.get("type") == "session"), None),
        "file": pathlib.Path(path).name,
        "messages": len(records),
        "prompts": prompts,
        "usage": usage,
        "tools": tools,
        "read_files": sorted(set(files)),
        "seconds": round(max(stamps) - min(stamps)) if stamps else None,
    }
    # Two sessions can share a display name (an aborted run): keep the productive one.
    previous = sessions.get(name)
    if previous is None or entry["usage"]["total"] > previous["usage"]["total"]:
        sessions[name] = entry

out = []
for run, mode, subject, thinking in plan:
    entry = {"run": run, "mode": mode, "subject": subject, "thinking": thinking}
    tour = None
    for candidate in (root / ".tours" / f"knowledge-pi-20261127-{run}.tour",
                      root / "codetour" / ".tours" / f"knowledge-pi-20261127-{run}.tour"):
        if candidate.exists():
            tour = candidate
            break
    if tour:
        spec = json.loads(tour.read_text())
        steps = spec.get("steps") or []
        entry["tour"] = {
            "path": str(tour.relative_to(root)),
            "title": spec.get("title"),
            "steps": len(steps),
            "anchored": sum(1 for s in steps if s.get("file") and (s.get("pattern") or s.get("line") or s.get("uri"))),
            "files": sorted({s.get("file") for s in steps if s.get("file")}),
            "questions": sum(len(s.get("questions") or []) for s in steps),
        }
    session = sessions.get(run)
    entry["session"] = session
    if session:
        row = ledger.get(session["session_id"]) or {}
        entry["ledger"] = {k: row.get(k) for k in ("input_tokens", "output_tokens",
                                                   "cache_read_input_tokens", "effective_tokens",
                                                   "requests", "prompts", "overhead")}
        injected = events.get(session["session_id"], [])
        entry["knowledge"] = {
            "injections": len(injected),
            "triggers": sorted({i.get("trigger") for i in injected}),
            "ids": [i.get("knowledge_id") for i in injected],
            "signals": [i.get("signal") for i in injected],
        }
        entry["journal"] = [{k: j.get(k) for k in ("workspace", "tourPath", "tourTitle")}
                            for j in journals.get(session["session_id"], [])]
    else:
        entry["ledger"] = None
        entry["knowledge"] = None
        entry["journal"] = []
    out.append(entry)

print(json.dumps(out, indent=1, ensure_ascii=False))
