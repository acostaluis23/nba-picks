import requests

URLS = {
    "injuries": "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
    "news": "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/news?limit=5",
}
HEADERS = {"User-Agent": "Mozilla/5.0"}

r = requests.get(URLS["injuries"], timeout=20, headers=HEADERS)
print("injuries:", r.status_code, len(r.content), "bytes")
data = r.json()
print("top-level keys:", list(data.keys()))
teams = data.get("injuries", [])
print("teams listed:", len(teams))
for team in teams[:2]:
    print(team.get("displayName"), "-", len(team.get("injuries", [])), "players")
    for i in team.get("injuries", [])[:3]:
        a = i.get("athlete", {})
        print("   ", a.get("displayName"), "|", i.get("status"), "|", (i.get("shortComment") or "")[:90])
print("--- anyone named Edwards:")
for team in teams:
    for i in team.get("injuries", []):
        name = i.get("athlete", {}).get("displayName", "")
        if "Edwards" in name:
            print("   ", team.get("displayName"), "|", name, "|", i.get("status"), "|", (i.get("shortComment") or "")[:120])

r = requests.get(URLS["news"], timeout=20, headers=HEADERS)
print("\nnews:", r.status_code)
for a in r.json().get("articles", [])[:5]:
    print(" -", a.get("headline"), "|", a.get("published"))