#!/usr/bin/env python3
"""Aggregate the benchmark records into CSV files, a chart and the Markdown report."""
import json
import os
import statistics as st

BENCH = os.path.dirname(os.path.abspath(__file__))
GROUPS = ["A", "B", "C", "D"]
GROUP_LABEL = {
    "A": "A — Baseline (knowledge off, micro-skills off)",
    "B": "B — Micro-skills (knowledge off, micro-skills on)",
    "C": "C — Knowledge (knowledge on, micro-skills off)",
    "D": "D — Combiné (knowledge on, micro-skills on)",
}


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def jload(path):
    return json.loads(read(path))


def mean(values):
    return round(st.fmean(values), 2) if values else None


runs = [jload(os.path.join(BENCH, "runs", n)) for n in sorted(os.listdir(os.path.join(BENCH, "runs"))) if n.endswith(".json")]
evals = [jload(os.path.join(BENCH, "eval", n)) for n in sorted(os.listdir(os.path.join(BENCH, "eval"))) if n.endswith(".json")]
scores_by_run = {e["run_id"]: e for e in evals}

rows = []
for r in runs:
    m = r["metrics"]
    s = scores_by_run.get(r["id"], {}).get("scores") or {}
    rows.append({
        "id": r["id"],
        "run": r["run"],
        "cycle": r["cycle"],
        "position": r["position"],
        "group": r["group"],
        "status": r["status"],
        "input": m.get("input_tokens"),
        "cache_read": m.get("cache_read_tokens"),
        "cache_write": m.get("cache_write_tokens"),
        "output": m.get("output_tokens"),
        "total": m.get("total_tokens"),
        "non_cached": (m.get("input_tokens") or 0) + (m.get("output_tokens") or 0),
        "cost": m.get("cost_usd"),
        "duration": r["duration_s"],
        "tools": m.get("tool_calls"),
        "steps": (r.get("tour") or {}).get("step_count"),
        "quality": s.get("note_globale"),
        "exact": s.get("exactitude_technique"),
        "exhaust": s.get("exhaustivite"),
        "errors": s.get("absence_erreurs"),
        "injected_bytes": r["injection_probe"]["bytes"],
        "session": r["session_id"],
    })

os.makedirs(os.path.join(BENCH, "metrics/raw"), exist_ok=True)
for r in runs:
    with open(os.path.join(BENCH, "metrics/raw", r["id"] + ".json"), "w", encoding="utf-8") as fh:
        json.dump(r, fh, ensure_ascii=False, indent=2)

with open(os.path.join(BENCH, "metrics/runs.csv"), "w", encoding="utf-8") as fh:
    cols = list(rows[0].keys())
    fh.write(",".join(cols) + "\n")
    for row in rows:
        fh.write(",".join("" if row[c] is None else str(row[c]) for c in cols) + "\n")


def group_rows(group):
    return [r for r in rows if r["group"] == group]


summary = {}
for g in GROUPS:
    rs = group_rows(g)
    tot = [r["total"] for r in rs if r["total"] is not None]
    nonc = [r["non_cached"] for r in rs if r["non_cached"] is not None]
    costs = [r["cost"] for r in rs if r["cost"] is not None]
    durs = [r["duration"] for r in rs]
    tools = [r["tools"] for r in rs if r["tools"] is not None]
    quals = [r["quality"] for r in rs if r["quality"] is not None]
    steps = [r["steps"] for r in rs if r["steps"] is not None]
    summary[g] = {
        "n": len(rs),
        "success": sum(1 for r in rs if r["status"] == "success"),
        "total_mean": mean(tot), "total_min": min(tot), "total_max": max(tot),
        "non_cached_mean": mean(nonc),
        "cache_rate": round(sum(r["cache_read"] for r in rs) / sum(tot), 4) if tot else None,
        "cost_mean": round(st.fmean(costs), 4),
        "duration_mean": mean(durs),
        "tools_mean": mean(tools),
        "steps_mean": mean(steps),
        "quality_mean": mean(quals),
        "quality_min": min(quals), "quality_max": max(quals),
    }

base = summary["A"]
for g in GROUPS:
    s = summary[g]
    s["save_total_pct"] = round((base["total_mean"] - s["total_mean"]) / base["total_mean"] * 100, 1)
    s["save_non_cached_pct"] = round((base["non_cached_mean"] - s["non_cached_mean"]) / base["non_cached_mean"] * 100, 1)
    s["save_cost_pct"] = round((base["cost_mean"] - s["cost_mean"]) / base["cost_mean"] * 100, 1)
    s["quality_delta"] = round(s["quality_mean"] - base["quality_mean"], 2)

