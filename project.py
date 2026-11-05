"""
project.py - NBA player prop projections (all stat categories).

Examples (run from the nba-picks folder with the virtual environment active):

  python project.py "Luka Doncic" --stat pts --line 33.5 --at SAC
  python project.py "Tyrese Maxey" --stat pra --line 32 --at DET --book-line 31.5
  python project.py "Jaylen Brown" --stat pts --line 14.5 --at DET --no-last-season
  python project.py "Nikola Jokic" --stat td --vs POR
  python project.py --batch picks.csv --out results.csv
  python project.py --list-stats

"At" means the player's team is the visitor ("@ SAC" in the app).
"Vs" means the player's team is home ("vs DET" in the app).

This file is also importable (the future web page will use run_pick).
"""

import argparse
import csv
import datetime as dt
import math
import sqlite3
import sys
import unicodedata
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd

DB_PATH = Path(__file__).parent / "nba.db"
CURRENT_SEASON = "2026-27"
LAST_SEASON = "2025-26"

# ======================= Tunable settings =======================
# These are starting guesses. A backtest will tell us better values.
MIN_MINUTES = 8            # ignore games under this (DNPs, garbage time)
RECENT_GAMES = 10          # recent games used for minutes and per-minute rate
HALF_LIFE = 4              # a game 4 games ago counts half as much as the latest
RATE_PRIOR_GAMES = 10      # weight on this season's rate = n / (n + 10)
TEAM_CHANGE_PRIOR_MULT = 0.5   # if a player changed teams, last season counts half as much
TEAM_PRIOR_GAMES = 15      # same idea for team pace and defense
CONTEXT_SHRINK = 0.5       # only apply half of the opponent and pace effects
B2B_MINUTES = 1.5          # minutes cut on the second night of a back-to-back
HOME_BOOST = 0.01          # +1% home, -1% away
SD_WINDOW = 20             # games used to measure game-to-game variation
SD_MULT = 1.15             # small nudge up for minutes uncertainty
DISP_PRIOR = 1.3           # prior: variance is at least 1.3 x the mean for count stats
CV_PRIOR = 0.30            # prior: standard deviation is at least 30% of the mean
BREAK_EVEN = 0.577         # win rate needed per pick. CHECK your app's payout table.
LEAN_EDGE = 0.03           # show a lean only if the edge beats break-even by this much
BOOK_WEIGHT = 0.5          # with --book-line, how far to pull the projection toward it
BLOWOUT_FREE_SPREAD = 8.0  # --spread: no minutes cut up to this point spread
BLOWOUT_MIN_PER_POINT = 0.35   # minutes cut per spread point beyond that
BLOWOUT_MAX_CUT = 4.0      # cap on the blowout minutes cut
MIN_CURRENT_GAMES_NO_PRIOR = 3  # --no-last-season needs at least this many games
N_SIMS = 20000             # simulations for double-double / triple-double
MINUTES_SHOCK_SD = 0.08    # shared game-to-game minutes swing in the simulation
# Fantasy score weights. Many apps use these; CHECK your app's scoring rules.
FANTASY_WEIGHTS = {"pts": 1.0, "reb": 1.2, "ast": 1.5, "stl": 3.0, "blk": 3.0, "tov": -1.0}
# =================================================================

BASE_COLS = ["pts", "reb", "ast", "fg3m", "fg3a", "stl", "blk", "tov",
             "fgm", "fga", "ftm", "fta", "oreb", "dreb", "pf"]

# key: (label, {base column: coefficient})
STATS = {
    "pts":     ("Points", {"pts": 1}),
    "reb":     ("Rebounds", {"reb": 1}),
    "ast":     ("Assists", {"ast": 1}),
    "pra":     ("Pts+Rebs+Asts", {"pts": 1, "reb": 1, "ast": 1}),
    "pr":      ("Pts+Rebs", {"pts": 1, "reb": 1}),
    "pa":      ("Pts+Asts", {"pts": 1, "ast": 1}),
    "ra":      ("Rebs+Asts", {"reb": 1, "ast": 1}),
    "fantasy": ("Fantasy Score", FANTASY_WEIGHTS),
    "fgm":     ("FG Made", {"fgm": 1}),
    "fga":     ("FG Attempted", {"fga": 1}),
    "fg3m":    ("3-PT Made", {"fg3m": 1}),
    "fg3a":    ("3-PT Attempted", {"fg3a": 1}),
    "fg2m":    ("Two Pointers Made", {"fgm": 1, "fg3m": -1}),
    "fg2a":    ("Two Pointers Attempted", {"fga": 1, "fg3a": -1}),
    "ftm":     ("Free Throws Made", {"ftm": 1}),
    "fta":     ("Free Throws Attempted", {"fta": 1}),
    "oreb":    ("Offensive Rebounds", {"oreb": 1}),
    "dreb":    ("Defensive Rebounds", {"dreb": 1}),
    "tov":     ("Turnovers", {"tov": 1}),
    "pf":      ("Personal Fouls", {"pf": 1}),
    "stl":     ("Steals", {"stl": 1}),
    "blk":     ("Blocked Shots", {"blk": 1}),
    "stl_blk": ("Blks+Stls", {"stl": 1, "blk": 1}),
}
SPECIAL = {"dd": "Double Double", "td": "Triple Double"}
DD_STATS = ("pts", "reb", "ast", "stl", "blk")

