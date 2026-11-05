"""
check_picks.py - did the picks in a CSV hit? Uses the results already in nba.db.

Run from the nba-picks folder (virtual environment active), after python ingest.py --current:

  python check_picks.py                              # picks.csv, most recent game day in the database
  python check_picks.py --date 2026-11-04
  python check_picks.py --csv other_picks.csv
  python check_picks.py --slate archive\\slate-2026-11-04.json   # also shows what the model projected

The CSV uses the same columns as project.py --batch (player, stat, line, opp, where, ...).
The program does not know which side you picked, so it shows what the player did and which side hit.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

import pandas as pd

import project as P

HERE = Path(__file__).parent


def main():
    ap = argparse.ArgumentParser(description="Check picks against actual results.")
    ap.add_argument("--csv", default=str(HERE / "picks.csv"))
    ap.add_argument("--date", help="game day (YYYY-MM-DD); default: the latest day in the database")
    ap.add_argument("--slate", help="a pre-game slate.json, to show what the model projected")
    ap.add_argument("--db")
    args = ap.parse_args()

    try:
        ctx = P.load_context(args.db)
        day = args.date or ctx.last_date
        slate_path = Path(args.slate) if args.slate else HERE / "archive" / f"slate-{day}.json"
        projections = {}
        if slate_path.exists():
            for p in json.load(open(slate_path, encoding="utf-8"))["players"]:
                projections[p["id"]] = p["stats"]
        elif args.slate:
            print(f"(Can't find {slate_path}, so model projections are skipped.)")

        with open(args.csv, newline="", encoding="utf-8-sig") as f:
            rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]
    except (P.PickError, OSError) as e:
        sys.exit(f"\nError: {e}")

    print(f"\nPicks checked against results on {day}\n")
    print(f"{'player':<20}{'stat':<16}{'line':>6}{'actual':>8}{'min':>5}   {'result':<22}{'model'}")
    print("-" * 100)
    for r in rows:
        who = r.get("player", "?")
        try:
            key = P.resolve_stat(r.get("stat") or "pts")
            pid, name = P.find_player(ctx, who)
            line = float(r["line"]) if r.get("line") else 0.5
        except (P.PickError, ValueError) as e:
            print(f"{who:<20}skipped: {e}")
            continue
        g = ctx.pgs[(ctx.pgs["player_id"] == pid) & (ctx.pgs["game_date"] == day)]
        if g.empty:
            print(f"{name:<20}{P.stat_label(key):<16}{line:>6g}{'--':>8}{'':>5}   did not play / no game on {day}")
            continue
        g = g.iloc[0]
        if key in P.SPECIAL:
            cats = sum(1 for k in P.DD_STATS if g[k] >= 10)
            hit = cats >= (2 if key == "dd" else 3)
            actual, result = f"{cats} cats", ("YES, it happened" if hit else "NO, it did not")
            model = ""
            if key in projections.get(pid, {}):
                model = f"model chance {projections[pid][key]['p']:.0%}"
        else:
            actual_val = float(g[key])
            actual = f"{actual_val:g}"
            diff = actual_val - line
            result = (f"OVER hit (+{diff:g})" if diff > 0 else f"UNDER hit ({diff:g})" if diff < 0 else "PUSH")
            model = ""
            b = projections.get(pid, {}).get(key)
            if b and "proj" in b:
                lean = "over" if b["proj"] > line else "under"
                model = f"projected {b['proj']:.1f} (leaned {lean})"
        print(f"{name:<20}{P.stat_label(key):<16}{line:>6g}{actual:>8}{g['minutes']:>5.0f}   {result:<22}{model}")
    print("\nAnalysis only, not betting advice.")


if __name__ == "__main__":
    main()
