# night.ps1 - after the games: pull the results, grade the projections, publish the Last night tab.
# It uses the pre-game copies saved in archive\ by morning.ps1 and pregame.ps1.
#
# Run by hand:  powershell -ExecutionPolicy Bypass -File .\night.ps1

$root = $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs"), (Join-Path $root "archive") | Out-Null
Start-Transcript -Path (Join-Path $root "logs\night.log") -Append | Out-Null
Write-Host "=== Night run $(Get-Date) ==="

& $py ingest.py --current 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "Could not update results. Stopping."; Stop-Transcript | Out-Null; exit 1 }

$latest = Get-ChildItem (Join-Path $root "archive\slate-*.json") | Sort-Object Name | Select-Object -Last 1
if (-not $latest) { Write-Host "No archived slate found. Nothing to grade."; Stop-Transcript | Out-Null; exit 1 }
$day = $latest.BaseName.Substring(6)
Write-Host "Grading $day"

$inj = "archive\injuries-$day.json"
& $py score_night.py --slate "archive\slate-$day.json" --injuries $inj 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "Grading failed. Not publishing."; Stop-Transcript | Out-Null; exit 1 }

Write-Host "`n--- Publish the Last night tab ---"
& (Join-Path $root "deploy.ps1") | Out-Host

Write-Host "=== Done $(Get-Date) ==="
Stop-Transcript | Out-Null
