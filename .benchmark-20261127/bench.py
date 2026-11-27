#!/usr/bin/env python3
"""Benchmark CodeTour x TokenEconomizer -- harness.

Subcommands:
  setup            record versions, snapshot TE state, write the frozen plan, create worktrees
  run <id>         one measured CodeTour creation (sequential, isolated)
  eval <n>         one blind quality evaluation (n = index in the evaluation plan)
  status           what has been recorded so far
"""
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import sys
import time

REPO = "/Users/dhuyet/Documents/POC/CodeTOUR+Economiser"
BENCH = os.path.join(REPO, ".benchmark-20261127")
TMPROOT = "/private/tmp/codetour-bench-20261127"
RUNS = os.path.join(TMPROOT, "runs")
TE = os.path.join(REPO, ".tokeneconomizer-venv/bin/te")
HOOK = os.path.join(REPO, "TokenEconomizer/plugin/scripts/te-hook")
STATE = os.path.expanduser("~/.tokeneconomizer/repos/codetour-10c5c88374")
SNAP = os.path.join(BENCH, "state/te-state")
KTEMPLATE = os.path.join(BENCH, "state/knowledge-template.json")

MODEL = "mistral/deepseek-v4-1-flash-1017:high"
SKILL = "/Users/dhuyet/.pi/agent/packages/codetour-plugin/skills/codetour-generate/SKILL.md"
SEED = 20261127

GROUPS = {
    "A": {"knowledge": "off", "microskills": "off"},
    "B": {"knowledge": "off", "microskills": "on"},
    "C": {"knowledge": "on", "microskills": "off"},
    "D": {"knowledge": "on", "microskills": "on"},
}

TOUR_STEPS = ["implementer", "CLI", "validation"]
EVAL_RUBRIC = """Tu évalues la qualité d'un CodeTour déjà créé dans ce workspace : `.tours/project.tour`.

Méthode :
1. Lis entièrement le fichier `.tours/project.tour`.
2. Pour chaque affirmation technique du tour (fichier, chemin, symbole, comportement, flux d'exécution), vérifie-la dans le code source du workspace. Ne crois pas le tour sur parole.
3. Note trois critères, chacun sur 10, avec des entiers :
   - `exactitude_technique` : les affirmations correspondent-elles au code ?
   - `exhaustivite` : le tour couvre-t-il l'architecture et les principaux chemins d'exécution attendus d'un Project Tour ?
   - `absence_erreurs` : absence d'affirmations fausses, de fichiers ou chemins inventés, d'hallucinations (10 = aucune erreur).
4. La note globale est la moyenne des trois critères.

Ne modifie aucun fichier. Réponds uniquement par un objet JSON, sans texte autour :
{"exactitude_technique": n, "exhaustivite": n, "absence_erreurs": n, "note_globale": x.x, "erreurs_constatees": ["..."], "affirmations_verifiees": n, "commentaire": "..."}"""


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def sha256_text(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def creation_prompt(tour_id):
    return read(os.path.join(BENCH, "prompts/creation.template.md")).replace("{{ID}}", tour_id)


def sh(args, cwd=None, timeout=None, env=None):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)


def te(args, cwd=None):
    return sh([TE, "--host", "pi", "--cwd", cwd or REPO] + args)


# --------------------------------------------------------------------------- setup