ALIASES = {
    "points": "pts", "point": "pts", "pts": "pts",
    "rebounds": "reb", "rebound": "reb", "rebs": "reb", "reb": "reb",
    "assists": "ast", "assist": "ast", "asts": "ast", "ast": "ast",
    "pra": "pra", "pr": "pr", "pa": "pa", "ra": "ra",
    "fantasy": "fantasy", "fantasyscore": "fantasy", "fs": "fantasy",
    "fgmade": "fgm", "fgm": "fgm", "fieldgoalsmade": "fgm",
    "fgattempted": "fga", "fga": "fga", "fieldgoalsattempted": "fga",
    "3ptmade": "fg3m", "3pm": "fg3m", "fg3m": "fg3m", "threes": "fg3m",
    "threesmade": "fg3m", "3pointersmade": "fg3m",
    "3ptattempted": "fg3a", "3pa": "fg3a", "fg3a": "fg3a", "threesattempted": "fg3a",
    "twopointersmade": "fg2m", "2pm": "fg2m", "fg2m": "fg2m", "2ptmade": "fg2m",
    "twopointersattempted": "fg2a", "2pa": "fg2a", "fg2a": "fg2a", "2ptattempted": "fg2a",
    "freethrowsmade": "ftm", "ftm": "ftm",
    "freethrowsattempted": "fta", "fta": "fta",
    "offensiverebounds": "oreb", "oreb": "oreb",
    "defensiverebounds": "dreb", "dreb": "dreb",
    "turnovers": "tov", "turnover": "tov", "tov": "tov", "to": "tov",
    "personalfouls": "pf", "fouls": "pf", "pf": "pf",
    "steals": "stl", "stl": "stl", "stls": "stl",
    "blockedshots": "blk", "blocks": "blk", "blk": "blk", "blks": "blk",
    "stlblk": "stl_blk",
    "doubledouble": "dd", "dd": "dd", "tripledouble": "td", "td": "td",
    "dunks": "dunks", "dunk": "dunks",
}
COMBO_PARTS = {
    "pts": "pts", "points": "pts", "pt": "pts",
    "reb": "reb", "rebs": "reb", "rebounds": "reb",
    "ast": "ast", "asts": "ast", "assists": "ast",
    "stl": "stl", "stls": "stl", "steals": "stl",
    "blk": "blk", "blks": "blk", "blocks": "blk",
}
COMBOS = {
    frozenset(["pts", "reb", "ast"]): "pra",
    frozenset(["pts", "reb"]): "pr",
    frozenset(["pts", "ast"]): "pa",
    frozenset(["reb", "ast"]): "ra",
    frozenset(["stl", "blk"]): "stl_blk",
}
TEAM_ALIASES = {"BRK": "BKN", "PHO": "PHX", "NO": "NOP", "NOR": "NOP", "GS": "GSW",
                "SA": "SAS", "NY": "NYK", "UTAH": "UTA", "WSH": "WAS", "CHO": "CHA"}
WHERE_ALIASES = {"home": "home", "h": "home", "vs": "home", "vs.": "home",
                 "away": "away", "a": "away", "at": "away", "@": "away", "road": "away"}


class PickError(Exception):
    """A problem the user can fix (bad name, missing data...). Shown without a traceback."""


# ----------------------------- helpers -----------------------------

def strip_accents(text):
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def recency_weights(n):
    ages = np.arange(n)[::-1]            # most recent game has age 0
    return 0.5 ** (ages / HALF_LIFE)


def resolve_stat(text):
    """Turn what you type ('points', 'PRA', 'pts+rebs', '3-pt made') into a stat key."""
    t = str(text).lower().replace(" ", "").replace("-", "").replace("_", "").replace(".", "")
    if "+" in t:
        parts = [COMBO_PARTS.get(p) for p in t.split("+")]
        if None not in parts and len(parts) == len(set(parts)) and frozenset(parts) in COMBOS:
            return COMBOS[frozenset(parts)]
        raise PickError(f"Don't recognize the combo '{text}'. Run --list-stats to see what's supported.")
    key = ALIASES.get(t)
    if key is None:
        raise PickError(f"Unknown stat '{text}'. Run --list-stats to see what's supported.")
    if key == "dunks":
        raise PickError("Dunks aren't supported: the NBA.com game logs we pull don't include dunk counts.")
    return key


def stat_label(key):
    return STATS[key][0] if key in STATS else SPECIAL[key]


def parse_where(opp, where):
    """Accepts '@SAC', 'vs DET', or opp + where. Returns (ABBR, 'home'|'away')."""
    o = str(opp).strip()
    inferred = None
    low = o.lower()
    if low.startswith("@"):
        inferred, o = "away", o[1:]
    elif low.startswith("vs."):
        inferred, o = "home", o[3:]
    elif low.startswith("vs "):
        inferred, o = "home", o[3:]
    elif low.startswith("at "):
        inferred, o = "away", o[3:]
    abbr = o.strip().upper()
    abbr = TEAM_ALIASES.get(abbr, abbr)
    w = None
    if where:
        w = WHERE_ALIASES.get(str(where).strip().lower())
        if w is None:
            raise PickError(f"Don't understand where='{where}'. Use home or away.")
    w = w or inferred
    if w is None:
        raise PickError("Say whether the player's team is home or away (--at TEAM, --vs TEAM, or --where).")
    return abbr, w


