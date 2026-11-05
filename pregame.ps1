# pregame.ps1 - a quick refresh shortly before tip-off: fresh injuries and news, then publish.
# It also saves that injury list in archive\ so the nightly grade uses what was known at game time.
#
# Run by hand:  powershell -ExecutionPolicy Bypass -File .\pregame.ps1

$root = $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs"), (Join-Path $root "archive") | Out-Null
Start-Transcript -Path (Join-Path $root "logs\pregame.log") -Append | Out-Null
Write-Host "=== Pregame run $(Get-Date) ==="

& $py fetch_injuries.py 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "Injuries failed. Stopping."; Stop-Transcript | Out-Null; exit 1 }

if (Test-Path "site\slate.json") {
    $day = & $py -c "import json; print(json.load(open('site/slate.json', encoding='utf-8'))['meta']['slate_date'])"
    Copy-Item "site\injuries.json" "archive\injuries-$day.json" -Force
    Write-Host "Saved archive\injuries-$day.json"
}

& (Join-Path $root "deploy.ps1") | Out-Host
Write-Host "=== Done $(Get-Date) ==="
Stop-Transcript | Out-Null