with open(os.path.join(BENCH, "metrics/aggregate.csv"), "w", encoding="utf-8") as fh:
    cols = ["group", "n", "success", "total_mean", "total_min", "total_max", "non_cached_mean",
            "cache_rate", "cost_mean", "duration_mean", "tools_mean", "steps_mean",
            "quality_mean", "quality_min", "quality_max", "save_total_pct",
            "save_non_cached_pct", "save_cost_pct", "quality_delta"]
    fh.write(",".join(cols) + "\n")
    for g in GROUPS:
        fh.write(",".join(str(g if c == "group" else summary[g][c]) for c in cols) + "\n")

# per-cycle pairing: each cycle holds exactly one run of each group
cycle_totals = {g: {} for g in GROUPS}
cycle_quality = {g: {} for g in GROUPS}
for r in rows:
    cycle_totals[r["group"]][r["cycle"]] = r["total"]
    cycle_quality[r["group"]][r["cycle"]] = r["quality"]

comparisons = [("A", "B"), ("A", "C"), ("A", "D"), ("B", "D"), ("C", "D")]
comparison_rows = []
for x, y in comparisons:
    sx, sy = summary[x], summary[y]
    at = cycle_totals[x], cycle_totals[y]
    tokens_lower = sum(1 for c in (1, 2, 3) if at[1][c] < at[0][c])
    aq, yq = cycle_quality[x], cycle_quality[y]
    quality_up = sum(1 for c in (1, 2, 3) if yq[c] > aq[c])
    quality_down = sum(1 for c in (1, 2, 3) if yq[c] < aq[c])
    comparison_rows.append({
        "pair": f"{x} vs {y}",
        "d_total_pct": round((sy["total_mean"] - sx["total_mean"]) / sx["total_mean"] * 100, 1),
        "d_cost_pct": round((sy["cost_mean"] - sx["cost_mean"]) / sx["cost_mean"] * 100, 1),
        "d_quality": round(sy["quality_mean"] - sx["quality_mean"], 2),
        "tokens_lower_cycles": tokens_lower,
        "quality_up_cycles": quality_up,
        "quality_down_cycles": quality_down,
        "per_cycle": " | ".join(
            f"c{c}: {x} {at[0][c]:,} / {y} {at[1][c]:,}".replace(",", " ") for c in (1, 2, 3)),
    })

with open(os.path.join(BENCH, "metrics/comparisons.csv"), "w", encoding="utf-8") as fh:
    cols = list(comparison_rows[0].keys())
    fh.write(",".join(cols) + "\n")
    for row in comparison_rows:
        fh.write(",".join('"%s"' % str(row[c]).replace('"', "'") if c == "per_cycle" else str(row[c])
                           for c in cols) + "\n")


# ------------------------------------------------------------------ chart (SVG)

W, H = 760, 300
def bar_panel(x0, title, values, vmax, fmt, color):
    out = [f'<text x="{x0}" y="24" font-family="Helvetica" font-size="14" fill="#222">{title}</text>']
    base_y = H - 40
    for i, g in enumerate(GROUPS):
        v = values[g]
        h = 0 if not vmax else int((v / vmax) * (base_y - 50))
        x = x0 + 20 + i * 80
        out.append(f'<rect x="{x}" y="{base_y - h}" width="52" height="{h}" fill="{color}" rx="2"/>')
        out.append(f'<text x="{x + 26}" y="{base_y - h - 6}" font-family="Helvetica" font-size="11" '
                   f'fill="#222" text-anchor="middle">{fmt(v)}</text>')
        out.append(f'<text x="{x + 26}" y="{base_y + 18}" font-family="Helvetica" font-size="13" '
                   f'fill="#222" text-anchor="middle">{g}</text>')
    return out

chart = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
         f'<rect width="{W}" height="{H}" fill="#fff"/>']
chart += bar_panel(10, "Tokens totaux moyens par groupe (n=3)",
                   {g: summary[g]["total_mean"] for g in GROUPS},
                   max(summary[g]["total_mean"] for g in GROUPS), lambda v: f"{v/1000:.0f}k", "#4a6fa5")
chart += bar_panel(400, "Qualité moyenne par groupe (/10)",
                   {g: summary[g]["quality_mean"] for g in GROUPS},
                   10, lambda v: f"{v:.2f}", "#b5651d")
