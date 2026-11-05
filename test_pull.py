from nba_api.stats.endpoints import leaguegamelog

log = leaguegamelog.LeagueGameLog(
    season="2025-26",
    player_or_team_abbreviation="P",
    timeout=60,
)
df = log.get_data_frames()[0]

print("rows:", len(df))
print(df.columns.tolist())
print(df.head())