# ----------------------------- data loading -----------------------------

def build_team_stats(pgs):
    """Per team-season: pace and how much of each stat their opponents produce (vs league)."""
    stat_cols = list(STATS.keys())
    agg = pgs.groupby(["game_id", "season", "team_id", "opp_team_id"], as_index=False)[stat_cols].sum()
    agg["poss"] = agg["fga"] + 0.44 * agg["fta"] + agg["tov"] - agg["oreb"]

    opp = agg[["game_id", "team_id", "poss"] + stat_cols].copy()
    opp = opp.rename(columns={"team_id": "opp_team_id", "poss": "opp_poss",
                              **{c: "opp_" + c for c in stat_cols}})
    tg = agg.merge(opp, on=["game_id", "opp_team_id"])
    tg["game_poss"] = (tg["poss"] + tg["opp_poss"]) / 2

    spec = {"games": ("game_id", "count"), "pace": ("game_poss", "mean"),
            "poss": ("game_poss", "sum")}
    for c in stat_cols:
        spec["allowed_" + c] = ("opp_" + c, "sum")
    ts = tg.groupby(["season", "team_id"]).agg(**spec).reset_index()

    cols = ["poss"] + ["allowed_" + c for c in stat_cols]
    league = ts.groupby("season")[cols].transform("sum")
    for c in stat_cols:
        team_rate = ts["allowed_" + c] / ts["poss"]
        league_rate = league["allowed_" + c] / league["poss"]
        ts["ratio_" + c] = (team_rate / league_rate).replace([np.inf, -np.inf], np.nan).fillna(1.0)
    ts["league_pace"] = ts.groupby("season")["pace"].transform("mean")
    return ts.set_index(["season", "team_id"])


def load_context(db_path=None):
    db_path = Path(db_path) if db_path else DB_PATH
    if not db_path.exists():
        raise PickError(f"No database at {db_path}. Run ingest.py first.")
    conn = sqlite3.connect(db_path)
    try:
        pgs = pd.read_sql_query("SELECT * FROM player_game_stats", conn)
        players = pd.read_sql_query("SELECT player_id, name FROM players", conn)
        teams = pd.read_sql_query("SELECT team_id, abbr, name FROM teams", conn)
    finally:
        conn.close()
    if pgs.empty:
        raise PickError("The database is empty. Run ingest.py first.")

    pgs[BASE_COLS] = pgs[BASE_COLS].fillna(0)
    pgs["minutes"] = pgs["minutes"].fillna(0)
    for key, (_, coefs) in STATS.items():
        if key not in pgs.columns:
            pgs[key] = sum(c * pgs[col] for col, c in coefs.items())
    pgs = pgs.sort_values(["game_date", "game_id"]).reset_index(drop=True)

    latest = pgs.groupby("player_id").tail(1).set_index("player_id")
    cur_counts = pgs[(pgs["season"] == CURRENT_SEASON) & (pgs["minutes"] >= MIN_MINUTES)] \
        .groupby("player_id").size()
    players = players[players["player_id"].isin(latest.index)].copy()
    players["norm"] = players["name"].map(strip_accents)
    players["team_id"] = players["player_id"].map(latest["team_id"])
    players["cur_games"] = players["player_id"].map(cur_counts).fillna(0).astype(int)

    return SimpleNamespace(
        pgs=pgs, players=players, teams=teams,
        abbr_to_id=dict(zip(teams["abbr"], teams["team_id"])),
        id_to_abbr=dict(zip(teams["team_id"], teams["abbr"])),
        ts=build_team_stats(pgs),
        last_date=str(pgs["game_date"].max()),
    )


def find_player(ctx, query):
    q = strip_accents(query).strip()
    if not q:
        raise PickError("Player name is empty.")
    p = ctx.players
    hits = p[p["norm"] == q]
    if len(hits) != 1:
        hits = p[p["norm"].str.contains(q, regex=False)]
    if len(hits) == 0:
        tokens = q.split()
        mask = np.ones(len(p), dtype=bool)
        for t in tokens:
            mask &= p["norm"].str.contains(t, regex=False).values
        hits = p[mask]
    if len(hits) == 0:
        raise PickError(f"No player found matching '{query}'.")
    if len(hits) > 1:
        hits = hits.sort_values("cur_games", ascending=False)
        opts = ", ".join(f"{r.name} ({ctx.id_to_abbr.get(r.team_id, '?')}, {r.cur_games} g)"
                         for r in hits.head(12).itertuples())
        raise PickError(f"'{query}' matches several players: {opts}. Be more specific.")
    row = hits.iloc[0]
    return int(row["player_id"]), row["name"]


# ----------------------------- team context -----------------------------

