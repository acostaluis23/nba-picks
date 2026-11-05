"""
export_results.py - write site/results.json: the final stats of every finished game on the slate.

The website reads this file to show "Final: 52" on the cards. It is cheap to run, so results.ps1 runs it
every 20 minutes in the evening (after pulling fresh box scores with ingest.py --current).

    python export_results.py                  # uses site\\slate.json and nba.db
    python export_results.py --slate X.json   # for another slate

A player who is not in the file but whose game is listed as final did not play.
"""

import argparse
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path

import pandas as pd

import project as P

HERE = Path(__file__).parent
CAT_COLS = ["pts", "reb", "ast", "stl", "blk"]


def num(x):
    """Whole numbers stay whole; everything else gets one decimal. NaN becomes 0."""
    x = float(x) if pd.notna(x) else 0.0
    return int(x) if x == int(x) else round(x, 1)


def build_results(conn, slate):
    """Return {"meta": {...}, "players": {player_id: {stat: value, "m": minutes, "dd": 0/1, "td": 0/1}}}."""
    game_ids = [g["game_id"] for g in slate["games"]]
    marks = ",".join("?" * len(game_ids))
    box = pd.read_sql_query(f"SELECT * FROM player_game_stats WHERE game_id IN ({marks})", conn, params=game_ids)
    final = sorted(set(box["game_id"])) if not box.empty else []
    players = {}
    for row in box.to_dict("records"):
        out = {"m": num(row["minutes"])}
        for key, (_, coefs) in P.STATS.items():
            out[key] = num(sum(c * (row.get(col) if pd.notna(row.get(col)) else 0) for col, c in coefs.items()))
        cats = sum(1 for c in CAT_COLS if pd.notna(row.get(c)) and row.get(c) >= 10)
        out["dd"] = int(cats >= 2)
        out["td"] = int(cats >= 3)
        players[str(int(row["player_id"]))] = out
    meta = dict(slate_date=slate["meta"]["slate_date"],
                generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                games_final=final, games_total=len(game_ids), all_final=len(final) >= len(game_ids))
    return {"meta": meta, "players": players}


def main():
    ap = argparse.ArgumentParser(description="Write results.json for the website.")
    ap.add_argument("--slate", default=str(HERE / "site" / "slate.json"))
    ap.add_argument("--db", default=str(P.DB_PATH))
    ap.add_argument("--out", default=str(HERE / "site" / "results.json"))
    args = ap.parse_args()

    slate = json.load(open(args.slate, encoding="utf-8"))
    conn = sqlite3.connect(args.db)
    res = build_results(conn, slate)
    conn.close()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(res, f, separators=(",", ":"), allow_nan=False)
    m = res["meta"]
    print(f"Results for {m['slate_date']}: {len(m['games_final'])} of {m['games_total']} games final, "
          f"{len(res['players'])} players. Saved {args.out}")
    # results.ps1 reads this last line to know whether to grade the night.
    print("ALL_FINAL" if m["all_final"] else "NOT_ALL_FINAL")


if __name__ == "__main__":
    main()
