import json
import math
import argparse
from pathlib import Path

import pandas as pd

parser = argparse.ArgumentParser()
parser.add_argument("--raw", type=Path, default=Path("/data/raw/heat-continuation-3"))
parser.add_argument("--out", type=Path, default=Path("/data/analysis"))
parser.add_argument("--baseline", default="baseline")
parser.add_argument("--final")
parser.add_argument("--proof", type=Path)
parser.add_argument("--baseline-label", default="Исходный код")
parser.add_argument("--final-label", default="Текущий кандидат")
args = parser.parse_args()
RAW, OUT = args.raw, args.out
runs = {}
records = []
for path in sorted(RAW.glob("*-performance-samples.json")):
    name = path.name.removesuffix("-performance-samples.json")
    report = json.loads((RAW / f"{name}-performance.json").read_text())
    raw = json.loads(path.read_text())
    runs[name] = {
        "cpu": report["cpu"], "node": report["node"],
        "status": report["status"], "failures": report["acceptanceFailures"],
        "counts": report["preflight"]["counts"],
        "pumps": report["preflight"]["station"]["offshorePumps"],
        "radars": report["preflight"]["load"]["activeRadars"],
        "accident": report["groupAccidentProgress"],
    }
    for stage, arrays in raw.items():
        assert len(arrays["fullTickMs"]) == len(arrays["heatMs"])
        for metric, values in arrays.items():
            records.extend(dict(run=name, stage=stage, metric=metric, sample=i, ms=v)
                           for i, v in enumerate(values))
frame = pd.DataFrame(records)
assert not frame[["run", "stage", "metric", "sample"]].duplicated().any()
assert frame["ms"].notna().all() and (frame["ms"] >= 0).all()
quantiles = []
for (run, stage, metric), group in frame.groupby(["run", "stage", "metric"], sort=True):
    values = group["ms"].sort_values().to_numpy()
    result = dict(run=run, stage=stage, metric=metric, n=len(values))
    for label, p in [("p50", .5), ("p95", .95), ("p99", .99)]:
        result[label] = float(values[math.ceil(p * len(values)) - 1])
    result["max"] = float(values[-1])
    # Independent recomputation from raw arrays, not pandas grouping/sorting.
    source = json.loads((RAW / f"{run}-performance-samples.json").read_text())[stage][metric]
    for label, p in [("p50", .5), ("p95", .95), ("p99", .99)]:
        assert result[label] == sorted(source)[math.ceil(p * len(source)) - 1]
    report = json.loads((RAW / f"{run}-performance.json").read_text())
    if stage in report["stages"]:
        reported = report["stages"][stage]["fullTick" if metric == "fullTickMs" else "heat"]
    elif stage in ("split-graph-rebuild", "merge-graph-rebuild"):
        key = ("split" if stage.startswith("split") else "merge") + ("FullTick" if metric == "fullTickMs" else "Heat")
        reported = report["graphRebuildProgress"][key]
    else:
        reported = report["groupAccidentProgress"]["fullTick" if metric == "fullTickMs" else "heat"]
    assert result["p95"] == reported["p95Ms"]
    quantiles.append(result)