def team_value(ctx, season, team_id, col):
    try:
        return float(ctx.ts.loc[(season, team_id), col])
    except KeyError:
        return None


def team_games(ctx, season, team_id):
    v = team_value(ctx, season, team_id, "games")
    return int(v) if v is not None else 0


def shrunk_team_value(ctx, team_id, col, prior_default, use_last):
    """Blend this season's team number toward last season's (or the league average)."""
    cur = team_value(ctx, CURRENT_SEASON, team_id, col)
    n = team_games(ctx, CURRENT_SEASON, team_id)
    prior = None
    if use_last:
        prior = team_value(ctx, LAST_SEASON, team_id, col)
    if prior is None:
        prior = prior_default
    if cur is None or n == 0:
        return prior
    w = n / (n + TEAM_PRIOR_GAMES)
    return w * cur + (1 - w) * prior


def league_pace(ctx, use_last):
    for season in ([CURRENT_SEASON, LAST_SEASON] if use_last else [CURRENT_SEASON]):
        try:
            return float(ctx.ts.xs(season, level="season")["pace"].mean())
        except KeyError:
            continue
    return 100.0


# ----------------------------- probability engines -----------------------------

def make_cdf(mu, var):
    """Returns (F, pmf_at, engine_name, sd). F(k) = P(X <= k) for whole numbers k."""
    mu = max(float(mu), 0.01)
    var = max(float(var), 0.05)
    if mu < 25 and var > mu * 1.02:
        r = mu * mu / (var - mu)
        p = r / (r + mu)
        kmax = int(mu + 12 * math.sqrt(var) + 25)
        ks = np.arange(kmax + 1)
        logpmf = np.array([math.lgamma(k + r) - math.lgamma(r) - math.lgamma(k + 1) for k in ks])
        logpmf = logpmf + r * math.log(p) + ks * math.log(1 - p)
        pmf = np.exp(logpmf)
        pmf = pmf / pmf.sum()
        cdf = np.cumsum(pmf)

        def F(k):
            if k < 0:
                return 0.0
            if k >= kmax:
                return 1.0
            return float(cdf[int(k)])

        def pmf_at(k):
            return float(pmf[int(k)]) if 0 <= k <= kmax else 0.0

        return F, pmf_at, "negative binomial", math.sqrt(var)

    sd = math.sqrt(var)
    lo = norm_cdf((-0.5 - mu) / sd)

    def F(k):
        if k < 0:
            return 0.0
        return (norm_cdf((k + 0.5 - mu) / sd) - lo) / (1 - lo)

    def pmf_at(k):
        return F(k) - F(k - 1)

    return F, pmf_at, "normal", sd


def line_probs(F, pmf_at, line):
    p_over = 1 - F(math.floor(line))
    p_under = F(math.ceil(line) - 1)
    p_push = pmf_at(int(line)) if float(line).is_integer() else 0.0
    return max(p_over, 0.0), max(p_under, 0.0), max(p_push, 0.0)


def simulate_dd_td(proj, var, key, seed=12345):
    """Monte Carlo for double-double / triple-double using each stat's own distribution."""
    rng = np.random.default_rng(seed)
    shock = np.clip(rng.normal(1.0, MINUTES_SHOCK_SD, N_SIMS), 0.6, 1.4)
    draws = {}
    for s in DD_STATS:
        mu, v = max(proj[s], 0.01), max(var[s], 0.05)
        means = np.maximum(mu * shock, 0.001)
        if mu < 25 and v > mu * 1.02:
            r = mu * mu / (v - mu)
            draws[s] = rng.negative_binomial(r, r / (r + means))
        else:
            draws[s] = np.maximum(np.rint(rng.normal(means, math.sqrt(v))), 0)
    n_cats = sum((draws[s] >= 10).astype(int) for s in DD_STATS)
    need = 2 if key == "dd" else 3
    return float((n_cats >= need).mean())


# ----------------------------- the projection -----------------------------

