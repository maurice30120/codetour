"""The control run's measurement: does the shell path now receive a card?

Reads the two control runs (A-off, A-knowledge) from their artifacts -- the Pi transcripts, the
fresh TE homes (`off-A/`, `knowledge-A/`), the session states and the Tours -- and prints one
JSON blob comparing them with the 27 November campaign's pairs. Nothing is written anywhere.
The earlier numbers are copied verbatim from `rapport-campagne-knowledge-pi-20261127.md` (workspace root).
"""
import glob
import json
import pathlib

root = pathlib.Path(__file__).resolve().parents[2]
d = pathlib.Path(__file__).resolve().parent

# From the campaign report's table: run -> (mode, subject, input, output, cache_read, eff_te,
# requests, read/bash, injections, tour)
EARLIER = {
    "W1": ("knowledge", "A", 16457, 4545, 179072, 61634, 14, "10/9", 0, ".tours/knowledge-pi-20261127-W1.tour"),
    "W2": ("knowledge", "B", 28387, 4422, 208128, 75732, 12, "7/11", 2, ".tours/knowledge-pi-20261127-W2.tour"),
    "01": ("off", "A", 34368, 5191, 466432, 112157, 22, "3/19", 0, ".tours/knowledge-pi-20261127-01.tour"),
    "02": ("knowledge", "A", 15441, 5206, 265344, 73211, 17, "12/15", 3, "codetour/.tours/knowledge-pi-20261127-02.tour"),
    "03": ("knowledge", "B", 19630, 2933, 194176, 56646, 11, "3/11", 2, ".tours/knowledge-pi-20261127-03.tour"),
    "04": ("off", "B", 37894, 7821, 497024, 134522, 19, "6/20", 0, "codetour/.tours/knowledge-pi-20261127-04.tour"),
    "05": ("knowledge", "A", 14654, 4538, 286720, 70554, 18, "6/18", 4, "codetour/.tours/knowledge-pi-20261127-05.tour"),
    "06": ("off", "A", 14624, 4768, 257280, 68960, 17, "8/12", 0, ".tours/knowledge-pi-20261127-06.tour"),
    "07": ("off", "B", 23546, 3706, 355072, 81289, 19, "2/16", 0, "codetour/.tours/knowledge-pi-20261127-07.tour"),
    "08": ("knowledge", "B", 25217, 4124, 415744, 91535, 19, "4/16", 2, ".tours/knowledge-pi-20261127-08.tour"),
}

PLAN = [("A-off", "off", "A", "off-A"), ("A-knowledge", "knowledge", "A", "knowledge-A")]


def stamp(value):
    if isinstance(value, (int, float)):
        return value / 1000.0 if value > 1e11 else value
    try:
        import datetime
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def session_record(path):
    records = [json.loads(line) for line in open(path)]
    info = next((r for r in records if r.get("type") == "session_info"), {})
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0, "cost": 0.0}
    tools, files, calls = {}, [], {}
    stamps = [s for s in (stamp(r.get("timestamp")) for r in records) if s]
    for r in records:
        m = r.get("message") or {}
        for block in m.get("content") or []:
            if block.get("type") == "toolCall":
                tools[block.get("name")] = tools.get(block.get("name"), 0) + 1
                arg = block.get("arguments") or {}
                if block.get("name") == "read" and isinstance(arg.get("path"), str):
                    files.append(arg["path"].replace(str(root) + "/", ""))
                calls[block.get("id")] = (block.get("name"), arg)
        u = m.get("usage")
        if u:
            for k in ("input", "output", "cacheRead", "cacheWrite"):
                usage[k] += u.get(k) or 0
            usage["total"] += u.get("totalTokens") or 0
            usage["cost"] += (u.get("cost") or {}).get("total") or 0
    return {
        "session_id": next((r.get("id") for r in records if r.get("type") == "session"), None),
        "name": (info.get("name") or ""),
        "file": pathlib.Path(path).name,
        "usage": usage,
        "tools": tools,
        "read_files": sorted(set(files)),
        "seconds": round(max(stamps) - min(stamps)) if stamps else None,
        "calls": calls,
    }


def transcript_for(run):
    """The productive transcript whose display name ends with `-<run>` (two sessions can share
    a name when one was aborted); the one with the higher total usage wins."""
    best = None
    for path in glob.glob(str(d / "sessions" / "*.jsonl")):
        rec = session_record(path)
        if rec["name"].endswith("-" + run):
            if best is None or rec["usage"]["total"] > best["usage"]["total"]:
                best = rec
    return best


def events_and_ledger(home):
    pi = d / home / "repos" / "codetour-10c5c88374" / "pi"
    events = []
    for line in (pi / "events.jsonl").read_text().splitlines() if (pi / "events.jsonl").exists() else []:
        row = json.loads(line)
        if row.get("kind") == "knowledge":
            events.append(row)
    ledger = {}
    for line in (pi / "ledger.jsonl").read_text().splitlines() if (pi / "ledger.jsonl").exists() else []:
        row = json.loads(line)
        ledger[row.get("session_id")] = row
    return events, ledger


out = []
for run, mode, subject, home in PLAN:
    entry = {"run": run, "mode": mode, "subject": subject, "home": home}
    session = transcript_for(run)
    entry["session"] = {k: session[k] for k in
                        ("session_id", "file", "usage", "tools", "read_files", "seconds")}
    events, ledger = events_and_ledger(home)
    entry["ledger"] = {k: ledger[session["session_id"]].get(k)
                       for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                                 "effective_tokens", "requests", "prompts", "overhead")} \
        if session["session_id"] in ledger else None
    entry["knowledge"] = [
        {"trigger": e.get("trigger"), "tool": e.get("tool"), "signal": e.get("signal"),
         "when": e.get("when"), "read_before": e.get("read_before"), "at": e.get("at"),
         "knowledge_id": e.get("knowledge_id")}
        for e in events if e.get("session_id") == session["session_id"]]
    # The call that caused each tool-trigger injection: the session state maps the Pi
    # tool_use_id to the injected card ids; the transcript names the call itself.
    state = d / home / "sessions" / "pi" / f"{session['session_id']}.json"
    blocks = {}
    if state.exists():
        blocks = json.loads(state.read_text()).get("knowledge_read_blocks") or {}
    for e in entry["knowledge"]:
        if e["trigger"] == "tool":
            call_id = next((cid for cid, block in blocks.items()
                            if e.get("knowledge_id") in (block.get("cards") or [])), None)
            name, args = session["calls"].get(call_id, (None, {}))
            e["call"] = {"tool": name, "command": str(args.get("command") or args.get("path") or "")}
    tour = None
    for candidate in (root / ".tours" / f"knowledge-pi-20261127-{run}.tour",
                      root / "codetour" / ".tours" / f"knowledge-pi-20261127-{run}.tour"):
        if candidate.exists():
            tour = candidate
    if tour:
        spec = json.loads(tour.read_text())
        entry["tour"] = {"path": str(tour.relative_to(root)), "steps": len(spec.get("steps") or [])}
    out.append(entry)

print(json.dumps({"control": out, "earlier": EARLIER}, indent=1, ensure_ascii=False))
