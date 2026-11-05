"""
score_night.py - grade a night's projections against what actually happened.

Steps (after the games are over):

  1. Save the pre-game files BEFORE you rebuild anything:
       mkdir archive
       copy site\\slate.json archive\\slate-2026-11-04.json
       copy site\\injuries.json archive\\injuries-2026-11-04.json
  2. Pull the results:           python ingest.py --current
  3. Grade the night:            python score_night.py --slate archive\\slate-2026-11-04.json --injuries archive\\injuries-2026-11-04.json

Do NOT run build_slate.py or fetch_injuries.py between 1 and 3: they would overwrite the pre-game
projections and statuses with ones that already know the answer.

It prints accuracy, who surprised, whether the injury list was right, and whether players with a
teammate out did better than projected. It also saves archive\\scores-<date>.csv so a record builds up.
"""

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

import project as P

HERE = Path(__file__).parent
DEFAULT_STATS = ["pts", "reb", "ast", "pra", "fg3m"]


def norm_name(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def status_kind(status):
    s = (status or "").lower()
    if "out" in s:
        return "out"
    if "doubtful" in s:
        return "doubtful"
    if "question" in s:
        return "questionable"
    if "day" in s:
        return "day-to-day"
    if "probable" in s or "available" in s:
        return "probable"
    return "other"


def main():
    ap = argparse.ArgumentParser(description="Grade a night's projections.")
    ap.add_argument("--slate", default=str(HERE / "site" / "slate.json"), help="the PRE-GAME slate.json")
    ap.add_argument("--injuries", default=str(HERE / "site" / "injuries.json"), help="the PRE-GAME injuries.json")
    ap.add_argument("--stats", default=",".join(DEFAULT_STATS), help="stats to grade (default pts,reb,ast,pra,fg3m)")
    ap.add_argument("--db", default=str(P.DB_PATH))
    ap.add_argument("--no-save", action="store_true", help="don't write the scores CSV")
    args = ap.parse_args()

    slate = json.load(open(args.slate, encoding="utf-8"))
    meta = slate["meta"]
    day = meta["slate_date"]
    if meta["data_through"] >= day:
        print(f"! This slate says its data goes through {meta['data_through']}, which is not before {day}.\n"
              f"  It was probably rebuilt after the games, so it already knew the results. Scores won't mean much.\n")

    injuries = {}
    if Path(args.injuries).exists():
        for e in json.load(open(args.injuries, encoding="utf-8")).get("players", []):
            injuries[norm_name(e["name"])] = e
    else:
        print("(No injuries file found, so the injury checks are skipped.)\n")

    game_ids = [g["game_id"] for g in slate["games"]]
    conn = sqlite3.connect(args.db)
    marks = ",".join("?" * len(game_ids))
    box = pd.read_sql_query(f"SELECT * FROM player_game_stats WHERE game_id IN ({marks})", conn, params=game_ids)
    conn.close()
    if box.empty:
        sys.exit("No results in the database for these games yet. Run: python ingest.py --current")
    done = box["game_id"].nunique()
    print(f"Slate {day}: results found for {done} of {len(game_ids)} games.\n")
    box = box.set_index("player_id")
    for key, (_, coefs) in P.STATS.items():
        box[key] = sum(c * box[col].fillna(0) for col, c in coefs.items())

    stat_keys = [P.resolve_stat(s.strip()) for s in args.stats.split(",")]
    finished = set(box["game_id"])
    players = [p for p in slate["players"] if p["game_id"] in finished]

    out_teammates = {}
    for p in players:
        e = injuries.get(norm_name(p["name"]))
        if e and status_kind(e["status"]) == "out" and p["avg_min"] >= 20:
            out_teammates.setdefault(p["team"], []).append(p["name"])

    rows, listed_out, no_show = [], [], []
    for p in players:
        e = injuries.get(norm_name(p["name"]))
        kind = status_kind(e["status"]) if e else "none"
        mine = box.loc[p["id"]] if p["id"] in box.index else None
        played = mine is not None and mine["game_id"] == p["game_id"] and mine["minutes"] >= P.MIN_MINUTES
        if kind == "out":
            listed_out.append((p, mine, played))
            continue
        if not played:
            no_show.append((p, kind, e))
            continue
        tm_out = [n for n in out_teammates.get(p["team"], []) if n != p["name"]]
        for key in stat_keys:
            b = p["stats"].get(key)
            if not b or "proj" not in b:
                continue
            rows.append(dict(date=day, player=p["name"], team=p["team"], stat=key, proj=b["proj"], sd=b["sd"],
                             lo=b["lo"], hi=b["hi"], actual=float(mine[key]), proj_min=p["min"],
                             act_min=float(mine["minutes"]), status=kind, teammate_out=bool(tm_out)))
    if not rows:
        sys.exit("No projections could be matched to results.")
    df = pd.DataFrame(rows)

    # ---- accuracy ----
    print(f"ACCURACY  ({df['player'].nunique()} players who played and were not listed out)")
    print(f"{'':<16}{'n':>5}{'avg':>7}{'bias':>7}{'MAE':>7}{'cover50':>9}{'cover80':>9}")
    for key in stat_keys:
        g = df[df["stat"] == key]
        if g.empty:
            continue
        err = g["proj"] - g["actual"]
        z = (g["actual"] - g["proj"]).abs() / g["sd"]
        inside = ((g["actual"] >= g["lo"]) & (g["actual"] <= g["hi"])).mean()
        print(f"{P.STATS[key][0]:<16}{len(g):>5}{g['actual'].mean():>7.1f}{err.mean():>+7.2f}{err.abs().mean():>7.2f}"
              f"{inside:>9.0%}{(z <= 1.282).mean():>9.0%}")
    mins = df.drop_duplicates("player")
    print(f"Minutes: projected {mins['proj_min'].mean():.1f} vs actual {mins['act_min'].mean():.1f} on average.")
    print("One night is a small, noisy sample. Expect the numbers to bounce around.\n")

    # ---- biggest surprises (first stat) ----
    first = stat_keys[0]
    g = df[df["stat"] == first].copy()
    g["miss"] = g["actual"] - g["proj"]
    print(f"BIGGEST SURPRISES ({P.STATS[first][0]})")
    for title, part in (("Beat the projection", g.nlargest(5, "miss")), ("Fell short", g.nsmallest(5, "miss"))):
        print(f"  {title}:")
        for r in part.itertuples():
            print(f"    {r.player:<24}{r.team}  projected {r.proj:5.1f}, got {r.actual:5.1f}   "
                  f"(minutes {r.proj_min:.0f} projected, {r.act_min:.0f} played)")
    print()

    # ---- injury checks ----
    if injuries:
        print("INJURY LIST CHECK")
        played_out = [(p, m) for p, m, pl in listed_out if pl]
        print(f"  Listed out: {len(listed_out)}. Played anyway: {len(played_out)}.")
        for p, m in played_out:
            print(f"    {p['name']} ({p['team']}) was listed out but played {m['minutes']:.0f} minutes.")
        surprise = [(p, k) for p, k, e in no_show if k in ("none", "probable", "other")]
        print(f"  Did not play although not listed out (or listed probable): {len(surprise)}.")
        for p, k in surprise[:10]:
            print(f"    {p['name']} ({p['team']}), status: {k}")
        flagged = [(p, k) for p, k, e in no_show if k in ("questionable", "doubtful", "day-to-day")]
        gtd = df[df["status"].isin(["questionable", "doubtful", "day-to-day"])]["player"].nunique()
        print(f"  Listed questionable/doubtful/day-to-day: {gtd} played, {len(flagged)} did not.")
        print()

        # ---- teammate-out effect ----
        g = df[df["stat"] == first]
        a, b = g[g["teammate_out"]], g[~g["teammate_out"]]
        if len(a) >= 5:
            print(f"TEAMMATE-OUT EFFECT ({P.STATS[first][0]}, actual minus projection)")
            print(f"  Players with a rotation teammate out: {len(a)} players, "
                  f"average {(a['actual'] - a['proj']).mean():+.2f} (minutes {(a['act_min'] - a['proj_min']).mean():+.1f}).")
            print(f"  Everyone else:                        {len(b)} players, "
                  f"average {(b['actual'] - b['proj']).mean():+.2f} (minutes {(b['act_min'] - b['proj_min']).mean():+.1f}).")
            print("  A clearly positive first line would mean the projection should add something when a teammate sits.")
            print("  One night is too little to conclude; keep archiving and check again after a couple of weeks.\n")

    if not args.no_save:
        out = HERE / "archive" / f"scores-{day}.csv"
        out.parent.mkdir(exist_ok=True)
        df.to_csv(out, index=False)
        print(f"Saved {out}")
    print("Analysis only, not betting advice.")


if __name__ == "__main__":
    main()