def run_pick(ctx, player, stat="pts", line=None, opp=None, where=None, b2b=False,
             book_line=None, minutes=None, spread=None, use_last_season=True,
             prior_games=RATE_PRIOR_GAMES, breakeven=BREAK_EVEN, book_weight=BOOK_WEIGHT):
    key = resolve_stat(stat)
    binary = key in SPECIAL
    if not binary and line is None:
        raise PickError("A line is required for this stat (--line).")
    if opp is None:
        raise PickError("Opponent is required (--at TEAM or --vs TEAM).")
    abbr, where = parse_where(opp, where)
    if abbr not in ctx.abbr_to_id:
        raise PickError(f"Unknown team '{abbr}'. Valid: {', '.join(sorted(ctx.abbr_to_id))}")
    opp_id = int(ctx.abbr_to_id[abbr])

    pid, name = find_player(ctx, player)
    allg = ctx.pgs[(ctx.pgs["player_id"] == pid) & (ctx.pgs["minutes"] >= MIN_MINUTES)]
    cur = allg[allg["season"] == CURRENT_SEASON]
    last = allg[allg["season"] == LAST_SEASON]
    n_cur = len(cur)
    g = allg if use_last_season else cur
    if not use_last_season and n_cur < MIN_CURRENT_GAMES_NO_PRIOR:
        raise PickError(f"{name} has only {n_cur} usable game(s) this season; "
                        f"current-season-only mode needs {MIN_CURRENT_GAMES_NO_PRIOR}+. "
                        f"Turn off --no-last-season or wait a few games.")
    if len(g) < 3:
        raise PickError(f"Only {len(g)} usable games for {name}. Not enough to project.")

    team_id = int(g.iloc[-1]["team_id"])
    if opp_id == team_id:
        raise PickError("The opponent can't be the player's own team.")
    team_abbr = ctx.id_to_abbr.get(team_id, "?")

    warnings, notes = [], []
    changed = bool(use_last_season and n_cur > 0 and len(last) > 0
                   and int(last.iloc[-1]["team_id"]) != team_id)
    eff_prior = prior_games * (TEAM_CHANGE_PRIOR_MULT if changed else 1.0)
    if changed:
        warnings.append(f"{name} changed teams since last season, so last season's rate reflects a "
                        f"different role. It counts half as much here; --no-last-season ignores it entirely.")
    if n_cur < 5:
        warnings.append(f"Early season ({n_cur} games played): small sample, so treat this loosely.")
    if not use_last_season:
        notes.append("Current-season-only mode: last season is ignored.")
    if int(last.shape[0]) < 10 and use_last_season:
        notes.append("Fewer than 10 games last season: using this season's rate only.")

    # ---- minutes ----
    use_cur_minutes = (not use_last_season) or n_cur >= 5 or (changed and n_cur >= 3)
    window = cur.tail(RECENT_GAMES) if (use_cur_minutes and n_cur > 0) else g.tail(RECENT_GAMES)
    w = recency_weights(len(window))
    base_min = float((w * window["minutes"]).sum() / w.sum())
    proj_min = base_min
    if b2b:
        proj_min -= B2B_MINUTES
        notes.append(f"Back-to-back: minutes cut by {B2B_MINUTES}.")
    if spread is not None and base_min >= 24:
        cut = min(BLOWOUT_MAX_CUT, BLOWOUT_MIN_PER_POINT * max(0.0, abs(spread) - BLOWOUT_FREE_SPREAD))
        if cut > 0:
            proj_min -= cut
            notes.append(f"Blowout risk (spread {abs(spread):g}): minutes cut by {cut:.1f}. "
                         f"This adjustment is a rough guess.")
    if minutes is not None:
        proj_min = float(minutes)
        notes.append(f"Minutes set manually to {proj_min:g}.")
    proj_min = max(proj_min, 5.0)

    # ---- team context ----
    lg_pace = league_pace(ctx, use_last_season)
    my_pace = shrunk_team_value(ctx, team_id, "pace", lg_pace, use_last_season)
    opp_pace = shrunk_team_value(ctx, opp_id, "pace", lg_pace, use_last_season)
    expected_pace = (my_pace + opp_pace) / 2
    pace_factor = 1 + CONTEXT_SHRINK * (expected_pace / my_pace - 1)
    home_factor = 1 + HOME_BOOST if where == "home" else 1 - HOME_BOOST

    def project_stat(skey):
        rate_recent = None
        if n_cur > 0:
            rc = cur.tail(RECENT_GAMES)
            wr = recency_weights(len(rc))
            rate_recent = float((wr * rc[skey]).sum() / (wr * rc["minutes"]).sum())
        rate_base = None
        if use_last_season and len(last) >= 10:
            rate_base = float(last[skey].sum() / last["minutes"].sum())
        if rate_recent is None and rate_base is None:
            raise PickError(f"Not enough data to estimate a rate for {name}.")
        if rate_recent is None:
            rate, wt = rate_base, 0.0
        elif rate_base is None:
            rate, wt = rate_recent, 1.0
        else:
            wt = n_cur / (n_cur + eff_prior) if (n_cur + eff_prior) > 0 else 0.0
            rate = wt * rate_recent + (1 - wt) * rate_base
        opp_ratio = shrunk_team_value(ctx, opp_id, "ratio_" + skey, 1.0, use_last_season)
        opp_factor = 1 + CONTEXT_SHRINK * (opp_ratio - 1)
        proj = max(proj_min * rate * opp_factor * pace_factor * home_factor, 0.0)

        vals = g.tail(SD_WINDOW)[skey]
        var_prior = max(DISP_PRIOR * proj, (CV_PRIOR * proj) ** 2)
        if len(vals) >= 2:
            hist_mean = float(vals.mean())
            ratio = proj / hist_mean if hist_mean > 0 else 1.0
            ratio = min(max(ratio, 0.6), 1.6)
            # compromise between variance growing with the mean and with its square
            var_obs = float(vals.var(ddof=1)) * ratio ** 1.5
            wv = min(len(vals) / 15, 1.0)
            var = wv * var_obs + (1 - wv) * var_prior
        else:
            var = var_prior
        var = max(var * SD_MULT ** 2, 0.05)
        return dict(proj=proj, var=var, rate=rate, rate_recent=rate_recent, rate_base=rate_base,
                    weight=wt, opp_ratio=opp_ratio, opp_factor=opp_factor)

    result = dict(player=name, player_id=pid, team=team_abbr, opp=abbr, where=where,
                  stat=key, label=stat_label(key), line=line, n_cur=n_cur, n_last=len(last),
                  proj_min=proj_min, pace_factor=pace_factor, expected_pace=expected_pace,
                  home_factor=home_factor, b2b=b2b, use_last_season=use_last_season,
                  data_through=ctx.last_date, breakeven=breakeven, binary=binary,
                  book_line=book_line, minutes_override=minutes)

    # hint about a back-to-back the user may have forgotten
    try:
        team_last = str(ctx.pgs.loc[ctx.pgs["team_id"] == team_id, "game_date"].max())
        yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
        if team_last == yesterday and not b2b:
            notes.append(f"{team_abbr} played yesterday ({team_last}). If tonight's game is the next night, "
                         f"add --b2b.")
        if (dt.date.today() - dt.date.fromisoformat(ctx.last_date)).days >= 2:
            warnings.append(f"Data only goes through {ctx.last_date}. Run: python ingest.py --current")
    except (ValueError, TypeError):
        pass

    if binary:
        parts = {s: project_stat(s) for s in DD_STATS}
        proj = {s: parts[s]["proj"] for s in DD_STATS}
        var = {s: parts[s]["var"] for s in DD_STATS}
        p_yes = simulate_dd_td(proj, var, key)
        p_no = 1 - p_yes
        side, p_best = ("YES", p_yes) if p_yes >= p_no else ("NO", p_no)
        edge = p_best - breakeven
        comps = []
        for s in DD_STATS:
            F, _, _, _ = make_cdf(proj[s], var[s])
            comps.append((STATS[s][0], proj[s], 1 - F(9)))
        recent = g.tail(10)
        hist_hits = int(((recent[list(DD_STATS)] >= 10).sum(axis=1) >= (2 if key == "dd" else 3)).sum())
        result.update(p_yes=p_yes, p_no=p_no, side=side, p_best=p_best, edge=edge,
                      components=comps, hist_hits=hist_hits, hist_n=len(recent))
        notes.append("Double/triple doubles are rare events: check which side your app offers and its "
                     "real payout, since the break-even number may not apply.")
        if abs(edge) > 0.15:
            warnings.append("An edge this large is rare. Check injuries and lineup news first.")
        result.update(verdict=(f"LEAN {side}" if edge > LEAN_EDGE else "NO CLEAR EDGE"))
        result.update(warnings=warnings, notes=notes)
        return result

    info = project_stat(key)
    F, pmf_at, engine, sd = make_cdf(info["proj"], info["var"])
    p_over, p_under, p_push = line_probs(F, pmf_at, line)

    vals = g[key]
    last10 = vals.tail(10)
    cur_vals = cur[key]
    hit = dict(
        over10=int((last10 > line).sum()), under10=int((last10 < line).sum()),
        push10=int((last10 == line).sum()), n10=len(last10),
        over_cur=int((cur_vals > line).sum()), n_cur=len(cur_vals),
        last10_values=[round(float(v), 1) if key == "fantasy" else int(v) for v in last10],
    )

    adj = None
    if book_line is not None:
        blended = book_weight * book_line + (1 - book_weight) * info["proj"]
        Fb, pmfb, _, _ = make_cdf(blended, info["var"])
        a_over, a_under, a_push = line_probs(Fb, pmfb, line)
        gap = info["proj"] - book_line
        adj = dict(blended=blended, p_over=a_over, p_under=a_under, p_push=a_push,
                   gap=gap, gap_sd=gap / sd)
        if abs(gap) / sd >= 0.5:
            warnings.append(f"Model ({info['proj']:.1f}) and the sportsbook line ({book_line:g}) are "
                            f"{abs(gap):.1f} apart ({abs(gap) / sd:.1f} sd). The market may know something "
                            f"(injury, role, matchup). Lean on the market-adjusted numbers.")

    use = adj if adj else dict(p_over=p_over, p_under=p_under)
    side, p_best = ("OVER", use["p_over"]) if use["p_over"] >= use["p_under"] else ("UNDER", use["p_under"])
    edge = p_best - breakeven
    if abs(edge) > 0.15:
        warnings.append("An edge this large is rare on a main line. Check injury/lineup news, whether this "
                        "is a discounted or boosted line, and compare with a sportsbook (--book-line).")

    result.update(info=info, engine=engine, sd=sd, p_over=p_over, p_under=p_under, p_push=p_push,
                  adj=adj, hit=hit, side=side, p_best=p_best, edge=edge,
                  verdict=(f"LEAN {side}" if edge > LEAN_EDGE else "NO CLEAR EDGE"),
                  warnings=warnings, notes=notes)
    return result


