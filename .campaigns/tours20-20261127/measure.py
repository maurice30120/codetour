"""Ce que chaque essai a consommé, lu dans ses propres artefacts.

Par essai : la transcription Pi (tokens, outils, fichiers lus), le registre TE du foyer de la
variante (tokens effectifs, injections Knowledge), le Tour archivé. Rien n'est écrit.

    python3 measure.py            # JSON
    python3 measure.py --table    # tableau Markdown
"""
import glob
import json
import pathlib
import sys

import campaign

DIR = campaign.DIR
ROOT = campaign.ROOT


def session_record(path):
    records = [json.loads(line) for line in open(path)]
    info = next((r for r in records if r.get("type") == "session_info"), {})
    usage = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0, "cost": 0.0}
    tools, files, calls = {}, [], {}
    stamps = [r.get("timestamp") for r in records if r.get("timestamp")]
    for r in records:
        message = r.get("message") or {}
        for block in message.get("content") or []:
            if block.get("type") == "toolCall":
                tools[block.get("name")] = tools.get(block.get("name"), 0) + 1
                arg = block.get("arguments") or {}
                if block.get("name") == "read" and isinstance(arg.get("path"), str):
                    files.append(arg["path"])
                calls[block.get("id")] = (block.get("name"), arg)
        u = message.get("usage")
        if u:
            for key in ("input", "output", "cacheRead", "cacheWrite"):
                usage[key] += u.get(key) or 0
            usage["total"] += u.get("totalTokens") or 0
            usage["cost"] += (u.get("cost") or {}).get("total") or 0
    return {
        "session_id": next((r.get("id") for r in records if r.get("type") == "session"), None),
        "name": info.get("name") or "",
        "file": pathlib.Path(path).name,
        "usage": usage,
        "tools": tools,
        "read_files": sorted(set(files)),
        "calls": calls,
        "timestamps": stamps,
    }


def transcript(run):
    best = None
    for path in glob.glob(str(DIR / "sessions" / "*.jsonl")):
        record = session_record(path)
        if record["name"].endswith("-" + run):
            if best is None or record["usage"]["total"] > best["usage"]["total"]:
                best = record
    return best


def te_state(run):
    home = campaign.home(run)
    events, ledger = [], {}
    for path in glob.glob(str(home / "repos" / "*" / "pi" / "events.jsonl")):
        for line in pathlib.Path(path).read_text().splitlines():
            row = json.loads(line)
            if row.get("kind") == "knowledge":
                events.append(row)
    for path in glob.glob(str(home / "repos" / "*" / "pi" / "ledger.jsonl")):
        for line in pathlib.Path(path).read_text().splitlines():
            row = json.loads(line)
            ledger[row.get("session_id")] = row
    return events, ledger


def measured(run):
    item = campaign.entry(run)
    record = transcript(run)
    events, ledger = te_state(run)
    row = {
        "run": run,
        "variant": item["variant"],
        "settings": campaign.VARIANTS[item["variant"]],
        "tour": item["tour"],
        "created": (DIR / "tours" / item["tour"]).exists(),
    }
    if record:
        row["session"] = {
            "id": record["session_id"],
            "file": record["file"],
            "usage": record["usage"],
            "tools": record["tools"],
            "seconds": record["timestamps"] and len(record["timestamps"]),
        }
        mine = [e for e in events if e.get("session_id") == record["session_id"]]
        row["knowledge"] = [
            {"trigger": e.get("trigger"), "tool": e.get("tool"), "at": e.get("at"),
             "knowledge_id": e.get("knowledge_id")}
            for e in mine
        ]
        entry = ledger.get(record["session_id"])
        if entry:
            row["ledger"] = {key: entry.get(key) for key in (
                "input_tokens", "output_tokens", "cache_read_input_tokens", "effective_tokens",
                "requests", "prompts", "overhead")}
        leaks = [f for f in record["read_files"]
                 if "/.tours/" in f or f.endswith(".tour") or "/.campaigns/" in f]
        row["isolation"] = {"reads_outside": leaks}
    return row


def table(rows):
    head = ("| essai | variante | knowledge | micro | injection | étapes | entrée | sortie | "
            "cache lu | eff. TE | requêtes | injections | outils | Tour |")
    lines = [head, "|" + "---|" * 14]
    for row in rows:
        usage = (row.get("session") or {}).get("usage") or {}
        ledger = row.get("ledger") or {}
        steps = ""
        tour = DIR / "tours" / row["tour"]
        if tour.exists():
            steps = str(len(json.loads(tour.read_text()).get("steps") or []))
        settings = row["settings"]
        lines.append("| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |".format(
            row["run"], row["variant"], settings["knowledge"], settings["microskills"],
            settings["knowledge_injection"], steps or "—",
            usage.get("input", "—"), usage.get("output", "—"), usage.get("cacheRead", "—"),
            ledger.get("effective_tokens", "—"), ledger.get("requests", "—"),
            len(row.get("knowledge") or []),
            json.dumps((row.get("session") or {}).get("tools") or {}, ensure_ascii=False),
            row["tour"] if row["created"] else "absent"))
    return "\n".join(lines)


if __name__ == "__main__":
    rows = [measured(item["run"]) for item in campaign.PLAN]
    rows = [row for row in rows if row.get("session")]
    if "--table" in sys.argv:
        print(table(rows))
    else:
        print(json.dumps(rows, indent=1, ensure_ascii=False))