def cmd_setup():
    for sub in ("tours", "metrics/raw", "logs", "eval", "prompts", "state", "configs", "runs"):
        os.makedirs(os.path.join(BENCH, sub), exist_ok=True)
    versions = {
        "recorded_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "workspace": REPO,
        "git_commit": sh(["git", "rev-parse", "HEAD"], REPO).stdout.strip(),
        "git_branch": sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], REPO).stdout.strip(),
        "git_dirty_worktree": bool(sh(["git", "status", "--porcelain"], REPO).stdout.strip()),
        "codetour_package_version": json.loads(read(os.path.join(REPO, "codetour/package.json"))).get("version"),
        "codetour_cli_path": sh(["bash", "-lc", "command -v codetour"]).stdout.strip(),
        "tokeneconomizer_commit": sh(["git", "rev-parse", "HEAD"], os.path.join(REPO, "TokenEconomizer")).stdout.strip(),
        "tokeneconomizer_version": re.search(r'version\s*=\s*"([^"]+)"',
                                             read(os.path.join(REPO, "TokenEconomizer/pyproject.toml"))).group(1),
        "te_cli": te(["--help"]).stdout.splitlines()[0] if False else "te (TokenEconomizer CLI)",
        "te_config_before": read(os.path.join(STATE, "config.json")) if os.path.exists(
            os.path.join(STATE, "config.json")) else "{}",
        "pi_version": sh(["bash", "-lc", "pi --version 2>/dev/null || node -e \"console.log(require(process.env.HOME+'/.pi/agent/install/releases/1.6.1/node_modules/@earendil-works/pi-coding-agent/package.json').version)\""]).stdout.strip(),
        "node_version": sh(["node", "-e", "process.stdout.write(process.version)"]).stdout.strip(),
        "model": MODEL,
        "thinking": "high",
        "agent": "pi -p (new session per run)",
        "code_under_study": "git worktree of the recorded commit (detached HEAD)",
    }
    write_json(os.path.join(BENCH, "env/versions.json"), versions)

    # Snapshot the TE state as the single initial state restored before every run.
    if os.path.exists(SNAP):
        shutil.rmtree(SNAP)
    shutil.copytree(STATE, SNAP, symlinks=True)

    # The seeded Knowledge (produced before the benchmark from a read-only exploration
    # session) is the fixed initial Knowledge for every run.
    kdir = os.path.join(SNAP, "pi/mechanisms/knowledge_state")
    files = sorted(os.listdir(kdir)) if os.path.isdir(kdir) else []
    if len(files) != 1:
        raise SystemExit(f"expected exactly one seeded knowledge file, found {files}")
    shutil.copy(os.path.join(kdir, files[0]), KTEMPLATE)

    # Frozen plan: three cycles of the four groups in a random order.
    plan_path = os.path.join(BENCH, "plan.json")
    if os.path.exists(plan_path):
        raise SystemExit("plan.json already exists and is frozen")
    rng = random.Random(SEED)
    plan, n = [], 0
    for cycle in (1, 2, 3):
        order = list("ABCD")
        rng.shuffle(order)
        for position, group in enumerate(order, start=1):
            n += 1
            plan.append({
                "run": f"run-{n:02d}",
                "id": f"benchmark-{group}-{cycle:02d}",
                "cycle": cycle,
                "position": position,
                "group": group,
                "workspace": os.path.join(RUNS, f"run-{n:02d}"),
            })
    write_json(plan_path, {
        "seed": SEED,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "rule": "3 cycles of 4; each cycle is one random permutation of A,B,C,D",
        "groups": GROUPS,
        "runs": plan,
    })

    # One detached worktree per run: identical code, no .tours, no output of another run.
    os.makedirs(RUNS, exist_ok=True)
    for entry in plan:
        ws = entry["workspace"]
        if not os.path.isdir(ws):
            out = sh(["git", "worktree", "add", "--detach", ws, versions["git_commit"]], REPO)
            if out.returncode != 0:
                raise SystemExit(f"worktree add failed for {ws}: {out.stderr}")
    print("setup ok:", len(plan), "runs planned")


# --------------------------------------------------------------------------- state

def restore_state():
    if os.path.exists(STATE):
        shutil.rmtree(STATE)
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    shutil.copytree(SNAP, STATE, symlinks=True)


def apply_config(group, ws):
    g = GROUPS[group]
    args = [f"knowledge={g['knowledge']}", f"microskills={g['microskills']}"]
    if g["knowledge"] == "on":
        args.append("knowledge_injection=both")
    out = te(["config", "set"] + args, cwd=ws)
    if out.returncode != 0:
        raise SystemExit(f"config set failed: {out.stderr}")


def knowledge_key(ws):
    return "maurice30120__codetour--%s.json" % hashlib.sha256(os.fsencode(os.path.realpath(ws))).hexdigest()


def ensure_knowledge(ws):
    """Give this workspace the same initial Knowledge as every other run."""
    dst = os.path.join(STATE, "pi/mechanisms/knowledge_state", knowledge_key(ws))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy(KTEMPLATE, dst)


def config_show(ws):
    out = te(["config", "show"], cwd=ws)
    try:
        return json.loads(out.stdout)
    except Exception:
        return {"raw": out.stdout, "stderr": out.stderr}