chart.append("</svg>")
with open(os.path.join(BENCH, "report-chart.svg"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(chart))


# ------------------------------------------------------------------ report

def fnum(v):
    return "N/A" if v is None else f"{v:,}".replace(",", "\u202f")


def fint(v):
    return "N/A" if v is None else f"{int(round(v)):,}".replace(",", "\u202f")


def f2(v):
    return "N/A" if v is None else f"{v:.2f}"


ANOMALY_NOTE = {
    "benchmark-D-01": "métriques relues (bug de harnais, sans relance)",
    "benchmark-B-03": "évaluation re-parsée (sans réévaluation)",
}

anomalies = [
    ("benchmark-D-01", "Métriques manquantes à la première passe : le harnais a construit un chemin de "
     "répertoire de sessions erroné (`---private-…` au lieu de `--private-…`). Aucune relance : la session "
     "du run était intacte et les métriques ont été relues depuis son fichier `.jsonl`."),
    ("slot-03 (benchmark-B-03)", "La réponse JSON de l'évaluateur n'a pas été extraite par la première "
     "expression régulière (accolades dans une chaîne citée). Aucune réévaluation : la réponse complète a été "
     "relue depuis la transcription de la session d'évaluation et re-parsée."),
    ("Évaluations 02–12", "Un second benchmark concurrent (autre agent, même dépôt, même état TE) a démarré à "
     "15:15:30 et modifié la configuration TE pendant 11 évaluations. Les 12 créations mesurées étaient terminées "
     "à 15:08:22 : aucune métrique de run n'est affectée. Aucune réévaluation n'a été faite."),
    ("Tous les runs", "Workspace initial : `.tours/` absent (le fichier suivi `.tours/changes.tour` a été retiré "
     "avec le répertoire) — condition uniforme, sans effet observé ; aucun code source modifié."),
    ("Valeurs atypiques (conservées)", "`benchmark-C-02` dure 368 s et `benchmark-D-01` 65 s pour la même tâche "
     "(rapport 5,6×) ; `benchmark-B-02` ne consomme que 538 522 tokens contre 1 194 735 pour `benchmark-B-01`. "
     "Ces points sont atypiques mais valides : aucun n'a été écarté ni remplacé."),
    ("Tous les runs", "Aucun échec, aucun timeout, aucun code de sortie non nul. Aucun fichier source n'a été "
     "modifié : après les 12 runs, le seul écart des worktrees à `HEAD` était la suppression de "
     "`.tours/changes.tour` décrite ci-dessus."),
]

lines = []
add = lines.append
add("# Benchmark CodeTour × TokenEconomizer — 12 créations, 3 cycles\n")
add(f"Exécuté le {rows and jload(os.path.join(BENCH, 'runs', runs[0]['id'] + '.json'))['started_at'][:10]} · "
    f"plan gelé (`plan.json`, graine {jload(os.path.join(BENCH, 'plan.json'))['seed']}) · "
    f"12/12 créations réussies · 12/12 évaluations à l'aveugle\n")

add("## 0. Faisabilité, protocole et limites\n")
add("Le protocole a été exécuté tel que demandé. Neuf points conditionnent sa lecture :\n")
add("1. **Métriques accessibles.** Chaque run est une session `pi -p` neuve ; ses jetons et son coût sont lus "
    "dans le journal de session du fournisseur (`usage` par message assistant). Pi distingue `input` "
    "(hors cache), `cacheRead`, `cacheWrite` et `output` ; `total = input + output + cacheRead + cacheWrite` "
    "(vérifié : la somme égale `totalTokens`, donc aucun double comptage du cache ni du reasoning). "
    "Le coût est celui que Pi calcule à partir de son catalogue de modèles (coût **estimé**, pas facturé).")
add("2. **Isolation.** Chaque run tourne dans un worktree Git détaché dédié (`run-01`…`run-12`, commit identique, "
    "aucun `.tours`), l'état TE est restauré depuis un instantané unique avant chaque run, la configuration du "
    "groupe est appliquée puis **vérifiée** (`te config show` + un vrai appel au hook `SessionStart` dont la "
    "sortie injectée est archivée). Les identifiants de groupe n'apparaissent ni dans le chemin du workspace ni "
    "dans le prompt vu par l'agent.")
add("3. **Knowledge initial.** La base Knowledge de TE était **vide** au départ : `knowledge=on` n'aurait rien "
    "injecté. Elle a donc été constituée avant le benchmark, par une session d'exploration en lecture seule "
    "(7 fichiers, 6 cartes proposées), puis figée : le même instantané est restauré avant chaque run et la même "
    "carte est rendue injectable dans chaque workspace. Ce Knowledge est donc identique pour les 12 runs.")
add("4. **Knowledge est indexé par chemin de workspace** dans TE (`sha256(realpath)`). Le harnais recopie donc "
    "l'état Knowledge initial sous la clé de chaque worktree, sinon le groupe C n'aurait rien reçu. "
    "Sans cette recopie, `knowledge=on` est silencieusement inopérant hors du répertoire d'origine.")
add("5. **Non mesuré (exclu, comme demandé).** L'orchestration du benchmark, la configuration, les 12 évaluations. "
    "Sont aussi exclues les **propres requêtes modèle de TE** (proposeur de micro-skills/Knowledge et juge du "
    "loop guard) : elles tournent après la session, dans un processus détaché qui ne persiste pas de session Pi. "
    "Leur coût n'est donc pas accessible et n'est **pas** inclus dans les coûts ci-dessous (il sous-estime B, C et D).")
add("6. **Prompt de création figé** (`prompts/creation.template.md`) : identique pour les 12 runs, seul "
    "`fileName` change (`benchmark-<groupe>-<cycle>.tour`). Une session `pi -p`, modèle "
    "`mistral/deepseek-v4-1-flash-1017`, thinking `high`, même commit, mêmes instructions système.")
add("7. **`.tours/` vide au départ.** Le harnais remet le workspace à zéro avant chaque run, ce qui a aussi "
    "retiré le fichier suivi `.tours/changes.tour` présent au commit. Les 12 runs ont donc démarré avec un "
    "`.tours/` absent, et un `git status` montrant sa suppression — condition identique pour les 12, et aucun "
    "transcript n'y a réagi (aucune mention de `changes.tour` hors du texte de la compétence).")
add("8. **Évaluation à l'aveugle** : 12 nouvelles sessions, même modèle, même grille, ordre aléatoire indépendant "
    "(`eval-plan.json`), tour copié en `.tours/project.tour` dans un workspace au nom neutre (`run-NN`), "
    "identifiant, groupe, configuration et métriques non communiqués. Les affirmations techniques ont été "
    "vérifiées dans le code (42 à 94 affirmations vérifiées par évaluation). Les sessions d'évaluation ont subi "
    "l'injection TE laissée par le dernier run (manuel micro-skills, identique pour les 12 évaluations).\n")

add("9. **Concurrence pendant l'évaluation (sans effet sur les mesures).** Les 12 créations mesurées se sont "
    "déroulées de 14:33:11 à 15:08:22. À 15:15:30, un **second benchmark, lancé par un autre agent dans le même "
    "dépôt**, a commencé à modifier le même état TE (la configuration est globale au dépôt) ; il a chevauché "
    "11 des 12 évaluations (15:11:21 → 15:35:54). Les métriques des runs sont donc intactes (aucun chevauchement), "
    "mais le manuel micro-skills injecté dans les sessions d'évaluateur a pu changer pendant cette phase : "
    "aucune carte Knowledge n'a été injectée dans ces sessions, et la grille, le modèle et l'aveuglement sont "
    "restés identiques. Résidu mesuré : ≤ 480 octets de manuel dans des contextes de ~1 M tokens.\n")
add("## 1. Résultats bruts\n")
add("| id | cycle | pos. | groupe | statut | tokens entrée | cache lu | tokens sortie | tokens totaux | non cachés | coût ($) | durée (s) | outils | étapes | qualité | anomalie |")
add("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for r in sorted(rows, key=lambda r: (r["group"], r["id"])):
    add(f"| `{r['id']}` | {r['cycle']} | {r['position']} | {r['group']} | {r['status']} | {fnum(r['input'])} | "
        f"{fnum(r['cache_read'])} | {fnum(r['output'])} | {fnum(r['total'])} | {fnum(r['non_cached'])} | "
        f"{r['cost']:.4f} | {r['duration']} | {r['tools']} | {r['steps']} | {f2(r['quality'])} | "
        f"{ANOMALY_NOTE.get(r['id'], '—')} |")
add("\nDétail par critère d'évaluation :\n")
add("| id | exactitude | exhaustivité | absence d'erreurs | note globale |")
add("|---|---|---|---|---|")
for r in sorted(rows, key=lambda r: (r["group"], r["id"])):
    add(f"| `{r['id']}` | {r['exact']} | {r['exhaust']} | {r['errors']} | {f2(r['quality'])} |")
add("")

add("## 2. Tableau par groupe\n")
add("| groupe | succès | tokens totaux moy. (min–max) | non cachés moy. | taux de cache | coût moy. ($) | durée moy. (s) | outils moy. | étapes moy. | qualité moy. | écon. tokens vs A | écon. non cachés vs A | écon. coût vs A |")
add("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for g in GROUPS:
    s = summary[g]
    add(f"| {GROUP_LABEL[g]} | {s['success']}/3 | {fint(s['total_mean'])} ({fint(s['total_min'])}–{fint(s['total_max'])}) | "
        f"{fint(s['non_cached_mean'])} | {s['cache_rate']*100:.1f} % | {s['cost_mean']:.4f} | {s['duration_mean']} | "
        f"{s['tools_mean']} | {s['steps_mean']} | {f2(s['quality_mean'])} ({s['quality_min']}–{s['quality_max']}) | {s['save_total_pct']:+.1f} % | "
        f"{s['save_non_cached_pct']:+.1f} % | {s['save_cost_pct']:+.1f} % |")
add("\n*Taux de cache* = tokens lus depuis le cache / tokens totaux. *Non cachés* = entrée hors cache + sortie. "
    "Le cache est facturé bien moins cher que l'entrée : l'économie en tokens totaux et celle en coût ne se "
    "déplacent pas ensemble.\n")

add("## 3. Comparaisons\n")
add("| comparaison | Δ tokens totaux | Δ coût | Δ qualité (points) | cycles où Y < X (tokens) | cycles où Y > X (qualité) | cycles où Y < X (qualité) |")
add("|---|---|---|---|---|---|---|")
for c in comparison_rows:
    add(f"| {c['pair']} | {c['d_total_pct']:+.1f} % | {c['d_cost_pct']:+.1f} % | {c['d_quality']:+.2f} | "
        f"{c['tokens_lower_cycles']}/3 | {c['quality_up_cycles']}/3 | {c['quality_down_cycles']}/3 |")
add("\nDétail apparié par cycle (tokens totaux) :\n")
add("| comparaison | cycle 1 | cycle 2 | cycle 3 |")
add("|---|---|---|---|")
for c in comparison_rows:
    parts = c["per_cycle"].split(" | ")
    add(f"| {c['pair']} | {parts[0]} | {parts[1]} | {parts[2]} |")
add("\nLa comparaison appariée par cycle est la seule lecture qui neutralise la variabilité entre runs : "
    "chaque cycle contient exactement un run de chaque groupe, dans un ordre aléatoire.\n")

add("## 4. Graphique\n")
add("![Tokens totaux et qualité par groupe](report-chart.svg)\n")
add("```")
max_total = max(summary[g]["total_mean"] for g in GROUPS)
for g in GROUPS:
    s = summary[g]
    bar = "█" * int(s["total_mean"] / max_total * 46)
    qbar = "▓" * int(s["quality_mean"] * 4.6)
    add(f"{g}  tokens {fint(s['total_mean']):>10}  {bar}")
    add(f"   qualité {s['quality_mean']:>4.2f}/10      {qbar}")
add("```\n")

add("## 5. Conclusion\n")
all_q = [r["quality"] for r in rows if r["quality"] is not None]
best_tokens = min(GROUPS, key=lambda g: summary[g]["total_mean"])
best_cost = min(GROUPS, key=lambda g: summary[g]["cost_mean"])
best_quality = max(GROUPS, key=lambda g: summary[g]["quality_mean"])
pair = {c["pair"]: c for c in comparison_rows}
robust = [c for c in comparison_rows if c["tokens_lower_cycles"] == 3]
add(f"- **Meilleur compromis mesuré** : groupe **{best_tokens}** — {fint(summary[best_tokens]['total_mean'])} tokens "
    f"(soit {abs(summary[best_tokens]['save_total_pct']):.1f} % de moins que A), {summary[best_tokens]['cost_mean']:.4f} $ "
    f"({abs(summary[best_tokens]['save_cost_pct']):.1f} % de moins que A), qualité {summary[best_quality]['quality_mean']:.2f}/10 "
    f"({summary[best_quality]['quality_delta']:+.2f} point vs A).")
add("- **Tendance robuste (3/3 cycles appariés)** : B, C et D consomment moins de tokens que A "
    f"({pair['A vs B']['d_total_pct']:+.1f} %, {pair['A vs C']['d_total_pct']:+.1f} %, {pair['A vs D']['d_total_pct']:+.1f} %)" +
    " ; la qualité de D dépasse celle de A dans 3/3 cycles (" + f"{pair['A vs D']['d_quality']:+.2f} point).")
add("- **Simples tendances (2/3 cycles)** : D consomme moins que B et que C, et B note mieux que A ; "
    "à n=3, ces écarts ne sont pas établis.")
add(f"- **Dispersion** : les notes vont de {min(all_q)} à {max(all_q)} sur les 12 runs, pour un écart entre "
    f"moyennes de groupe de {max(summary[g]['quality_mean'] for g in GROUPS) - min(summary[g]['quality_mean'] for g in GROUPS):.2f} point : "
    "la qualité reste un signal faible à cette taille d'échantillon.")
add("- **Recommandation fondée sur ces mesures** : `knowledge=on` (C ou D) pour une création de Project Tour ; "
    "les micro-skills seuls (B) réduisent aussi les tokens et le coût, sans effet qualité démontré. "
    "Aucune conclusion ferme sur la qualité ni sur les configurations D vs C.")

add("\n## Annexes\n")
ev_costs = [(e.get("eval_metrics") or {}).get("cost_usd") or 0 for e in evals]
ev_tokens = [(e.get("eval_metrics") or {}).get("total_tokens") or 0 for e in evals]
add(f"### Coût de la mesure (hors résultats)\n")
ev_tokens_txt = f"{sum(ev_tokens):,}".replace(",", "\u202f")
add(f"Les 12 créations mesurées coûtent {sum(r['metrics']['cost_usd'] for r in runs):.4f} $ au total. "
    f"L'évaluation à l'aveugle, exclue de la mesure, a coûté {sum(ev_costs):.4f} $ et "
    f"{ev_tokens_txt} tokens sur 12 sessions indépendantes.\n")
add("### Anomalies et incidents\n")
for name, text in anomalies:
    add(f"- **{name}** — {text}")
add("\n### Versions et environnement\n")
versions = jload(os.path.join(BENCH, "env/versions.json"))
add("| élément | valeur |")
add("|---|---|")
for key in ("git_commit", "git_branch", "git_dirty_worktree", "codetour_package_version", "codetour_cli_path",
            "tokeneconomizer_commit", "tokeneconomizer_version", "pi_version", "node_version", "model",
            "thinking", "agent", "code_under_study"):
    add(f"| {key} | `{versions.get(key)}` |")
add("\nLe worktree analysé est le commit `git_commit`, détaché. La CLI `codetour` installée provient du "
    "répertoire de travail (build `dist/`), qui contient des modifications non commitées : le code lu et la CLI "
    "exécutée peuvent différer marginalement, de façon identique pour les 12 runs.\n")
add("### Configuration TE après le benchmark\n")
add("La configuration a été remise à sa valeur initiale — `knowledge=off`, `microskills=off`, "
    "`knowledge_injection=both`, `loopguard=nudge`, `toolprune=auto` — et vérifiée par `te config show`. "
    "La base Knowledge créée pour l'expérience a été retirée de l'état vivant (elle reste dans "
    "`state/te-state` pour la reproduction) ; un benchmark concurrent peut en recréer. **Réserve** : cette configuration est globale au dépôt et un "
    "benchmark concurrent, toujours actif au moment de la rédaction, partage le même état TE ; il peut la "
    "modifier après ce rapport.\n")
add("### Livrables\n")
add("- `plan.json` — planning gelé (3 cycles × 4 groupes, ordre aléatoire, graine) ; `eval-plan.json` — ordre d'évaluation")
add("- `prompts/creation.template.md`, `prompts/eval-prompt.md` — prompts figés")
add("- `configs/<id>.json` — configuration effective + injection réelle par hook pour chaque run")
add("- `runs/<id>.json` — métriques brutes par run ; `tours/<id>.tour` — les 12 CodeTours")
add("- `metrics/runs.csv`, `metrics/aggregate.csv`, `metrics/comparisons.csv` ; `report-chart.svg`")
add("- `eval/slot-XX.json` — évaluations à l'aveugle (scores, vérifications, réponse complète)")
add("- `state/` — instantané de l'état TE initial et Knowledge de référence restaurés avant chaque run")
add("- `logs/` — sorties complètes des 12 runs")
add("- `report.md` — ce rapport\n")

with open(os.path.join(BENCH, "report.md"), "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))

print("\n".join(lines[-12:]))
print("\nsummary:", json.dumps({g: {k: summary[g][k] for k in ("total_mean", "cost_mean", "quality_mean", "save_total_pct", "save_cost_pct")} for g in GROUPS}, indent=1))
