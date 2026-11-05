import sqlite3
import sys
import unicodedata
from pathlib import Path

import pandas as pd

DB_PATH = Path(__file__).parent / "nba.db"
if not DB_PATH.exists():
    sys.exit(f"No database found at {DB_PATH}. Run ingest.py first.")


def strip_accents(text):
    """'Dončić' -> 'doncic' (lowercase, accents removed) so searches match."""
    if text is None:
        return ""
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


conn = sqlite3.connect(DB_PATH)
conn.create_function("strip_accents", 1, strip_accents)
pd.set_option("display.width", 140)
pd.set_option("display.max_columns", 20)


def q(sql, params=()):
    return pd.read_sql_query(sql, conn, params=params)


print("\n== Teams (expect 30) ==")
print(q("SELECT COUNT(*) AS teams FROM teams"))

print("\n== Per season ==")
print(q("""
    SELECT season,
           COUNT(DISTINCT game_id)   AS games,
           COUNT(*)                  AS player_games,
           COUNT(DISTINCT player_id) AS players,
           MIN(game_date)            AS first_game,
           MAX(game_date)            AS last_game
    FROM player_game_stats
    GROUP BY season
"""))

print("\n== Games that don't have exactly 2 teams (expect none) ==")
print(q("""
    SELECT game_id, COUNT(DISTINCT team_id) AS teams
    FROM player_game_stats
    GROUP BY game_id
    HAVING COUNT(DISTINCT team_id) <> 2
"""))

print("\n== Minutes sanity ==")
print(q("""
    SELECT SUM(minutes IS NULL) AS null_minutes,
           MIN(minutes)         AS min_minutes,
           MAX(minutes)         AS max_minutes
    FROM player_game_stats
"""))

name = sys.argv[1] if len(sys.argv) > 1 else "Gilgeous-Alexander"
print(f"\n== Last 10 games for names matching '{name}' ==")
last10 = q("""
    SELECT p.name, s.game_date, t.abbr AS opp, s.is_home AS home,
           s.minutes AS min, s.pts, s.reb, s.ast, s.fg3m
    FROM player_game_stats s
    JOIN players p ON p.player_id = s.player_id
    JOIN teams   t ON t.team_id   = s.opp_team_id
    WHERE strip_accents(p.name) LIKE ?
    ORDER BY s.game_date DESC
    LIMIT 10
""", (f"%{strip_accents(name)}%",))
print(last10)

if not last10.empty:
    print("\nAverages over those games:")
    print(last10[["min", "pts", "reb", "ast", "fg3m"]].mean().round(1))
else:
    print("No players matched that name. Try part of the last name.")

conn.close()