def hook_probe(ws, tag):
    transcript = os.path.join(BENCH, "logs", f"probe-{tag}.jsonl")
    open(transcript, "a").close()
    payload = {
        "session_id": f"probe-{tag}",
        "transcript_path": transcript,
        "cwd": ws,
        "hook_event_name": "SessionStart",
        "source": "startup",
    }
    out = subprocess.run([HOOK, "--host", "pi"], input=json.dumps(payload),
                         capture_output=True, text=True, timeout=120)
    try:
        answer = json.loads(out.stdout.strip() or "{}")
    except Exception:
        answer = {}
    text = ((answer.get("hookSpecificOutput") or {}).get("additionalContext")) or ""
    return {
        "bytes": len(text.encode("utf-8")),
        "sha256": sha256_text(text),
        "has_manual": "repo operating manual" in text,
        "has_knowledge": "Knowledge from earlier sessions" in text,
        "knowledge_cards": text.count('\n- "'),
        "text": text,
    }


def effective_config(show):
    return {
        "knowledge": (show.get("other") or {}).get("knowledge"),
        "knowledge_injection": (show.get("other") or {}).get("knowledge_injection"),
        "microskills": (show.get("microskills") or {}).get("microskills"),
        "toolprune": (show.get("toolprune") or {}).get("toolprune"),
        "loopguard": (show.get("loopguard") or {}).get("loopguard"),
        "repomap": (show.get("other") or {}).get("repomap"),
        "enabled": show.get("enabled"),
    }


def reset_workspace(ws):
    sh(["git", "reset", "--hard", "HEAD"], ws)
    sh(["git", "clean", "-fdx"], ws)
    shutil.rmtree(os.path.join(ws, ".tours"), ignore_errors=True)


# --------------------------------------------------------------------------- metrics


def parse_scores(text):
    """The last JSON object of the answer that carries the rubric's scores."""
    dec = json.JSONDecoder()
    best = None
    for i, ch in enumerate(text):
        if ch != "{":
            continue
        try:
            obj, _ = dec.raw_decode(text[i:])
        except Exception:
            continue
        if isinstance(obj, dict) and "note_globale" in obj and "exactitude_technique" in obj:
            best = obj
    return best


def session_dir(ws):
    return os.path.join(os.path.expanduser("~/.pi/agent/sessions"),
                        "--" + os.path.realpath(ws).lstrip("/").replace("/", "-") + "--")


def pick_session(ws, marker):
    d = session_dir(ws)
    if not os.path.isdir(d):
        return None
    cands = []
    for name in os.listdir(d):
        if not name.endswith(".jsonl"):
            continue
        path = os.path.join(d, name)
        body = read(path)
        if marker in body:
            cands.append((os.path.getsize(path), path))
    return max(cands)[1] if cands else None


def session_metrics(path):
    total = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": 0.0}
    tools = 0
    assistants = 0
    first = last = None
    tour_result = None
    for line in read(path).splitlines():
        try:
            entry = json.loads(line)
        except Exception:
            continue
        ts = entry.get("timestamp")
        if ts:
            first = first or ts
            last = ts
        if entry.get("type") != "message":
            continue
        msg = entry.get("message") or {}
        if msg.get("role") == "assistant":
            assistants += 1
            usage = msg.get("usage") or {}
            for key in ("input", "output", "cacheRead", "cacheWrite"):
                total[key] += usage.get(key) or 0
            total["cost"] += ((usage.get("cost") or {}).get("total")) or 0
            for block in msg.get("content") or []:
                if isinstance(block, dict) and block.get("type") == "toolCall":
                    tools += 1
        if msg.get("role") == "toolResult" and msg.get("toolName") == "bash":
            text = "".join(b.get("text", "") for b in (msg.get("content") or [])
                           if isinstance(b, dict))
            if '"tourPath"' in text or '"ok":true' in text:
                tour_result = text.strip()[:4000]
    total["total"] = total["input"] + total["output"] + total["cacheRead"] + total["cacheWrite"]
    return {
        "input_tokens": total["input"],
        "output_tokens": total["output"],
        "cache_read_tokens": total["cacheRead"],
        "cache_write_tokens": total["cacheWrite"],
        "total_tokens": total["total"],
        "cost_usd": round(total["cost"], 8),
        "assistant_messages": assistants,
        "tool_calls": tools,
        "session_started": first,
        "session_ended": last,
        "cli_result_excerpt": tour_result,
    }


# --------------------------------------------------------------------------- run

