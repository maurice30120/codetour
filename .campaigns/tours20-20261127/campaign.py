"""Vingt créations de Project Tour, demande identique, configuration TE variée.

Le plan, les foyers TE par variante et l'archivage des Tours produits. Chaque essai est une
session Pi neuve (processus distinct, session distincte, foyer TE distinct), et le Tour produit
est déplacé hors du workspace dès la fin de l'essai : l'essai suivant ne peut pas le voir.

    python3 campaign.py list
    python3 campaign.py prepare <run>
    python3 campaign.py archive <run>
    python3 campaign.py status
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

DIR = pathlib.Path(__file__).resolve().parent
ROOT = DIR.parents[1]
STAMP = "tours20-20261127"
MODEL = "mistral/deepseek-v4-1-flash-1017"

VENV = ROOT / ".tokeneconomizer-venv/bin"
TE = VENV / "te"
PYTHON = VENV / "python"

# Le foyer de la campagne du 27 novembre : 7 cartes Knowledge, preuves revalidées sur l'arbre
# courant. Copié à l'identique pour chaque variante « knowledge » et « microskills ».
SEED = ROOT / ".campaigns/knowledge-pi-20261127/knowledge"

# Mécanismes non mesurés : coupés dans tous les bras pour ne pas brouiller la consommation.
COMMON = ["toolprune=off", "loopguard=off", "repomap=off", "history_import=off"]

VARIANTS = {
    "v1": {"knowledge": "off", "microskills": "off", "knowledge_injection": "both", "seed": False},
    "v2": {"knowledge": "off", "microskills": "on", "knowledge_injection": "both", "seed": True},
    "v3": {"knowledge": "on", "microskills": "off", "knowledge_injection": "both", "seed": True},
    "v4": {"knowledge": "on", "microskills": "on", "knowledge_injection": "both", "seed": True},
    "v5": {"knowledge": "on", "microskills": "off", "knowledge_injection": "startup", "seed": True},
    "v6": {"knowledge": "on", "microskills": "off", "knowledge_injection": "tools", "seed": True},
    "v7": {"knowledge": "on", "microskills": "off", "knowledge_injection": "both", "seed": True},
}

# Deux passages entrelacés de v1..v7, puis un troisième de v1..v6 : v1..v6 ont 3 essais,
# v7 en a 2, et v7 étant identique à v3, la condition « knowledge, microskills off, both »
# dispose de 5 essais. L'entrelacement neutralise une dérive du modèle dans le temps.
ORDER = [f"v{i}" for i in range(1, 8)] * 2 + [f"v{i}" for i in range(1, 7)]
PLAN = [
    {"run": f"t{i + 1:02d}", "variant": variant, "tour": f"{STAMP}-t{i + 1:02d}.tour"}
    for i, variant in enumerate(ORDER)
]

BRIEF = (
    "/codetour type=project Crée un seul Project Tour en français de 4 à 6 étapes avec des "
    "ancres vérifiables dans le code local. Sujet : explique comment CodeTour charge et valide "
    "un Tour, puis enregistre sa progression. Nom du fichier : {tour}."
)
RULES = (
    "Campagne de mesure : ne lis ni les fichiers .tour, ni les répertoires .tours/ et "
    ".campaigns/ ; ne réutilise aucun Tour existant. Travaille depuis la racine du workspace et "
    "n'écris que dans /tmp et le Tour demandé. Crée exactement un Tour, avec le nom de fichier "
    "demandé."
)


def entry(run):
    for item in PLAN:
        if item["run"] == run:
            return item
    raise SystemExit(f"essai inconnu : {run}")


def prompt(run):
    return BRIEF.format(tour=entry(run)["tour"])


def home(run):
    return DIR / "homes" / entry(run)["variant"]


def run_dir(run):
    path = DIR / "runs" / run
    path.mkdir(parents=True, exist_ok=True)
    return path


def te_env(home_dir):
    env = {k: v for k, v in os.environ.items() if not k.startswith(("TE_", "TOKENECONOMIZER_"))}
    env.update(TE_PYTHON=str(PYTHON), TOKENECONOMIZER_HOME=str(home_dir))
    return env


def te(home_dir, *args):
    proc = subprocess.run([str(TE), "--cwd", str(ROOT), *args], env=te_env(home_dir),
                          capture_output=True, text=True)
    return {"argv": ["te", "--cwd", str(ROOT), *args], "exit_code": proc.returncode,
            "out": proc.stdout, "err": proc.stderr}


def seed_home(target):
    """Le foyer de départ, sans l'historique de sessions de la campagne précédente."""
    if target.exists():
        return False
    target.mkdir(parents=True)
    shutil.copy2(SEED / "index.json", target / "index.json")
    repo = next((SEED / "repos").iterdir())
    shutil.copytree(repo, target / "repos" / repo.name)
    for junk in ("sessions", "ledger.jsonl", "events.jsonl", "fold.log", "folded.json",
                 "migrate.log"):
        for path in list((target / "repos" / repo.name / "pi").glob(junk)):
            shutil.rmtree(path) if path.is_dir() else path.unlink()
    shutil.rmtree(target / "repos" / repo.name / "pi" / "sessions", ignore_errors=True)
    return True


