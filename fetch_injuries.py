"""
fetch_injuries.py - save today's NBA injury list and recent headlines to site/injuries.json.

Run from the nba-picks folder with the virtual environment active:

  python fetch_injuries.py

It is separate from build_slate.py on purpose: projections only need rebuilding once a day,
but injury statuses change all day, so this one is quick to run as often as you like.

  python fetch_injuries.py --debug     also prints the raw fields of the first few records
"""

import argparse
import datetime as dt
import json
import sys
from collections import Counter
from pathlib import Path

import requests

INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=50"
HEADERS = {"User-Agent": "Mozilla/5.0"}
DEFAULT_OUT = Path(__file__).parent / "site" / "injuries.json"


def get_json(url):
    r = requests.get(url, timeout=30, headers=HEADERS)
    r.raise_for_status()
    return r.json()


def text(x):
    return str(x).strip() if x else ""


def parse_injuries(data, debug=False):
    players = []
    for team in data.get("injuries", []):
        team_name = text(team.get("displayName"))
        for rec in team.get("injuries", []):
            if debug and len(players) < 3:
                print("raw record keys:", sorted(rec.keys()))
                print("  athlete keys:", sorted((rec.get("athlete") or {}).keys()))
                print("  details:", rec.get("details"))
            athlete = rec.get("athlete") or {}
            name = text(athlete.get("displayName") or athlete.get("fullName"))
            if not name:
                continue
            status = rec.get("status")
            if isinstance(status, dict):
                status = status.get("description") or status.get("name")
            details = rec.get("details") or {}
            players.append(dict(
                name=name,
                team=team_name,
                status=text(status),
                comment=text(rec.get("shortComment")),
                long=text(rec.get("longComment")),
                date=text(rec.get("date")),
                detail=text(details.get("type") or details.get("detail")),
                returns=text(details.get("returnDate")),
            ))
    return players


def parse_news(data):
    items = []
    for a in data.get("articles", []):
        headline = text(a.get("headline"))
        if not headline:
            continue
        links = a.get("links") or {}
        web = links.get("web") or {}
        items.append(dict(
            headline=headline,
            description=text(a.get("description"))[:300],
            published=text(a.get("published")),
            url=text(web.get("href")),
        ))
    return items


def main():
    ap = argparse.ArgumentParser(description="Save injuries and headlines to site/injuries.json.")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="where to write the JSON file")
    ap.add_argument("--debug", action="store_true", help="print raw fields of the first records")
    args = ap.parse_args()

    try:
        raw = get_json(INJURIES_URL)
    except (requests.RequestException, ValueError) as e:
        sys.exit(f"\nCouldn't fetch the injury list: {e}\nThe old file (if any) was left alone.")
    players = parse_injuries(raw, args.debug)
    if not players:
        sys.exit("\nThe injury list came back empty, so nothing was saved (the old file was left alone).")

    news = []
    try:
        news = parse_news(get_json(NEWS_URL))
    except (requests.RequestException, ValueError) as e:
        print(f"  ! Headlines unavailable this time ({e}). Saving injuries only.")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    data = dict(
        meta=dict(generated_at=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                  source="ESPN", source_timestamp=text(raw.get("timestamp"))),
        players=players, news=news)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    counts = Counter(p["status"] or "(none)" for p in players)
    print(f"Saved {out}: {len(players)} injury entries, {len(news)} headlines.")
    print("  " + ", ".join(f"{k}: {v}" for k, v in counts.most_common()))


if __name__ == "__main__":
    main()