def cmd_run(run_id):
    plan = json.loads(read(os.path.join(BENCH, "plan.json")))
    entry = next((e for e in plan["runs"] if e["id"] == run_id), None)
    if entry is None:
        raise SystemExit(f"unknown id {run_id}")
    ws = entry["workspace"]
    group = entry["group"]
    tag = entry["run"]

    # 1. identical initial TE state, the group's configuration, the same initial Knowledge
    restore_state()
    apply_config(group, ws)
    ensure_knowledge(ws)
    probe = hook_probe(ws, tag)

    # 2. the probe may have written delivery counters: start the run from the same pristine state
    restore_state()
    apply_config(group, ws)
    ensure_knowledge(ws)
    show = config_show(ws)
    effective = effective_config(show)

    reset_workspace(ws)
    prompt = creation_prompt(run_id)
    started_wall = time.time()
    started_iso = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    env = dict(os.environ)
    env.pop("PI_SESSION_FILE", None)
    env.pop("PI_SESSION_ID", None)
    timed_out = False
    try:
        proc = subprocess.run(["pi", "-p", "--model", MODEL, prompt],
                              cwd=ws, capture_output=True, text=True, timeout=1500, env=env)
        rc, stdout, stderr = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        rc, stdout, stderr = -1, (exc.stdout or "") if isinstance(exc.stdout, str) else "", "timeout"
    wall = round(time.time() - started_wall, 1)

    session = pick_session(ws, f"{run_id}.tour")
    metrics = session_metrics(session) if session else {}
    tour_src = os.path.join(ws, ".tours", f"{run_id}.tour")
    created = os.path.isfile(tour_src)
    tour = None
    if created:
        shutil.copy(tour_src, os.path.join(BENCH, "tours", f"{run_id}.tour"))
        try:
            data = json.loads(read(tour_src))
            tour = {
                "title": data.get("title"),
                "description_chars": len(data.get("description") or ""),
                "step_count": len(data.get("steps") or []),
                "steps_with_locator": sum(1 for s in data.get("steps") or []
                                          if any(k in s for k in ("file", "directory"))),
                "steps_with_mermaid": sum(1 for s in data.get("steps") or []
                                          if "```mermaid" in (s.get("description") or "")),
            }
        except Exception as exc:
            tour = {"parse_error": str(exc)}

    # wait for the detached fold of this session (TE's own learning step)
    fold_seen = False
    session_id = None
    if session:
        header = json.loads(read(session).splitlines()[0])
        session_id = header.get("id")
    deadline = time.time() + 120
    while session_id and time.time() < deadline:
        if os.path.exists(os.path.join(STATE, "pi/sessions", f"{session_id}.json")):
            fold_seen = True
            break
        time.sleep(2)
    time.sleep(3)

    status = "success" if (created and rc == 0 and not timed_out) else "failure"
    record = {
        "id": run_id,
        "run": tag,
        "group": group,
        "cycle": entry["cycle"],
        "position": entry["position"],
        "workspace": ws,
        "started_at": started_iso,
        "status": status,
        "exit_code": rc,
        "timed_out": timed_out,
        "duration_s": wall,
        "session_file": session,
        "session_id": session_id,
        "fold_recorded": fold_seen,
        "effective_config": effective,
        "injection_probe": probe,
        "prompt_sha256": sha256_text(prompt),
        "tour": tour,
        "metrics": metrics,
        "stdout_tail": stdout[-3000:],
        "stderr_tail": stderr[-3000:],
    }
    write_json(os.path.join(BENCH, "runs", f"{run_id}.json"), record)
    write_json(os.path.join(BENCH, "configs", f"{run_id}.json"),
               {"group": group, "requested": GROUPS[group], "effective": effective,
                "injection_probe": probe, "config_show": show})
    with open(os.path.join(BENCH, "logs", f"{run_id}.log"), "w", encoding="utf-8") as fh:
        fh.write(f"# {run_id} ({tag}, group {group})\n## stdout\n{stdout}\n## stderr\n{stderr}\n")
    print(json.dumps({k: record[k] for k in
                      ("id", "status", "duration_s", "tour", "effective_config")}, ensure_ascii=False))
    print(json.dumps({k: metrics.get(k) for k in
                      ("total_tokens", "cost_usd", "tool_calls", "input_tokens",
                       "cache_read_tokens", "output_tokens")}, ensure_ascii=False))


# --------------------------------------------------------------------------- eval