# ----------------------------- printing -----------------------------

def pct(x):
    return f"{x:5.1%}"


def print_report(r):
    away = r["where"] == "away"
    header = f"{r['player']}  |  {r['label']}  |  {'at' if away else 'vs'} {r['opp']}"
    if not r["binary"]:
        header += f"  |  line {r['line']:g}"
    print("\n" + header)
    print("-" * max(60, len(header)))
    print(f"Data through {r['data_through']}. Games used: {r['n_cur']} this season"
          + (f", {r['n_last']} last season" if r["use_last_season"] else "")
          + f" (min {MIN_MINUTES}+ minutes)")
    for w in r["warnings"]:
        print(f"  ! {w}")
    for n in r["notes"]:
        print(f"  - {n}")

    if r["binary"]:
        print(f"\nHit in {r['hist_hits']} of his last {r['hist_n']} games.")
        print(f"Projected minutes: {r['proj_min']:.1f}")
        print("\nProjected stats  (chance of 10+):")
        for label, proj, p10 in r["components"]:
            print(f"  {label:<14} {proj:5.1f}   {p10:6.1%}")
        print(f"\n{stat_label(r['stat']).upper()}: P(Yes) = {pct(r['p_yes'])}   P(No) = {pct(r['p_no'])}")
        print("(estimated by simulation, so treat it as approximate)")
        print(f"Break-even needed: {r['breakeven']:.1%}")
        _print_verdict(r, f"{r['p_best']:.1%} chance of {r['side']}")
        return

    info, hit, line = r["info"], r["hit"], r["line"]
    print(f"\nLast {hit['n10']} (oldest to newest): {hit['last10_values']}")
    print(f"Over {line:g} in {hit['over10']} of last {hit['n10']}"
          + (f" ({hit['push10']} push)" if hit["push10"] else "")
          + f"; this season {hit['over_cur']} of {hit['n_cur']}")
    print()
    print(f"Projected minutes:  {r['proj_min']:6.1f}")
    rr = f"{info['rate_recent']:.3f}" if info["rate_recent"] is not None else "n/a"
    rb = f"{info['rate_base']:.3f}" if info["rate_base"] is not None else "n/a"
    print(f"Rate per minute:    {info['rate']:6.3f}   (this season {rr}, last season {rb}, "
          f"weight on this season {info['weight']:.0%})")
    print(f"Opponent factor:    {info['opp_factor']:6.3f}   (their ratio {info['opp_ratio']:.3f})")
    print(f"Pace factor:        {r['pace_factor']:6.3f}   (expected pace {r['expected_pace']:.1f} poss)")
    print(f"Home/away factor:   {r['home_factor']:6.3f}")
    print()
    print(f"PROJECTED {r['label'].upper()}: {info['proj']:.1f}   (spread +/- {r['sd']:.1f}, {r['engine']})")
    print(f"Line {line:g}:  Over {pct(r['p_over'])}  |  Under {pct(r['p_under'])}"
          + (f"  |  Push {pct(r['p_push'])}" if r["p_push"] > 0.001 else ""))
    if r["adj"]:
        a = r["adj"]
        print(f"Sportsbook line {r['book_line']:g}: model is {a['gap']:+.1f} vs the book.")
        print(f"Market-adjusted projection {a['blended']:.1f}:  Over {pct(a['p_over'])}  |  "
              f"Under {pct(a['p_under'])}   <- verdict uses these")
    print(f"\nBreak-even needed: {r['breakeven']:.1%}")
    _print_verdict(r, f"{r['p_best']:.1%} chance of {r['side']}")


