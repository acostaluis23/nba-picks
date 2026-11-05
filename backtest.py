"""
backtest.py - replay past games to see how accurate the projections really are.

For sample days in a past season, the program pretends it is that morning: it only uses games
played BEFORE that day, projects each player who then played, and compares with what happened.

Run from the nba-picks folder with the virtual environment active:

  python backtest.py                          # last season, every 5th game day, 5 main stats
  python backtest.py --season 2025-26 --every 3 --stats pts,reb,ast,pra,fg3m,fantasy
  python backtest.py --out backtest_rows.csv  # also save every projection vs the real result

To test a setting change, compare two runs:

  python backtest.py --set HALF_LIFE=6 --set CONTEXT_SHRINK=0.3

What the numbers mean:
  bias      average (projection - actual). Near 0 is good; positive means it runs too high.
  MAE       average miss in the stat's own units. Lower is better.
  base MAE  the miss of a plain "average of his last 10 games". The model should beat this.
  cover50   how often the real result landed inside the page's "typical range". Should be ~50%.
  cover80   same for an 80% range. Should be ~80%.

Note: only players who actually played are scored (the past can't tell us who was injured), so
real use will be a bit worse than these numbers unless injuries are filtered, as the page does.
"""

import argparse
import datetime as dt
import math
import sys
import time
from types import SimpleNamespace

import numpy as np
import pandas as pd

import project as P

DEFAULT_STATS = "pts,reb,ast,pra,fg3m"
MIN_PRIOR_GAMES = 5
MIN_ROTATION_MINUTES = 14


def prior_season_of(season):
    start = int(season[:4])
    return f"{start - 1}-{start % 100:02d}"


def ctx_as_of(full, cutoff):
    """The same context the live program would have had on the morning of `cutoff`."""
    pgs = full.pgs[full.pgs["game_date"] < cutoff]
    latest = pgs.groupby("player_id").tail(1).set_index("player_id")
    cur = pgs[(pgs["season"] == P.CURRENT_SEASON) & (pgs["minutes"] >= P.MIN_MINUTES)]
    players = full.players[["player_id", "name", "norm"]]
    players = players[players["player_id"].isin(latest.index)].copy()
    players["team_id"] = players["player_id"].map(latest["team_id"])
    players["cur_games"] = players["player_id"].map(cur.groupby("player_id").size()).fillna(0).astype(int)
    return SimpleNamespace(
        pgs=pgs, players=players, teams=full.teams, abbr_to_id=full.abbr_to_id,
        id_to_abbr=full.id_to_abbr, ts=P.build_team_stats(pgs), last_date=str(pgs["game_date"].max()))


