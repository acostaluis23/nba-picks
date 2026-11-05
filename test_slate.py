from nba_api.live.nba.endpoints import scoreboard

board = scoreboard.ScoreBoard()
games = board.games.get_dict()
print("date:", board.score_board_date, "| games:", len(games))
for g in games:
    away, home = g["awayTeam"]["teamTricode"], g["homeTeam"]["teamTricode"]
    print(f'{g["gameId"]}  {away} @ {home}  {g["gameStatusText"]}')