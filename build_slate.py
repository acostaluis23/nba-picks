"""
build_slate.py - turn tonight's NBA schedule into site/slate.json for the web page.

Run from the nba-picks folder with the virtual environment active:

  python ingest.py --current        (refresh the data first)
  python build_slate.py

Useful options:

  python build_slate.py --per-team 6          fewer players per team (faster, smaller file)
  python build_slate.py --stats pts,reb,ast   only these stats
  python build_slate.py --fast                skip the "ignore last season" versions
  python build_slate.py --out site/slate.json where to write the file

For every game tonight it picks each team's rotation players, projects every stat
with the same model as project.py, and saves the numbers plus last-5-games and
history against tonight's opponent, so the page can show them without any server.
"""

import argparse
import datetime as dt
import json
import math
import sys
import time
from pathlib import Path

import project as P

DEFAULT_OUT = Path(__file__).parent / "site" / "slate.json"
EXTRA_KEYS = ["dd", "td"]


def rnd(x, digits=2):
    """Round, and turn NaN/inf into None so the JSON file is always valid."""
    if x is None:
        return None
    x = float(x)
    return round(x, digits) if math.isfinite(x) else None


# ----------------------------- schedule -----------------------------

def fetch_slate():
    """Tonight's games from the NBA's live scoreboard."""
    from nba_api.live.nba.endpoints import scoreboard
    board = scoreboard.ScoreBoard()
    slate_date = board.score_board_date
    games = []
    for g in board.games.get_dict():
        games.append(dict(
            game_id=g["gameId"],
            away=g["awayTeam"]["teamTricode"],
            home=g["homeTeam"]["teamTricode"],
            time=g.get("gameStatusText", "").strip(),
            start=g.get("gameEt") or g.get("gameTimeUTC") or "",
        ))
    return slate_date, games


# ----------------------------- player selection -----------------------------

def game_row(ctx, row, with_season=False):
    out = dict(date=str(row["game_date"]),
               opp=ctx.id_to_abbr.get(int(row["opp_team_id"]), "?"),
               home=bool(row["is_home"]),
               min=rnd(row["minutes"], 0))
    if with_season:
        out["season"] = row["season"]
    out["s"] = {k: rnd(row[k], 1 if k == "fantasy" else 0) for k in P.STATS}
    return out


def pick_players(ctx, by_player, team_id, per_team, min_minutes):
    """The team's rotation: players who played in one of its last 5 games, most minutes first."""
    pgs = ctx.pgs
    tg = pgs[pgs["team_id"] == team_id][["game_id", "game_date"]].drop_duplicates() \
        .sort_values("game_date").tail(5)
    recent_ids = set(tg["game_id"])
    played = set(pgs[(pgs["game_id"].isin(recent_ids)) & (pgs["team_id"] == team_id)
                     & (pgs["minutes"] > 0)]["player_id"])
    found = []
    for r in ctx.players[ctx.players["team_id"] == team_id].itertuples():
        if r.player_id not in played:
            continue
        g = by_player[r.player_id]
        g = g[g["minutes"] >= P.MIN_MINUTES]
        cur = g[g["season"] == P.CURRENT_SEASON]
        window = cur.tail(10) if len(cur) >= 3 else g.tail(10)
        if window.empty:
            continue
        avg_min = float(window["minutes"].mean())
        if avg_min >= min_minutes:
            found.append((avg_min, int(r.player_id), r.name))
    found.sort(reverse=True)
    return found[:per_team]


# ----------------------------- projection -----------------------------

def stat_block(r):
    if r["binary"]:
        return dict(p=rnd(r["p_yes"], 3))
    info, sd = r["info"], r["sd"]
    proj = info["proj"]
    return dict(proj=rnd(proj, 1), sd=rnd(sd, 2),
                lo=rnd(max(0.0, proj - 0.674 * sd), 1), hi=rnd(proj + 0.674 * sd, 1),
                rate=rnd(info["rate"], 3), opp=rnd(info["opp_factor"], 3))


def project_player(ctx, name, opp, where, b2b, stat_keys, with_current_only):
    """Returns (stats dict, player-level info dict, warnings, notes)."""
    stats, top = {}, {}
    warnings, notes = [], []
    for key in stat_keys:
        try:
            r = P.run_pick(ctx, name, key, None if key in P.SPECIAL else 0.5,
                           opp=opp, where=where, b2b=b2b)
        except P.PickError:
            continue
        if not top:
            top = dict(min=rnd(r["proj_min"], 1), pace=rnd(r["pace_factor"], 3),
                       home_factor=rnd(r["home_factor"], 3), n_cur=r["n_cur"], n_last=r["n_last"])
            # drop messages that only make sense when comparing against a real line
            skip = ("Data only goes through", "An edge this large")
            warnings = [w for w in r["warnings"] if not w.startswith(skip)]
            notes = [n for n in r["notes"]
                     if "played yesterday" not in n and "rare events" not in n]
        block = stat_block(r)
        if with_current_only:
            try:
                rc = P.run_pick(ctx, name, key, None if key in P.SPECIAL else 0.5,
                                opp=opp, where=where, b2b=b2b, use_last_season=False)
                block["cur"] = stat_block(rc)
                top.setdefault("min_cur", rnd(rc["proj_min"], 1))
            except P.PickError:
                block["cur"] = None
        stats[key] = block
    return stats, top, warnings, notes