def collect(args, quiet=False):
    """Replay the season. Returns (rows, calibration rows, whether last season was used)."""
    say = (lambda *a, **k: None) if quiet else print
    for item in args.set or []:
        name, _, value = item.partition("=")
        if not hasattr(P, name) or not value:
            sys.exit(f"--set: unknown setting '{item}'. Use NAME=VALUE with a setting from the top of project.py.")
        setattr(P, name, float(value))
    prior_games = float(getattr(P, "RATE_PRIOR_GAMES"))

    P.CURRENT_SEASON = args.season
    P.LAST_SEASON = args.prior or prior_season_of(args.season)
    say("Loading the database...")
    full = P.load_context(args.db)
    use_last = bool((full.pgs["season"] == P.LAST_SEASON).any())
    if not use_last:
        say(f"  ! No {P.LAST_SEASON} data in the database, so last season is ignored in this test.\n"
            f"    (Add it to SEASONS in ingest.py and run python ingest.py for the full test.)")
    stat_keys = [P.resolve_stat(s.strip()) for s in args.stats.split(",")]
    names = dict(zip(full.players["player_id"], full.players["name"]))

    dates = sorted(full.pgs.loc[full.pgs["season"] == args.season, "game_date"].unique())
    if len(dates) <= args.start_after:
        raise P.PickError(f"Not enough game days in {args.season} ({len(dates)}).")
    picked = dates[args.start_after::args.every]
    say(f"{args.season}: {len(dates)} game days, testing {len(picked)} of them "
        f"(every {args.every}, after the first {args.start_after}). Stats: {', '.join(stat_keys)}\n")

    rows, cal = [], []
    started = time.perf_counter()
    for n, day in enumerate(picked, 1):
        ctx = ctx_as_of(full, day)
        by_player = {pid: g for pid, g in ctx.pgs.groupby("player_id")}
        team_last = ctx.pgs.groupby("team_id")["game_date"].max().to_dict()
        yesterday = (dt.date.fromisoformat(day) - dt.timedelta(days=1)).isoformat()
        played = full.pgs[(full.pgs["game_date"] == day) & (full.pgs["minutes"] >= P.MIN_MINUTES)]
        count = 0
        for rec in played.itertuples(index=False):
            hist = by_player.get(rec.player_id)
            if hist is None:
                continue
            hist = hist[hist["minutes"] >= P.MIN_MINUTES]
            cur = hist[hist["season"] == P.CURRENT_SEASON]
            window = cur.tail(10) if len(cur) >= 3 else hist.tail(10)
            if len(hist) < MIN_PRIOR_GAMES or window.empty or window["minutes"].mean() < MIN_ROTATION_MINUTES:
                continue
            name = names.get(rec.player_id)
            opp = ctx.id_to_abbr.get(int(rec.opp_team_id))
            if not name or not opp:
                continue
            where = "home" if rec.is_home else "away"
            b2b = team_last.get(int(rec.team_id)) == yesterday
            got = False
            for key in stat_keys:
                try:
                    r = P.run_pick(ctx, name, key, 0.5, opp=opp, where=where, b2b=b2b,
                                   use_last_season=use_last, prior_games=prior_games)
                except P.PickError:
                    continue
                info, sd = r["info"], r["sd"]
                actual = float(getattr(rec, key))
                base = float(hist.tail(10)[key].mean())
                rows.append(dict(date=day, player=name, stat=key, proj=info["proj"], sd=sd, actual=actual,
                                 base10=base, proj_min=r["proj_min"], act_min=float(rec.minutes),
                                 n_cur=r["n_cur"], changed=any("changed teams" in w for w in r["warnings"])))
                F, pmf, _, _ = P.make_cdf(info["proj"], info["var"])
                for off in (-0.5, 0.0, 0.5):
                    line = max(0.5, math.floor(info["proj"] + off * sd) + 0.5)
                    p_over = P.line_probs(F, pmf, line)[0]
                    cal.append(dict(stat=key, p_over=p_over, hit=float(actual > line)))
                got = True
            count += got
        say(f"  {day}: {count} players  ({n}/{len(picked)}, {time.perf_counter() - started:.0f}s)")

    if not rows:
        raise P.PickError("No projections could be scored.")
    return pd.DataFrame(rows), pd.DataFrame(cal), use_last


def run(args):
    df, cal, use_last = collect(args)
    if args.out:
        df.to_csv(args.out, index=False)
        print(f"\nSaved every projection vs result to {args.out}")
    report(df, cal, use_last)


def summarize(g):
    err = g["proj"] - g["actual"]
    z = (g["actual"] - g["proj"]).abs() / g["sd"]
    return dict(n=len(g), avg=g["actual"].mean(), bias=err.mean(), mae=err.abs().mean(),
                base_mae=(g["base10"] - g["actual"]).abs().mean(),
                cover50=(z <= 0.674).mean(), cover80=(z <= 1.282).mean(),
                min_bias=(g["proj_min"] - g["act_min"]).mean())


def table(title, groups):
    print(f"\n{title}")
    print(f"{'':<16}{'n':>6}{'avg':>7}{'bias':>7}{'MAE':>7}{'base MAE':>10}{'cover50':>9}{'cover80':>9}{'min bias':>10}")
    for label, g in groups:
        if len(g) < 30:
            continue
        s = summarize(g)
        flag = "  <- beats baseline" if s["mae"] < s["base_mae"] else ""
        print(f"{label:<16}{s['n']:>6}{s['avg']:>7.1f}{s['bias']:>+7.2f}{s['mae']:>7.2f}{s['base_mae']:>10.2f}"
              f"{s['cover50']:>9.0%}{s['cover80']:>9.0%}{s['min_bias']:>+10.2f}{flag}")


