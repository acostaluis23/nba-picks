"""
fetch_lines.py - save today's real PrizePicks lines so the site can show them and the nightly grade can use them.

What it does
  1. Asks the Apify actor lergassy/dfs-props-scraper for the PrizePicks NBA board (points, rebounds, assists,
     PRA and 3-pointers made). Costs about $0.35 per full slate.
  2. Keeps only the plain "standard" lines (drops demon / goblin alternates, combo players, in-game lines).
  3. Matches each line to a player on today's site\\slate.json (same team and opponent).
  4. Writes
       site\\props.json                 what the web page reads (published by deploy.ps1)
       archive\\lines-<slate date>.json  the same data, kept so score_night.py can grade against it

It is optional. If anything fails (no token, Apify down, PrizePicks blocks it, board empty) it prints why and
leaves the old files alone. The site works exactly as before without lines. pregame.ps1 ignores its exit code.

Setup (once): put your Apify API token on one line in  apify_token.txt  next to this file (it is git-ignored and
never goes on the site), or set the APIFY_TOKEN environment variable.

Usage
  python fetch_lines.py                       normal run (skips if lines were fetched in the last 90 minutes)
  python fetch_lines.py --force               fetch again now (costs another ~$0.35)
  python fetch_lines.py --from-file x.json    use a dataset you exported from Apify instead of fetching (free)
  python fetch_lines.py --dry-run             show what would be saved, write nothing
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).parent
ACTOR = "lergassy~dfs-props-scraper"
API = f"https://api.apify.com/v2/acts/{ACTOR}/run-sync-get-dataset-items"
# What we ask the actor for. "markets" is a partial match, so Rebounds also brings Offensive/Defensive Rebounds;
# those are dropped below.
ACTOR_INPUT = {
    "platforms": ["prizepicks"],
    "mode": "props",
    "leagues": ["NBA"],
    "markets": ["Points", "Rebounds", "Assists", "PRA", "3PTM"],
    "maxRows": 5000,
}
MAX_CHARGE_USD = 0.75          # Apify stops the run if it would cost more than this
# PrizePicks market name -> the site's stat key
MARKETS = {"Points": "pts", "Rebounds": "reb", "Assists": "ast", "PRA": "pra", "3PTM": "fg3m"}
MIN_PLAYERS = 10               # fewer matched players than this means something is wrong: don't overwrite
FRESH_MINUTES = 90             # don't pay for a second fetch inside this window unless --force


def norm_name(s):
    """Same rule as score_night.py so names line up the same way everywhere."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"[.'’]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def get_token():
    tok = os.environ.get("APIFY_TOKEN", "").strip()
    f = HERE / "apify_token.txt"
    if not tok and f.exists():
        text = f.read_text(encoding="utf-8-sig").strip()
        tok = text.splitlines()[0].strip() if text else ""
    return tok


def fetch_board(token):
    """Run the actor and return its dataset rows. Raises RuntimeError with a plain message on failure."""
    import requests
    last = None
    for attempt in (1, 2):
        try:
            r = requests.post(
                API,
                params={"timeout": 150, "maxTotalChargeUsd": MAX_CHARGE_USD, "format": "json"},
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                data=json.dumps(ACTOR_INPUT),
                timeout=200,
            )
            if r.status_code in (200, 201):
                rows = r.json()
                if not isinstance(rows, list):
                    raise RuntimeError("Apify answered, but not with a list of rows.")
                return rows
            if r.status_code in (401, 403):
                raise RuntimeError(f"Apify refused the token (HTTP {r.status_code}). Check apify_token.txt.")
            if r.status_code == 402:
                raise RuntimeError("Apify says the account is out of credit (HTTP 402).")
            last = f"Apify returned HTTP {r.status_code}: {r.text[:200]}"
        except RuntimeError:
            raise
        except Exception as e:  # noqa: BLE001 - network problems of any kind
            last = f"Could not reach Apify: {e}"
        print(f"  attempt {attempt} failed: {last}")
    raise RuntimeError(last or "unknown error")


def build_lines(rows, slate):
    """Filter the board down to standard lines and match them to slate players. Returns (lines, report)."""
    by_name = {}
    for p in slate["players"]:
        by_name.setdefault(norm_name(p["name"]), []).append(p)
    slate_teams = {p["team"] for p in slate["players"]}

    props = [r for r in rows if r.get("type") == "prop"]
    notice = next((r.get("notice") for r in rows if r.get("type") == "notice"), None)
    rep = {"rows": len(props), "standard": 0, "kept": 0, "combo": 0, "other_stat": 0, "not_pregame": 0,
           "unmatched": {}, "notice": notice}
    lines, stamp = {}, {}
    for r in props:
        if r.get("oddsType") != "standard":
            continue
        rep["standard"] += 1
        if r.get("playerCombo") or "+" in (r.get("player") or ""):
            rep["combo"] += 1
            continue
        stat = MARKETS.get(r.get("market"))
        if not stat or r.get("duration", "Full") != "Full":
            rep["other_stat"] += 1
            continue
        if r.get("status", "pre_game") != "pre_game" or r.get("live"):
            rep["not_pregame"] += 1
            continue
        try:
            line = float(r["line"])
        except (KeyError, TypeError, ValueError):
            continue
        cands = [p for p in by_name.get(norm_name(r.get("player")), [])
                 if p["team"] == r.get("team") and p["opp"] == r.get("opponent")]
        if not cands:
            if r.get("team") in slate_teams:
                rep["unmatched"][r.get("player")] = r.get("team")
            continue
        pid = str(cands[0]["id"])
        upd = r.get("updatedAt") or ""
        if stat in lines.get(pid, {}) and stamp.get((pid, stat), "") >= upd:
            continue                       # two standard lines for one player/stat: keep the newer
        lines.setdefault(pid, {})[stat] = line
        stamp[(pid, stat)] = upd
        rep["kept"] += 1
    return lines, rep


def main():
    ap = argparse.ArgumentParser(description="Save today's PrizePicks lines.")
    ap.add_argument("--slate", default=str(HERE / "site" / "slate.json"))
    ap.add_argument("--out", default=str(HERE / "site" / "props.json"))
    ap.add_argument("--archive-dir", default=str(HERE / "archive"))
    ap.add_argument("--from-file", help="an Apify dataset export (JSON) to use instead of fetching")
    ap.add_argument("--force", action="store_true", help="fetch even if lines were fetched recently")
    ap.add_argument("--dry-run", action="store_true", help="write nothing")
    args = ap.parse_args()

    try:
        slate = json.load(open(args.slate, encoding="utf-8"))
        day = slate["meta"]["slate_date"]
    except Exception as e:  # noqa: BLE001
        print(f"Lines skipped: can't read {args.slate} ({e}).")
        return 1
    out = Path(args.out)
    arch = Path(args.archive_dir) / f"lines-{day}.json"

    if not args.from_file and not args.force and out.exists():
        try:
            old = json.load(open(out, encoding="utf-8"))["meta"]
            age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(old["fetched_at"])
            if old.get("slate_date") == day and age < dt.timedelta(minutes=FRESH_MINUTES):
                print(f"Lines for {day} were fetched {int(age.total_seconds() // 60)} min ago. "
                      f"Skipping (use --force to fetch again).")
                return 0
        except Exception:  # noqa: BLE001 - unreadable old file: just fetch
            pass

    if args.from_file:
        rows = json.load(open(args.from_file, encoding="utf-8"))
        fetched_at = dt.datetime.fromtimestamp(Path(args.from_file).stat().st_mtime, dt.timezone.utc)
        print(f"Using {args.from_file} ({len(rows)} rows).")
    else:
        token = get_token()
        if not token:
            print("Lines skipped: no Apify token. Put it in apify_token.txt (one line) or set APIFY_TOKEN.")
            return 1
        print("Fetching the PrizePicks NBA board from Apify...")
        try:
            rows = fetch_board(token)
        except RuntimeError as e:
            print(f"Lines skipped: {e}")
            return 1
        fetched_at = dt.datetime.now(dt.timezone.utc)

    lines, rep = build_lines(rows, slate)
    players = len(lines)
    print(f"Board rows {rep['rows']}, standard {rep['standard']} (combos dropped {rep['combo']}, "
          f"other stats {rep['other_stat']}). Kept {rep['kept']} lines for {players} slate players.")
    if rep["notice"]:
        print("Apify:", rep["notice"])
    if rep["unmatched"]:
        names = ", ".join(f"{n} ({t})" for n, t in sorted(rep["unmatched"].items()))
        print(f"Not on the slate (skipped): {names}")
    if players < MIN_PLAYERS:
        print(f"Lines skipped: only {players} players matched (need {MIN_PLAYERS}). "
              f"The board may be empty, not posted yet, or for another day. Old files left alone.")
        return 1

    doc = {
        "meta": {
            "slate_date": day,
            "fetched_at": fetched_at.replace(microsecond=0).isoformat(),
            "source": "PrizePicks",
            "players": players,
            "lines": rep["kept"],
        },
        "lines": lines,
    }
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    for path in (out, arch):
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"), allow_nan=False)
        tmp.replace(path)
    print(f"Saved {out.name} and archive\\{arch.name}.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 - never let this step crash loudly into pregame
        print(f"Lines skipped: unexpected error: {e}")
        sys.exit(1)
