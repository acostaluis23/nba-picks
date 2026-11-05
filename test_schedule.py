"""
test_schedule.py - checks whether this computer can read the NBA schedule for upcoming days.

    python test_schedule.py                 # today and tomorrow (your computer's date)
    python test_schedule.py 2026-11-06      # one specific day

It asks two sources and prints the games each one returns. Paste the output back.
Nothing is saved or changed.
"""

import datetime as dt
import sys

import requests

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}
ESPN_TO_NBA = {"GS": "GSW", "NY": "NYK", "SA": "SAS", "NO": "NOP", "UTAH": "UTA", "WSH": "WAS"}


def nba_cdn(days):
    url = "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"
    print(f"\n[1] NBA schedule file\n    {url}")
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        print(f"    HTTP {r.status_code}, {len(r.content) // 1024} KB")
        r.raise_for_status()
        sched = r.json()["leagueSchedule"]
    except Exception as e:  # noqa: BLE001 - we want to show any failure
        print(f"    FAILED: {type(e).__name__}: {e}")
        return
    print(f"    season: {sched.get('seasonYear')}, days in file: {len(sched.get('gameDates', []))}")
    wanted = {d.strftime("%m/%d/%Y") for d in days}
    found = {d: [] for d in wanted}
    for gd in sched.get("gameDates", []):
        key = str(gd.get("gameDate", ""))[:10]
        if key in wanted:
            for g in gd.get("games", []):
                found[key].append(f"{g['awayTeam']['teamTricode']} @ {g['homeTeam']['teamTricode']}"
                                  f"  ({g.get('gameStatusText', '').strip() or g.get('gameDateTimeEst', '')})")
    for d in days:
        key = d.strftime("%m/%d/%Y")
        print(f"    {d}: {len(found[key])} games")
        for line in found[key]:
            print(f"        {line}")


def espn(days):
    print("\n[2] ESPN scoreboard")
    for d in days:
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={d.strftime('%Y%m%d')}"
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            events = r.json().get("events", [])
        except Exception as e:  # noqa: BLE001
            print(f"    {d}: FAILED: {type(e).__name__}: {e}")
            continue
        print(f"    {d}: {len(events)} games")
        for ev in events:
            comp = ev["competitions"][0]["competitors"]
            away = next(c for c in comp if c["homeAway"] == "away")["team"]["abbreviation"]
            home = next(c for c in comp if c["homeAway"] == "home")["team"]["abbreviation"]
            print(f"        {ESPN_TO_NBA.get(away, away)} @ {ESPN_TO_NBA.get(home, home)}  ({ev.get('date', '')})")


def main():
    if len(sys.argv) > 1:
        days = [dt.date.fromisoformat(sys.argv[1])]
    else:
        today = dt.date.today()
        days = [today, today + dt.timedelta(days=1)]
    print("Checking the schedule for:", ", ".join(str(d) for d in days))
    nba_cdn(days)
    espn(days)
    print("\nDone. Paste all of this back.")


if __name__ == "__main__":
    main()