def report(df, cal, use_last):
    print("\n" + "=" * 78)
    print(f"BACKTEST RESULTS  ({len(df)} projections, {df['date'].nunique()} game days)")
    print("=" * 78)
    table("By stat", [(P.STATS[k][0], g) for k, g in df.groupby("stat", sort=False)])

    pts = df[df["stat"] == df["stat"].iloc[0]]
    early = pts["n_cur"] < 10
    mid = (pts["n_cur"] >= 10) & (pts["n_cur"] < 25)
    table(f"By games already played this season ({P.STATS[pts['stat'].iloc[0]][0]})",
          [("under 10 games", pts[early]), ("10 to 24 games", pts[mid]), ("25+ games", pts[pts["n_cur"] >= 25])])
    table(f"Changed teams? ({P.STATS[pts['stat'].iloc[0]][0]})",
          [("changed teams", pts[pts["changed"]]), ("same team", pts[~pts["changed"]])])

    print("\nCalibration: when the model says X% chance of OVER a line, how often does it happen?")
    print("(lines are set near each projection, since we have no past sportsbook lines)")
    print(f"{'model said':<14}{'n':>7}{'avg said':>10}{'happened':>10}")
    bins = [0, 0.2, 0.35, 0.45, 0.55, 0.65, 0.8, 1.0001]
    cal = cal.copy()
    cal["bin"] = pd.cut(cal["p_over"], bins, right=False)
    for b, g in cal.groupby("bin", observed=True):
        if len(g) >= 30:
            print(f"{str(b.left)+'-'+str(round(b.right, 2)):<14}{len(g):>7}{g['p_over'].mean():>10.0%}{g['hit'].mean():>10.0%}")

    s = summarize(pts)
    print(f"\nHow to read it (for {P.STATS[pts['stat'].iloc[0]][0]}, the first stat you listed):")
    print(f" - Bias {s['bias']:+.2f}: " +
          ("it runs high, so projections are a bit generous." if s["bias"] > 0.25 else
           "it runs low." if s["bias"] < -0.25 else "no strong lean either way."))
    print(f" - Coverage {s['cover50']:.0%} (target 50%) and {s['cover80']:.0%} (target 80%): " +
          ("the ranges are too narrow, so the model is overconfident." if s["cover50"] < 0.45 else
           "the ranges are wider than needed." if s["cover50"] > 0.57 else "the ranges are about right."))
    print(f" - Model MAE {s['mae']:.2f} vs plain last-10 average {s['base_mae']:.2f}: " +
          ("the model beats the simple average." if s["mae"] < s["base_mae"] else
           "the plain average is as good or better, so the extras are not earning their keep yet."))
    print("Analysis only, not betting advice.")


def main():
    ap = argparse.ArgumentParser(description="Replay a past season to measure projection accuracy.")
    ap.add_argument("--season", default=P.LAST_SEASON, help=f"season to test (default {P.LAST_SEASON})")
    ap.add_argument("--prior", help="the season before it (default: worked out from --season)")
    ap.add_argument("--stats", default=DEFAULT_STATS, help=f"comma-separated stats (default {DEFAULT_STATS})")
    ap.add_argument("--every", type=int, default=5, help="test every Nth game day (default 5)")
    ap.add_argument("--start-after", type=int, default=8, help="skip the first N game days (default 8)")
    ap.add_argument("--set", action="append", metavar="NAME=VALUE",
                    help="try a different setting from project.py, e.g. --set HALF_LIFE=6")
    ap.add_argument("--db", help="path to nba.db (default: next to project.py)")
    ap.add_argument("--out", metavar="CSV", help="save every projection and result to a CSV")
    args = ap.parse_args()
    try:
        run(args)
    except P.PickError as e:
        sys.exit(f"\nError: {e}")


if __name__ == "__main__":
    main()