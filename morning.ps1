# morning.ps1 - refresh everything for today's games and publish the site.
#
# Order: pull last night's results -> fetch injuries and news -> build today's projections ->
#        save a pre-game copy in archive\ -> publish.
#
# Run by hand:  powershell -ExecutionPolicy Bypass -File .\morning.ps1

$root = $PSScriptRoot
Set-Location $root
$py = Join-Path $root ".venv\Scripts\python.exe"
New-Item -ItemType Directory -Force -Path (Join-Path $root "logs"), (Join-Path $root "archive") | Out-Null
Start-Transcript -Path (Join-Path $root "logs\morning.log") -Append | Out-Null
Write-Host "=== Morning run $(Get-Date) ==="

Write-Host "`n--- 1. Pull the latest results ---"
& $py ingest.py --current 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "Could not update results. Stopping."; Stop-Transcript | Out-Null; exit 1 }

Write-Host "`n--- 2. Injuries and news ---"
& $py fetch_injuries.py 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "(Injuries failed. Continuing with the old file.)" }

Write-Host "`n--- 3. Build today's projections ---"
& $py build_slate.py 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "No slate built (maybe no games today). Stopping."; Stop-Transcript | Out-Null; exit 1 }

Write-Host "`n--- 4. Save the pre-game copy ---"
$day = & $py -c "import json; print(json.load(open('site/slate.json', encoding='utf-8'))['meta']['slate_date'])"
Copy-Item "site\slate.json" "archive\slate-$day.json" -Force
if (Test-Path "site\injuries.json") { Copy-Item "site\injuries.json" "archive\injuries-$day.json" -Force }
Write-Host "Saved archive\slate-$day.json"

Write-Host "`n--- 5. Publish ---"
& (Join-Path $root "deploy.ps1") | Out-Host

Write-Host "`n=== Done $(Get-Date) ==="
Stop-Transcript | Out-Null