def prepare(run):
    item = entry(run)
    variant = VARIANTS[item["variant"]]
    home_dir = home(run)
    created = seed_home(home_dir) if variant["seed"] else (not home_dir.exists() and
                                                           not home_dir.mkdir(parents=True))
    settings = [f"knowledge={variant['knowledge']}",
                f"microskills={variant['microskills']}",
                f"knowledge_injection={variant['knowledge_injection']}",
                *COMMON]
    applied = te(home_dir, "config", "set", *settings)
    shown = te(home_dir, "config", "show")
    report = {"run": run, "variant": item["variant"], "variant_settings": variant,
              "home": str(home_dir), "home_created": created, "set": applied, "show": shown}
    (run_dir(run) / "config.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    return report


def archive(run):
    """Sort le Tour du workspace pour que l'essai suivant ne puisse pas le lire."""
    item = entry(run)
    found = None
    for base in (ROOT / ".tours", ROOT / "codetour/.tours"):
        candidate = base / item["tour"]
        if candidate.exists():
            found = candidate
            break
    kept = []
    if found:
        tour_dir = DIR / "tours"
        tour_dir.mkdir(exist_ok=True)
        target = tour_dir / item["tour"]
        shutil.move(str(found), target)
        kept.append(str(target.relative_to(ROOT)))
    journal = []
    for base in (ROOT / ".tours/.log/creations", ROOT / "codetour/.tours/.log/creations"):
        for path in sorted(base.glob("*.json")) if base.exists() else []:
            row = json.loads(path.read_text())
            if pathlib.Path(str(row.get("tourPath", ""))).name == item["tour"]:
                journal.append({"record": path.name, "sessionId": row.get("sessionId"),
                                "host": row.get("host"), "workspace": row.get("workspace"),
                                "tourPath": row.get("tourPath")})
    report = {"run": run, "tour": kept, "journal": journal}
    (run_dir(run) / "archive.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
    return report


def status():
    rows = []
    for item in PLAN:
        rows.append({"run": item["run"], "variant": item["variant"], "tour": item["tour"],
                     "config": (run_dir(item["run"]) / "config.json").exists(),
                     "session": (run_dir(item["run"]) / "end.json").exists(),
                     "archived": (run_dir(item["run"]) / "archive.json").exists()})
    print(json.dumps({"plan": rows}, indent=1))


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "status"
    if command == "list":
        print(" ".join(item["run"] for item in PLAN))
    elif command == "prepare":
        print(json.dumps(prepare(sys.argv[2]), indent=1, ensure_ascii=False))
    elif command == "archive":
        print(json.dumps(archive(sys.argv[2]), indent=1, ensure_ascii=False))
    elif command == "status":
        status()
    else:
        raise SystemExit(f"commande inconnue : {command}")
