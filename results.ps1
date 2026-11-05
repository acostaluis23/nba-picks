# results.ps1 - runs every 20 minutes in the evening (see setup_tasks.ps1).
#
#   1. pulls fresh box scores
#   2. writes site\results.json so finished games show "Final" numbers on the cards
#   3. publishes
#   4. once EVERY game on the slate is final, grades the night (runs night.ps1), which saves the day
#      for the day buttons and updates the Last night tab
#
# Run by hand any time:  powershell -ExecutionPolicy Bypass -File .\results.ps1

$root = $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs"), (Join-Path $root "archive") | Out-Null
Start-Transcript -Path (Join-Path $root "logs\results.log") -Append | Out-Null
Write-Host "=== Results run $(Get-Date) ==="

if (-not (Test-Path "site\slate.json")) { Write-Host "No slate yet. Nothing to do."; Stop-Transcript | Out-Null; exit 0 }
$day = (& $py -c "import json; print(json.load(open('site/slate.json', encoding='utf-8'))['meta']['slate_date'])").Trim()

if (Test-Path "site\days\$day.json") {
    Write-Host "$day is already graded. Nothing to do."
    Stop-Transcript | Out-Null
    exit 0
}

& $py ingest.py --current 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "Could not update results. Stopping."; Stop-Transcript | Out-Null; exit 1 }

$out = & $py export_results.py 2>&1
$out | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "Could not write results.json. Stopping."; Stop-Transcript | Out-Null; exit 1 }
$last = ($out | Select-Object -Last 1).ToString().Trim()

if (($last -eq "ALL_FINAL") -and (Test-Path "archive\slate-$day.json")) {
    Write-Host "`nEvery game is final. Refreshing the next day's preview with tonight's results..."
    & $py build_slate.py --preview 2>&1 | Out-Host
    Write-Host "`nGrading the night..."
    # Separate process, so its own log and transcript don't collide with this one.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "night.ps1") | Out-Host
} else {
    & (Join-Path $root "deploy.ps1") | Out-Host
}

Write-Host "=== Done $(Get-Date) ==="
Stop-Transcript | Out-Null
