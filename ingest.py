import argparse
import sqlite3
import time
from pathlib import Path

from nba_api.stats.endpoints import leaguegamelog

DB_PATH = Path(__file__).parent / "nba.db"
SEASONS = ["2024-25", "2025-26", "2026-27"]
CURRENT_SEASON = "2026-27"

SCHEMA = """
CREATE TABLE IF NOT EXISTS teams (
    team_id INTEGER PRIMARY KEY,
    abbr    TEXT NOT NULL,
    name    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
    player_id INTEGER PRIMARY KEY,
    name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
    game_id      TEXT PRIMARY KEY,
    game_date    TEXT NOT NULL,
    season       TEXT NOT NULL,
    home_team_id INTEGER NOT NULL,
    away_team_id INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_game_stats (
    player_id   INTEGER NOT NULL,
    game_id     TEXT    NOT NULL,
    game_date   TEXT    NOT NULL,
    season      TEXT    NOT NULL,
    team_id     INTEGER NOT NULL,
    opp_team_id INTEGER NOT NULL,
    is_home     INTEGER NOT NULL,
    wl          TEXT,
    minutes     REAL,
    pts         INTEGER,
    reb         INTEGER,
    ast         INTEGER,
    fg3m        INTEGER,
    fg3a        INTEGER,
    stl         INTEGER,
    blk         INTEGER,
    tov         INTEGER,
    fgm         INTEGER,
    fga         INTEGER,
    ftm         INTEGER,
    fta         INTEGER,
    oreb        INTEGER,
    dreb        INTEGER,
    pf          INTEGER,
    plus_minus  INTEGER,
    PRIMARY KEY (player_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_pgs_player_date
    ON player_game_stats (player_id, game_date);
"""

# Order must match the column order of player_game_stats above.
STAT_COLUMNS = [
    "PLAYER_ID", "GAME_ID", "GAME_DATE", "season", "TEAM_ID", "opp_team_id",
    "is_home", "WL", "MIN", "PTS", "REB", "AST", "FG3M", "FG3A", "STL", "BLK",
    "TOV", "FGM", "FGA", "FTM", "FTA", "OREB", "DREB", "PF", "PLUS_MINUS",
]


def fetch_season(season, retries=4):
    """Pull every player's game log for one season, retrying if NBA.com flakes."""
    for attempt in range(1, retries + 1):
        try:
            log = leaguegamelog.LeagueGameLog(
                season=season,
                player_or_team_abbreviation="P",
                timeout=60,
            )
            return log.get_data_frames()[0]
        except Exception as e:
            print(f"  attempt {attempt} failed: {e}")
            if attempt == retries:
                raise
            wait = 5 * attempt
            print(f"  retrying in {wait}s...")
            time.sleep(wait)


def prepare(df, season):
    df = df.copy()
    df["season"] = season
    # "HOU vs. DEN" = home game, "HOU @ DEN" = away game
    df["is_home"] = df["MATCHUP"].str.contains("vs.", regex=False).astype(int)
    df["opp_abbr"] = df["MATCHUP"].str.split().str[-1]
    abbr_to_id = dict(zip(df["TEAM_ABBREVIATION"], df["TEAM_ID"]))
    df["opp_team_id"] = df["opp_abbr"].map(abbr_to_id)
    if df["opp_team_id"].isna().any():
        bad = df.loc[df["opp_team_id"].isna(), "MATCHUP"].unique()[:5]
        raise ValueError(f"Could not resolve opponent for matchups like: {bad}")
    df["opp_team_id"] = df["opp_team_id"].astype(int)
    return df


def to_rows(frame):
    """DataFrame -> list of plain Python tuples (NaN becomes NULL)."""
    clean = frame.astype(object).where(frame.notna(), None)
    return [tuple(r) for r in clean.values.tolist()]


def save(conn, df):
    teams = df[["TEAM_ID", "TEAM_ABBREVIATION", "TEAM_NAME"]].drop_duplicates("TEAM_ID")
    players = df[["PLAYER_ID", "PLAYER_NAME"]].drop_duplicates("PLAYER_ID")
    home_rows = df[df["is_home"] == 1].drop_duplicates("GAME_ID")
    games = home_rows[["GAME_ID", "GAME_DATE", "season", "TEAM_ID", "opp_team_id"]]
    stats = df[STAT_COLUMNS]

    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO teams VALUES (?, ?, ?)", to_rows(teams))
        conn.executemany(
            "INSERT OR REPLACE INTO players VALUES (?, ?)", to_rows(players))
        conn.executemany(
            "INSERT OR REPLACE INTO games VALUES (?, ?, ?, ?, ?)", to_rows(games))
        placeholders = ", ".join(["?"] * len(STAT_COLUMNS))
        conn.executemany(
            f"INSERT OR REPLACE INTO player_game_stats VALUES ({placeholders})",
            to_rows(stats))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", action="store_true",
                        help="only refresh the current season (daily update)")
    args = parser.parse_args()

    seasons = [CURRENT_SEASON] if args.current else SEASONS
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)

    for season in seasons:
        print(f"Fetching {season}...")
        raw = fetch_season(season)
        if raw.empty:
            print(f"  no rows for {season} yet, skipping")
            continue
        df = prepare(raw, season)
        save(conn, df)
        print(f"  saved {len(df)} player-game rows")
        time.sleep(2)

    total = conn.execute("SELECT COUNT(*) FROM player_game_stats").fetchone()[0]
    print(f"Done. player_game_stats now has {total} rows.")
    print(f"Database file: {DB_PATH}")
    conn.close()


if __name__ == "__main__":
    main()