final_run = args.final or ("candidate-3-repeat" if "candidate-3-repeat" in runs else "candidate-3")
evidence = {
    "source": str(RAW), "grain": "one measured real Game.step per run, stage, metric",
    "filters": "all supplied samples, no exclusions; profiling runs excluded",
    "rows": len(frame), "pairedTicks": len(frame) // 2,
    "method": "nearest rank ceil(p*N)-1; no interpolation, no pooling across stages or runs",
    "runs": runs, "quantiles": quantiles, "finalRun": final_run,
    "baselineRun": args.baseline,
    "independentCheck": "raw Python sorted arrays exactly match pandas and original reports",
    "comparisonPlan": [
        {"question": "Are full-step and heat rebuild budgets met?",
         "grain": "p95 per 30 real split or merge steps per run",
         "population": "same unmodified 100-reactor strict fixture",
         "unit": "ms", "derivation": "independent nearest-rank p95",
         "finding": "see exact per-run gates; passing one earlier run does not establish stable acceptance",
         "delivery": "chart", "reason": "two independently gated phases, both split and merge"},
        {"question": "Does group accident latency disappear?",
         "grain": "first actual explosion tick", "unit": "ms",
         "finding": "isolated spike remains; p95 of all accident steps does not hide it",
         "delivery": "prose", "reason": "single event, not a trend"},
    ],
}
if args.proof:
    evidence["verification"] = json.loads((args.proof / "verification-summary.json").read_text())
    evidence["physicsParity"] = json.loads((args.proof / "physics-parity.json").read_text())
    evidence["scope"] = "fresh sequential previous/new implementation runs after the full regression suite, without parallel heavy work"
    for filename, key in [("decision.json", "decision"), ("flow-numeric-parity.json", "flowNumericParity"), ("retained-verification.json", "retainedVerification"), ("working-hx-parity.json", "workingHxParity")]:
        if (args.proof / filename).is_file():
            evidence[key] = json.loads((args.proof / filename).read_text())
OUT.mkdir(exist_ok=True)
(OUT / "heat-evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2))

def value(run, stage, metric):
    return next(q["p95"] for q in quantiles if q["run"] == run and q["stage"] == stage and q["metric"] == metric)

panels = []
for metric, title, budget in [("fullTickMs", "Полный шаг: p95", 16.67), ("heatMs", "Тепловая фаза: p95", 2)]:
    panels.append({
        "form": "categorical-bars", "title": title, "mode": "grouped",
        "aside": "Весь Game.step" if metric == "fullTickMs" else "Включая перестройку графа",
        "labels": ["Разрыв", "Соединение"], "axis": {"zero": True},
        "referenceLine": {"value": budget, "label": f"Бюджет {budget:g} мс"},
        "series": [
            {"label": args.baseline_label, "valueKind": "durationMs", "role": "base",
             "data": [value(args.baseline, stage, metric) for stage in ["split-graph-rebuild", "merge-graph-rebuild"]]},
            {"label": args.final_label, "valueKind": "durationMs", "role": "subject",
             "data": [value(final_run, stage, metric) for stage in ["split-graph-rebuild", "merge-graph-rebuild"]]},
        ],
    })
spec = {"version": 1, "form": "paired-panels",
        "title": "Тепловая перестройка ещё не прошла строгую приёмку",
        "aside": "По 30 шагов на разрыв и соединение",
        "panels": panels}
if all(value(final_run, stage, "fullTickMs") <= 16.67 for stage in ["split-graph-rebuild", "merge-graph-rebuild"]):
    spec["title"] = "p95 полного шага в бюджете; тепловая перестройка — ещё нет"
if not runs[final_run]["failures"]:
    spec["title"] = "Строгий тепловой стенд прошёл"
if evidence.get("decision", {}).get("result", "").startswith("rejected"):
    spec["title"] = "Кандидат отклонён: хвост соединения ухудшился"
(OUT / "heat-chart-spec.json").write_text(json.dumps(spec, ensure_ascii=False, indent=2))

lines = [
    "| Прогон | Split: полный p95, мс | Split: heat p95, мс | Merge: полный p95, мс | Merge: heat p95, мс |",
    "| --- | ---: | ---: | ---: | ---: |",
]
for run in runs:
    vals = [value(run, stage, metric) for stage in ["split-graph-rebuild", "merge-graph-rebuild"] for metric in ["fullTickMs", "heatMs"]]
    lines.append("| " + run + " | " + " | ".join(f"{v:.4f}" for v in vals) + " |")
(OUT / "heat-table.md").write_text("\n".join(lines) + "\n")
print(json.dumps({"runs": list(runs), "pairedTicks": len(frame) // 2, "independentCheck": "PASS",
                  "finalRun": final_run}, ensure_ascii=False))