def build(ctx, slate_date, games, stat_keys, per_team, min_minutes, with_current_only):
    try:
        slate_day = dt.date.fromisoformat(slate_date)
    except (TypeError, ValueError):
        slate_day = dt.date.today()
    yesterday = (slate_day - dt.timedelta(days=1)).isoformat()
    by_player = {pid: g for pid, g in ctx.pgs.groupby("player_id")}

    out_games, out_players = [], []
    started = time.perf_counter()
    for g in games:
        away = P.TEAM_ALIASES.get(g["away"], g["away"])
        home = P.TEAM_ALIASES.get(g["home"], g["home"])
        if away not in ctx.abbr_to_id or home not in ctx.abbr_to_id:
            print(f"  skipped {g['away']} @ {g['home']}: team not in the database")
            continue
        out_games.append(dict(game_id=g["game_id"], away=away, home=home,
                              time=g["time"], start=g["start"]))
        count = 0
        for team, opp, where in ((away, home, "away"), (home, away, "home")):
            team_id, opp_id = int(ctx.abbr_to_id[team]), int(ctx.abbr_to_id[opp])
            team_last = str(ctx.pgs.loc[ctx.pgs["team_id"] == team_id, "game_date"].max())
            b2b = team_last == yesterday
            for avg_min, pid, name in pick_players(ctx, by_player, team_id, per_team, min_minutes):
                stats, top, warnings, notes = project_player(
                    ctx, name, opp, where, b2b, stat_keys, with_current_only)
                if not stats:
                    continue
                games_played = by_player[pid]
                games_played = games_played[games_played["minutes"] > 0]
                vs = games_played[games_played["opp_team_id"] == opp_id].tail(5)
                out_players.append(dict(
                    id=pid, name=name, team=team, opp=opp, where=where,
                    game_id=g["game_id"], b2b=b2b, avg_min=rnd(avg_min, 1), **top,
                    warnings=warnings, notes=notes, stats=stats,
                    recent=[game_row(ctx, row) for _, row in games_played.tail(5).iterrows()][::-1],
                    vs_opp=[game_row(ctx, row, True) for _, row in vs.iterrows()][::-1],
                ))
                count += 1
        print(f"  {away} @ {home}: {count} players  ({time.perf_counter() - started:.0f}s so far)")

    labels = {k: P.STATS[k][0] for k in stat_keys if k in P.STATS}
    labels.update({k: P.SPECIAL[k] for k in stat_keys if k in P.SPECIAL})
    return dict(
        meta=dict(generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                  slate_date=str(slate_date), data_through=ctx.last_date,
                  current_season=P.CURRENT_SEASON, stat_labels=labels,
                  has_current_only=with_current_only),
        games=out_games, players=out_players)


# ----------------------------- command line -----------------------------

def main():
    ap = argparse.ArgumentParser(description="Build site/slate.json for tonight's games.")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="where to write the JSON file")
    ap.add_argument("--db", help="path to nba.db (default: next to project.py)")
    ap.add_argument("--per-team", type=int, default=9, help="players per team (default 9)")
    ap.add_argument("--min-minutes", type=float, default=14.0,
                    help="skip players averaging fewer recent minutes than this (default 14)")
    ap.add_argument("--stats", help="comma-separated stats (default: all of them)")
    ap.add_argument("--fast", action="store_true",
                    help="skip the 'ignore last season' versions (about twice as fast)")
    args = ap.parse_args()

    try:
        if args.stats:
            stat_keys = []
            for s in args.stats.split(","):
                k = P.resolve_stat(s.strip())
                if k not in stat_keys:
                    stat_keys.append(k)
        else:
            stat_keys = list(P.STATS) + EXTRA_KEYS

        print("Loading the database...")
        ctx = P.load_context(args.db)
        print("Asking the NBA for tonight's games...")
        slate_date, games = fetch_slate()
        if not games:
            raise P.PickError("No games on tonight's schedule.")
        print(f"{slate_date}: {len(games)} games. Data through {ctx.last_date}.")
        try:
            behind = (dt.date.fromisoformat(slate_date) - dt.date.fromisoformat(ctx.last_date)).days
            if behind > 2:
                print(f"  ! The data is {behind} days old. Run: python ingest.py --current")
        except ValueError:
            pass

        data = build(ctx, slate_date, games, stat_keys, args.per_team, args.min_minutes, not args.fast)
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        size = out.stat().st_size / 1024
        print(f"\nSaved {out} ({len(data['players'])} players, {size:,.0f} KB).")
    except P.PickError as e:
        sys.exit(f"\nError: {e}")


if __name__ == "__main__":
    main()