def _print_verdict(r, text):
    if r["verdict"].startswith("LEAN"):
        names = {"OVER": "More", "UNDER": "Less", "YES": "Yes", "NO": "No"}
        print(f"{r['verdict']} ({names[r['side']]}): {text}, edge {r['edge']:+.1%}")
    else:
        print(f"NO CLEAR EDGE (best side {r['side']} at {r['p_best']:.1%}, edge {r['edge']:+.1%})")
    print("Analysis only, not betting advice.")


# ----------------------------- batch mode -----------------------------

def _truthy(s):
    return str(s or "").strip().lower() in ("1", "y", "yes", "true", "t", "b2b", "x")


def _num(s):
    s = str(s or "").strip()
    return float(s) if s else None


def run_batch(ctx, path, args):
    path = Path(path)
    if not path.exists():
        raise PickError(f"Can't find {path}.")
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [{(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
                for row in csv.DictReader(f)]
    if not rows:
        raise PickError(f"{path} has no rows.")
    out, skipped = [], []
    for i, row in enumerate(rows, start=2):  # row 1 is the header
        try:
            r = run_pick(
                ctx, row.get("player", ""), row.get("stat") or "pts", _num(row.get("line")),
                opp=row.get("opp"), where=row.get("where") or None,
                b2b=_truthy(row.get("b2b")), book_line=_num(row.get("book_line")),
                minutes=_num(row.get("minutes")), spread=_num(row.get("spread")),
                use_last_season=not args.no_last_season, prior_games=args.prior_games,
                breakeven=args.breakeven, book_weight=args.book_weight)
            out.append(r)
        except PickError as e:
            skipped.append((i, row.get("player", "?"), str(e)))
        except (ValueError, KeyError) as e:
            skipped.append((i, row.get("player", "?"), f"bad value in row: {e}"))

    table = []
    for r in out:
        if r["binary"]:
            proj, line_txt, p_ov, p_un = "-", "yes", r["p_yes"], r["p_no"]
        else:
            proj, line_txt = f"{r['info']['proj']:.1f}", f"{r['line']:g}"
            a = r["adj"]
            p_ov, p_un = (a["p_over"], a["p_under"]) if a else (r["p_over"], r["p_under"])
        side = r["side"]
        table.append(dict(
            player=r["player"], stat=r["label"], game=f"{'at' if r['where'] == 'away' else 'vs'} {r['opp']}",
            line=line_txt, proj=proj, side=side, win_prob=round(r["p_best"], 3),
            edge=round(r["edge"], 3), verdict=r["verdict"],
            book_line=("" if r["book_line"] is None else f"{r['book_line']:g}"),
            flags=("check" if r["warnings"] else "")))
    df = pd.DataFrame(table)
    if not df.empty:
        df = df.sort_values("edge", ascending=False).reset_index(drop=True)
        pd.set_option("display.width", 160)
        pd.set_option("display.max_columns", 20)
        print(f"\nData through {ctx.last_date}. Sorted by edge. 'check' = open the single-pick report "
              f"for warnings.\n")
        print(df.to_string(index=False))
        print("\nAnalysis only, not betting advice.")
        if args.out:
            df.to_csv(args.out, index=False)
            print(f"Saved {args.out}")
    for i, who, msg in skipped:
        print(f"Row {i} ({who}) skipped: {msg}")
    if df.empty:
        raise PickError("No rows could be projected.")


# ----------------------------- command line -----------------------------

def list_stats():
    print("\nSupported stats (use the short key or the app's name):\n")
    for key, (label, _) in STATS.items():
        print(f"  {key:<8} {label}")
    for key, label in SPECIAL.items():
        print(f"  {key:<8} {label}  (Yes/No, estimated by simulation)")
    print("\nNot supported: dunks (not in the data feed). 'Game Lines' are team spreads/totals, not player stats.")
    print("Fantasy score uses the weights at the top of this file; check them against your app.")


def main():
    ap = argparse.ArgumentParser(description="Project an NBA player's stat against a line.")
    ap.add_argument("player", nargs="?", help='player name, e.g. "Luka Doncic"')
    ap.add_argument("--stat", default="pts", help="stat to project (default pts). See --list-stats")
    ap.add_argument("--line", type=float, help="the line, e.g. 27.5")
    ap.add_argument("--at", metavar="TEAM", help="opponent, player's team is the visitor (@ TEAM in the app)")
    ap.add_argument("--vs", metavar="TEAM", help="opponent, player's team is home (vs TEAM in the app)")
    ap.add_argument("--opp", help="opponent abbreviation (use with --where)")
    ap.add_argument("--where", help="home or away (use with --opp)")
    ap.add_argument("--b2b", action="store_true", help="second night of a back-to-back")
    ap.add_argument("--book-line", type=float, help="sportsbook line for the same stat, for comparison")
    ap.add_argument("--book-weight", type=float, default=BOOK_WEIGHT,
                    help=f"how far to pull toward --book-line, 0 to 1 (default {BOOK_WEIGHT})")
    ap.add_argument("--minutes", type=float, help="override projected minutes (e.g. a minutes restriction)")
    ap.add_argument("--spread", type=float, help="game point spread (either sign); big spreads cut minutes")
    ap.add_argument("--no-last-season", action="store_true",
                    help="ignore last season; use only this season's games")
    ap.add_argument("--prior-games", type=float, default=RATE_PRIOR_GAMES,
                    help=f"higher = lean on last season longer (default {RATE_PRIOR_GAMES})")
    ap.add_argument("--breakeven", type=float, default=BREAK_EVEN,
                    help=f"win rate needed per pick (default {BREAK_EVEN}); check your app's payouts")
    ap.add_argument("--batch", metavar="CSV", help="project every row of a CSV file")
    ap.add_argument("--out", metavar="CSV", help="with --batch, also save the results table")
    ap.add_argument("--db", help="path to nba.db (default: next to this script)")
    ap.add_argument("--list-stats", action="store_true", help="show the supported stats and exit")
    args = ap.parse_args()

    if args.list_stats:
        list_stats()
        return
    try:
        ctx = load_context(args.db)
        if args.batch:
            run_batch(ctx, args.batch, args)
            return
        if not args.player:
            ap.error("give a player name (or use --batch picks.csv, or --list-stats)")
        given = [x for x in (args.at, args.vs, args.opp) if x]
        if len(given) != 1:
            raise PickError("Give the opponent exactly one way: --at TEAM, --vs TEAM, or --opp TEAM --where home|away.")
        if args.at:
            opp, where = args.at, "away"
        elif args.vs:
            opp, where = args.vs, "home"
        else:
            opp, where = args.opp, args.where
        r = run_pick(ctx, args.player, args.stat, args.line, opp=opp, where=where, b2b=args.b2b,
                     book_line=args.book_line, minutes=args.minutes, spread=args.spread,
                     use_last_season=not args.no_last_season, prior_games=args.prior_games,
                     breakeven=args.breakeven, book_weight=args.book_weight)
        print_report(r)
    except PickError as e:
        sys.exit(f"\nError: {e}")


if __name__ == "__main__":
    main()