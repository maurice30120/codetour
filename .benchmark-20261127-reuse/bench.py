#!/usr/bin/env python3
"""Sequential one-arm benchmark for cross-session Knowledge reuse."""
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

BENCH = Path(__file__).resolve().parent
ROOT = BENCH.parent
SOURCE = ROOT / "codetour"
WORKSPACE = Path("/private/tmp/codetour-bench-20261127-reuse/workspace")
TE_HOME = BENCH / "state" / "te-home"
TE = ROOT / ".tokeneconomizer-venv" / "bin" / "te"
MODEL = "mistral/deepseek-v4-1-flash-1017:high"
SESSION_ROOT = Path.home() / ".pi" / "agent" / "sessions"
TASKS_PATH = BENCH / "tasks.json"
IGNORED_SOURCE = {
    ".git",
    "node_modules",
    ".tours",
    "coverage",
    ".turbo",
    "poc",
    "dist",
    ".vscode-test",
    ".playwright-mcp",
    ".scratch",
    ".DS_Store",
    ".npmrc",
    ".netrc",
}
IGNORED_PATTERNS = (".env*", "*.pem", "*.key", "*.p12")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    temporary.replace(path)


def run_command(args, *, cwd=None, env=None, timeout=None):
    return subprocess.run(
        [str(arg) for arg in args],
        cwd=cwd,
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def command_env():
    env = os.environ.copy()
    env["TOKENECONOMIZER_HOME"] = str(TE_HOME)
    return env


def file_manifest(root):
    entries = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if (
            any(part in IGNORED_SOURCE for part in relative.parts)
            or any(
                fnmatch.fnmatchcase(part, pattern)
                for part in relative.parts
                for pattern in IGNORED_PATTERNS
            )
            or not path.is_file()
        ):
            continue
        entries.append(
            {
                "path": relative.as_posix(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        )
    return entries


def source_manifest():
    return file_manifest(SOURCE)


def learning_state_manifest():
    if not TE_HOME.is_dir():
        return []
    entries = []
    for path in sorted(TE_HOME.rglob("*")):
        if not path.is_file():
            continue
        entries.append(
            {
                "path": path.relative_to(TE_HOME).as_posix(),
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "size_bytes": path.stat().st_size,
            }
        )
    return entries


def git_value(*args, cwd=ROOT):
    result = run_command(["git", *args], cwd=cwd)
    return result.stdout.strip() if result.returncode == 0 else None


def setup():
    if WORKSPACE.exists() or TE_HOME.exists():
        raise SystemExit(
            "Benchmark déjà initialisé ; les données persistantes ne seront pas écrasées."
        )
    if (BENCH / "env" / "versions.json").exists() or list(
        (BENCH / "runs").glob("*.json")
    ):
        raise SystemExit(
            "Artefacts de benchmark déjà présents ; ne pas réinitialiser cette série."
        )
    if not SOURCE.is_dir() or not TE.is_file():
        raise SystemExit("Source codetour ou CLI TE introuvable.")
    if shutil.which("pi") is None or shutil.which("codetour") is None:
        raise SystemExit("CLI pi ou codetour introuvable.")

    ignored = shutil.ignore_patterns(*IGNORED_SOURCE, *IGNORED_PATTERNS)
    WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(SOURCE, WORKSPACE, ignore=ignored)
    for directory in (
        "env",
        "runs",
        "logs",
        "sessions",
        "tours",
        "eval",
        "state/checkpoints",
    ):
        (BENCH / directory).mkdir(parents=True, exist_ok=True)

    source_files = source_manifest()
    write_json(
        BENCH / "env" / "versions.json",
        {
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "parent_commit": git_value("rev-parse", "HEAD"),
            "parent_status": git_value("status", "--short"),
            "tokeneconomizer_commit": git_value(
                "rev-parse", "HEAD", cwd=ROOT / "TokenEconomizer"
            ),
            "tokeneconomizer_status": git_value(
                "status", "--short", cwd=ROOT / "TokenEconomizer"
            ),
            "source": "copy of the current codetour/ working tree",
            "source_file_count": len(source_files),
            "source_manifest_sha256": hashlib.sha256(
                json.dumps(source_files, sort_keys=True).encode("utf-8")
            ).hexdigest(),
            "source_files": source_files,
            "workspace": str(WORKSPACE),
            "model": MODEL,
            "pi": run_command(["pi", "--version"]).stdout.strip(),
            "node": run_command(["node", "--version"]).stdout.strip(),
            "codetour_cli_path": shutil.which("codetour"),
            "codetour_cli_version": (
                run_command(["codetour", "--version"]).stdout.strip()
                if shutil.which("codetour")
                else None
            ),
            "codetour_package_version": read_json(SOURCE / "package.json").get(
                "version"
            ),
            "token_economizer_home": str(TE_HOME),
            "groups": {
                "knowledge": "on",
                "microskills": "on",
                "knowledge_injection": "both",
            },
        },
    )
    print(f"Workspace snapshot created: {WORKSPACE}")
    print(f"Source files recorded: {len(source_files)}")


def effective_config(env):
    result = run_command(
        [TE, "--host", "pi", "--cwd", WORKSPACE, "config", "show"],
        cwd=WORKSPACE,
        env=env,
    )
    if result.returncode != 0:
        raise SystemExit(f"te config show failed: {result.stderr}")
    return json.loads(result.stdout)


def session_directory():
    encoded = os.path.realpath(WORKSPACE).lstrip("/").replace("/", "-")
    return SESSION_ROOT / f"--{encoded}--"


def find_session(marker):
    directory = session_directory()
    if not directory.is_dir():
        return None
    candidates = []
    for path in directory.glob("*.jsonl"):
        try:
            body = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if marker in body:
            candidates.append(path)
    return max(candidates, key=lambda path: path.stat().st_size) if candidates else None


def transcript_evidence(session_path):
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "cost_usd": 0.0,
        "assistant_messages": 0,
        "tool_calls": 0,
    }
    injections = []
    for line_number, line in enumerate(
        session_path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        if entry.get("type") == "custom_message":
            content = entry.get("content") or ""
            if entry.get("customType") == "tokeneconomizer" and isinstance(
                content, str
            ):
                injections.append(
                    {"line": line_number, "channel": "custom_message", "text": content}
                )

        message = entry.get("message") or {}
        if message.get("role") == "system":
            section = (message.get("sections") or {}).get("tokeneconomizer")
            if isinstance(section, str) and section:
                injections.append(
                    {"line": line_number, "channel": "system_section", "text": section}
                )

        if entry.get("type") != "message" or message.get("role") != "assistant":
            continue
        totals["assistant_messages"] += 1
        usage = message.get("usage") or {}
        for field, key in (
            ("input", "input_tokens"),
            ("output", "output_tokens"),
            ("cacheRead", "cache_read_tokens"),
            ("cacheWrite", "cache_write_tokens"),
        ):
            totals[key] += usage.get(field) or 0
        totals["cost_usd"] += (usage.get("cost") or {}).get("total") or 0.0
        totals["tool_calls"] += sum(
            1
            for block in message.get("content") or []
            if isinstance(block, dict) and block.get("type") == "toolCall"
        )

    totals["total_tokens"] = sum(
        totals[key]
        for key in (
            "input_tokens",
            "output_tokens",
            "cache_read_tokens",
            "cache_write_tokens",
        )
    )
    totals["cost_usd"] = round(totals["cost_usd"], 8)
    return totals, injections


def fold_file_exists(session_id):
    return any(
        (TE_HOME / "repos").glob(f"*/pi/sessions/{session_id}.json")
    )


def wait_for_fold(session_id, timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if fold_file_exists(session_id):
            return True
        time.sleep(2)
    return False


def make_prompt(task):
    skill = Path.home() / ".pi" / "agent" / "packages" / "codetour-plugin" / "skills" / "codetour-generate" / "SKILL.md"
    scope = ", ".join(f"`{path}`" for path in task["scope"])
    prompt = read_json(TASKS_PATH)["prompt_template"]
    prompt = (
        prompt.replace("{{topic}}", task["topic"])
        .replace("{{scope}}", scope)
        .replace("{{id}}", task["id"])
    )
    return f"""Lis entièrement la compétence `{skill}`, puis le module de référence qu'elle désigne pour la voie Project Tour, et applique-les exactement.

{prompt}

Paramètres :
- workspace : la racine du répertoire courant ;
- `type=project` ;
- le titre du Tour peut être « {task['tour_title']} » ;
- ne modifie aucun fichier source, ne lance ni build, ni test, ni installation, et n'ouvre aucun ancien fichier `.tour` ;
- crée le Tour avec la commande CLI de la compétence, depuis la racine du workspace.

Termine en recopiant la sortie JSON de la commande CLI.
"""


def prior_runs(tasks, task_id):
    index = next(i for i, task in enumerate(tasks) if task["id"] == task_id)
    for task in tasks[:index]:
        record_path = BENCH / "runs" / f"{task['id']}.json"
        if not record_path.is_file():
            raise SystemExit(f"Run précédent manquant : {task['id']}")
        record = read_json(record_path)
        if record.get("status") != "success" or not record.get("fold_recorded"):
            raise SystemExit(
                f"Run précédent non terminé avec fold confirmé : {task['id']}"
            )


def run_task(task_id):
    tasks = read_json(TASKS_PATH)["runs"]
    task = next((entry for entry in tasks if entry["id"] == task_id), None)
    if task is None:
        raise SystemExit(f"Tâche inconnue : {task_id}")
    if not WORKSPACE.is_dir():
        raise SystemExit("Lancer d'abord `bench.py setup`.")
    if (BENCH / "runs" / f"{task_id}.json").exists():
        raise SystemExit(f"Résultat déjà présent pour {task_id} ; il ne sera pas écrasé.")
    if (WORKSPACE / ".tours").exists():
        raise SystemExit(
            "Artefacts .tours inattendus dans le workspace ; inspecter avant de continuer."
        )
    prior_runs(tasks, task_id)

    env = command_env()
    before_manifest = file_manifest(WORKSPACE)
    configured = run_command(
        [
            TE,
            "--host",
            "pi",
            "--cwd",
            WORKSPACE,
            "config",
            "set",
            "knowledge=on",
            "microskills=on",
            "knowledge_injection=both",
        ],
        cwd=WORKSPACE,
        env=env,
    )
    if configured.returncode != 0:
        raise SystemExit(f"Configuration TE échouée : {configured.stderr}")
    config = effective_config(env)

    prompt = make_prompt(task)
    started_at = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    started = time.time()
    try:
        proc = subprocess.run(
            ["pi", "-p", "--model", MODEL, prompt],
            cwd=WORKSPACE,
            env=env,
            capture_output=True,
            text=True,
            timeout=1500,
            check=False,
        )
        exit_code, stdout, stderr, timed_out = (
            proc.returncode,
            proc.stdout,
            proc.stderr,
            False,
        )
    except subprocess.TimeoutExpired as exc:
        exit_code, timed_out = -1, True
        stdout = exc.stdout if isinstance(exc.stdout, str) else ""
        stderr = exc.stderr if isinstance(exc.stderr, str) else "timeout"

    duration = round(time.time() - started, 1)
    tour_path = WORKSPACE / ".tours" / f"{task_id}.tour"
    session_path = find_session(f"{task_id}.tour")
    metrics, injections = ({}, [])
    session_id = None
    fold_recorded = False
    archived_session = None
    if session_path:
        first_line = session_path.read_text(encoding="utf-8").splitlines()[0]
        session_id = json.loads(first_line).get("id")
        metrics, injections = transcript_evidence(session_path)
        archived_session = BENCH / "sessions" / f"{task_id}.jsonl"
        shutil.copy2(session_path, archived_session)
        if session_id:
            fold_recorded = wait_for_fold(session_id)
            if fold_recorded:
                time.sleep(3)

    created = tour_path.is_file()
    archived_tour = None
    tour_summary = None
    if created:
        archived_tour = BENCH / "tours" / f"{task_id}.tour"
        shutil.copy2(tour_path, archived_tour)
        try:
            tour_data = read_json(tour_path)
            tour_summary = {
                "title": tour_data.get("title"),
                "steps": len(tour_data.get("steps") or []),
            }
        except (json.JSONDecodeError, OSError) as exc:
            tour_summary = {"parse_error": str(exc)}

    status = (
        "success"
        if exit_code == 0
        and not timed_out
        and created
        and fold_recorded
        and source_unchanged
        else "incomplete"
    )
    state_manifest = learning_state_manifest() if fold_recorded else []
    if fold_recorded:
        write_json(
            BENCH / "state" / "checkpoints" / f"{task_id}.json",
            {
                "session_id": session_id,
                "files": state_manifest,
            },
        )
    record = {
        "id": task_id,
        "topic": task["topic"],
        "started_at": started_at,
        "duration_s": duration,
        "status": status,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "effective_config": config,
        "session_file": str(archived_session) if archived_session else None,
        "session_id": session_id,
        "fold_recorded": fold_recorded,
        "source_unchanged": source_unchanged,
        "learning_state_manifest_sha256": hashlib.sha256(
            json.dumps(state_manifest, sort_keys=True).encode("utf-8")
        ).hexdigest(),
        "injections": injections,
        "tour_file": str(archived_tour) if archived_tour else None,
        "tour": tour_summary,
        "metrics": metrics,
        "stdout": stdout[-4000:],
        "stderr": stderr[-4000:],
    }
    write_json(BENCH / "runs" / f"{task_id}.json", record)
    (BENCH / "logs" / f"{task_id}.log").write_text(
        f"## stdout\n{stdout}\n## stderr\n{stderr}\n", encoding="utf-8"
    )

    # Remove generated output only from this disposable workspace, after archiving it.
    generated_tours = WORKSPACE / ".tours"
    if generated_tours.exists():
        shutil.rmtree(generated_tours)
    source_unchanged = before_manifest == file_manifest(WORKSPACE)

    print(
        json.dumps(
            {
                "id": task_id,
                "status": status,
                "fold_recorded": fold_recorded,
                "tour": tour_summary,
                "total_tokens": metrics.get("total_tokens"),
                "cost_usd": metrics.get("cost_usd"),
                "injection_count": len(injections),
                "source_unchanged": source_unchanged,
            },
            ensure_ascii=False,
        )
    )
    if status != "success":
        raise SystemExit("Run non validé ; ne pas poursuivre avant inspection.")


def status():
    tasks = read_json(TASKS_PATH)["runs"]
    for task in tasks:
        path = BENCH / "runs" / f"{task['id']}.json"
        if path.is_file():
            record = read_json(path)
            print(
                task["id"],
                record.get("status"),
                "fold=" + str(record.get("fold_recorded")),
                "injections=" + str(len(record.get("injections") or [])),
            )
        else:
            print(task["id"], "pending")


def main(args):
    if args == ["setup"]:
        setup()
    elif args == ["status"]:
        status()
    elif len(args) == 2 and args[0] == "run":
        run_task(args[1])
    elif args == ["run-all"]:
        for task in read_json(TASKS_PATH)["runs"]:
            record_path = BENCH / "runs" / f"{task['id']}.json"
            if record_path.is_file():
                record = read_json(record_path)
                if record.get("status") == "success" and record.get("fold_recorded"):
                    continue
                raise SystemExit(f"Run incomplet à inspecter : {task['id']}")
            run_task(task["id"])
    else:
        raise SystemExit(
            "Usage: bench.py setup | status | run <reuse-NN> | run-all"
        )


if __name__ == "__main__":
    main(sys.argv[1:])
