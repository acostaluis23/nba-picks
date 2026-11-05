"""
tune.py - try different model settings on a past season and rank them.

Run from the nba-picks folder with the virtual environment active:

  python tune.py                         # tries a standard set of changes, one at a time
  python tune.py --only SD_MULT          # just one setting
  python tune.py --every 12              # faster (tests fewer game days)
  python tune.py --base SD_MULT=1.15     # keep a setting you already like, and test others on top

Each line is one run of the backtest with ONE setting changed. Columns:

  vs base   average of (model miss / plain last-10-average miss) across the stats. Lower is better;
            below 1.000 means the model beats the simple average.
  Brier     score for the over/under percentages. Lower is better.
  tails     how overconfident the extreme percentages are (the "80% that really happens 73%"
            problem). 0 is perfect; positive means overconfident.
  bias      average projection minus actual, as a percent of the average actual.
  cover50/80  should be near 50% and 80%.

Pick changes that help clearly AND make basketball sense, then confirm them on different game days
(for example --start-after 10) so you aren't just fitting this one sample.
"""

import argparse
import sys
import time
from types import SimpleNamespace

import numpy as np

import backtest as B
import project as P

# name: values to try (the current value is always run first as "current")
GRID = {
    "SD_MULT": [1.0, 1.1, 1.2],
    "HALF_LIFE": [3, 6, 10],
    "CONTEXT_SHRINK": [0.25, 0.75, 1.0],
    "RATE_PRIOR_GAMES": [5, 20],
}


def score(df, cal):
    rel, bias = [], []
    for _, g in df.groupby("stat"):
        base = (g["base10"] - g["actual"]).abs().mean()
        rel.append((g["proj"] - g["actual"]).abs().mean() / base)
        bias.append((g["proj"] - g["actual"]).mean() / max(g["actual"].mean(), 1e-9))
    z = (df["actual"] - df["proj"]).abs() / df["sd"]
    hi, lo = cal[cal["p_over"] >= 0.65], cal[cal["p_over"] <= 0.35]
    tails = []
    if len(hi) >= 30:
        tails.append((hi["p_over"] - hi["hit"]).mean())
    if len(lo) >= 30:
        tails.append((lo["hit"] - lo["p_over"]).mean())
    return dict(rel=float(np.mean(rel)), brier=float(((cal["p_over"] - cal["hit"]) ** 2).mean()),
                tails=float(np.mean(tails)) if tails else float("nan"), bias=float(np.mean(bias)),
                c50=float((z <= 0.674).mean()), c80=float((z <= 1.282).mean()), n=len(df))


def main():
    ap = argparse.ArgumentParser(description="Compare model settings with the backtest.")
    ap.add_argument("--season", default=P.LAST_SEASON)
    ap.add_argument("--prior")
    ap.add_argument("--stats", default=B.DEFAULT_STATS)
    ap.add_argument("--every", type=int, default=7, help="test every Nth game day (default 7)")
    ap.add_argument("--start-after", type=int, default=8)
    ap.add_argument("--only", help="comma-separated setting names to try (default: all in the list)")
    ap.add_argument("--base", action="append", metavar="NAME=VALUE", help="settings applied to every run")
    ap.add_argument("--db")
    args = ap.parse_args()

    names = [n.strip() for n in args.only.split(",")] if args.only else list(GRID)
    for n in names:
        if n not in GRID:
            sys.exit(f"Unknown setting '{n}'. Choose from: {', '.join(GRID)}")

    original = {n: getattr(P, n) for n in set(GRID) | {s.partition("=")[0] for s in args.base or []}
                if hasattr(P, n)}
    runs = [("current settings", [])] + [(f"{n} = {v}", [f"{n}={v}"]) for n in names for v in GRID[n]]
    print(f"Testing {len(runs)} versions on {args.season}, every {args.every} game days. This takes a while.\n")
    print(f"{'version':<24}{'vs base':>9}{'Brier':>8}{'tails':>8}{'bias':>8}{'cover50':>9}{'cover80':>9}{'time':>7}")

    results = []
    try:
        for label, change in runs:
            for k, v in original.items():
                setattr(P, k, v)
            run_args = SimpleNamespace(season=args.season, prior=args.prior, stats=args.stats, every=args.every,
                                       start_after=args.start_after, set=list(args.base or []) + change,
                                       db=args.db, out=None)
            t = time.perf_counter()
            try:
                df, cal, _ = B.collect(run_args, quiet=True)
            except P.PickError as e:
                sys.exit(f"\nError: {e}")
            s = score(df, cal)
            results.append((label, s))
            print(f"{label:<24}{s['rel']:>9.4f}{s['brier']:>8.4f}{s['tails']:>+8.3f}{s['bias']:>+8.1%}"
                  f"{s['c50']:>9.0%}{s['c80']:>9.0%}{time.perf_counter() - t:>6.0f}s", flush=True)
    finally:
        for k, v in original.items():
            setattr(P, k, v)

    best_acc = min(results, key=lambda r: r[1]["rel"])
    best_cal = min(results, key=lambda r: r[1]["brier"])
    print(f"\nMost accurate projections: {best_acc[0]}  (vs base {best_acc[1]['rel']:.4f})")
    print(f"Best percentages (Brier):  {best_cal[0]}  ({best_cal[1]['brier']:.4f})")
    print("Differences in the third decimal place are noise. Look for clear, consistent gains.")


if __name__ == "__main__":
    main()