def cmd_eval(index):
    eval_plan_path = os.path.join(BENCH, "eval-plan.json")
    if not os.path.exists(eval_plan_path):
        plan = json.loads(read(os.path.join(BENCH, "plan.json")))
        runs = [e for e in plan["runs"] if os.path.isfile(os.path.join(BENCH, "runs", f"{e['id']}.json"))]
        rng = random.Random(SEED + 1)
        rng.shuffle(runs)
        write_json(eval_plan_path, {
            "note": "evaluation order, independent of the run order; ids are masked from the evaluator",
            "runs": [{"index": i + 1, "slot": f"slot-{i + 1:02d}", "id": e["id"]} for i, e in enumerate(runs)],
        })
    eval_plan = json.loads(read(eval_plan_path))
    slot = next((e for e in eval_plan["runs"] if e["index"] == index), None)
    if slot is None:
        raise SystemExit(f"no evaluation slot {index}")
    run_id = slot["id"]
    record = json.loads(read(os.path.join(BENCH, "runs", f"{run_id}.json")))
    ws = record["workspace"]

    # mask the identifier: the evaluator sees one neutral tour and a neutral workspace
    tours = os.path.join(ws, ".tours")
    shutil.rmtree(tours, ignore_errors=True)
    os.makedirs(tours, exist_ok=True)
    shutil.copy(os.path.join(BENCH, "tours", f"{run_id}.tour"), os.path.join(tours, "project.tour"))

    env = dict(os.environ)
    env.pop("PI_SESSION_FILE", None)
    env.pop("PI_SESSION_ID", None)
    started = time.time()
    proc = subprocess.run(["pi", "-p", "--model", MODEL, EVAL_RUBRIC],
                          cwd=ws, capture_output=True, text=True, timeout=1500, env=env)
    wall = round(time.time() - started, 1)
    text = proc.stdout
    match = parse_scores(text)
    session = pick_session(ws, "note_globale")
    metrics = session_metrics(session) if session else {}
    result = {
        "index": index,
        "slot": slot["slot"],
        "run_id": run_id,
        "masked_tour": "tours/project.tour",
        "workspace": ws,
        "exit_code": proc.returncode,
        "duration_s": wall,
        "scores": match,
        "raw_answer": text,
        "eval_metrics": metrics,
    }
    write_json(os.path.join(BENCH, "eval", f"{slot['slot']}.json"), result)
    print(json.dumps({"slot": slot["slot"], "scores": match,
                      "tokens": metrics.get("total_tokens")}, ensure_ascii=False))



def cmd_reparse():
    """Re-read the evaluator's full answer from its session file (a parsing fix, never a new run)."""
    for name in sorted(os.listdir(os.path.join(BENCH, "eval"))):
        if not name.endswith(".json"):
            continue
        path = os.path.join(BENCH, "eval", name)
        data = json.loads(read(path))
        session = pick_session(data["workspace"], "note_globale")
        if session:
            text = ""
            for line in read(session).splitlines():
                entry = json.loads(line)
                if entry.get("type") != "message":
                    continue
                msg = entry.get("message") or {}
                if msg.get("role") == "assistant":
                    for block in msg.get("content") or []:
                        if isinstance(block, dict) and block.get("type") == "text":
                            text += block.get("text", "")
            if parse_scores(text):
                data["scores"] = parse_scores(text)
                data["raw_answer"] = text
                write_json(path, data)
                print(name, data["run_id"], data["scores"]["note_globale"])
                continue
        print(name, data["run_id"], "scores:", bool(data.get("scores")), "(kept)")


def cmd_status():
    runs = sorted(os.listdir(os.path.join(BENCH, "runs"))) if os.path.isdir(os.path.join(BENCH, "runs")) else []
    print("runs recorded:", len([r for r in runs if r.endswith(".json")]))
    for name in runs:
        if name.endswith(".json"):
            rec = json.loads(read(os.path.join(BENCH, "runs", name)))
            print(f"  {rec['id']:<18} {rec['status']:<8} steps={str((rec.get('tour') or {}).get('step_count')):<4}"
                  f" tokens={rec['metrics'].get('total_tokens')} tools={rec['metrics'].get('tool_calls')}")
    ev = sorted(os.listdir(os.path.join(BENCH, "eval"))) if os.path.isdir(os.path.join(BENCH, "eval")) else []
    print("evaluations recorded:", len([e for e in ev if e.endswith('.json')]))


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "setup":
        cmd_setup()
    elif cmd == "run":
        cmd_run(sys.argv[2])
    elif cmd == "eval":
        cmd_eval(int(sys.argv[2]))
    elif cmd == "reparse":
        cmd_reparse()
    elif cmd == "status":
        cmd_status()
    else:
        raise SystemExit(__doc__)
