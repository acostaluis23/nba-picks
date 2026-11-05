# deploy.ps1 - publish the site folder to GitHub Pages (the gh-pages branch).
#
# It copies site\ into a temporary folder, makes ONE fresh commit, and force-pushes it to the
# gh-pages branch. That keeps the repository small: old daily copies of slate.json never pile up.
#
# Run it by hand with:  powershell -ExecutionPolicy Bypass -File .\deploy.ps1
# (morning.ps1 and pregame.ps1 call it for you.)

$root = $PSScriptRoot
$site = Join-Path $root "site"
$repo = "https://github.com/acostaluis23/nba-picks.git"
$tmp  = Join-Path $env:TEMP "nba-picks-deploy"

if (-not (Test-Path (Join-Path $site "index.html"))) {
    Write-Host "Can't find site\index.html, nothing to publish."
    exit 1
}
if (-not (Test-Path (Join-Path $site "slate.json"))) {
    Write-Host "site\slate.json is missing. Run build_slate.py first."
    exit 1
}

if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item (Join-Path $site "*") $tmp -Recurse

Push-Location $tmp
$ok = $true
git init -q -b gh-pages
if ($LASTEXITCODE -ne 0) { $ok = $false }
if ($ok) { git add -A; if ($LASTEXITCODE -ne 0) { $ok = $false } }
if ($ok) {
    git -c user.name="nba-picks" -c user.email="nba-picks@users.noreply.github.com" commit -q -m "Update $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    if ($LASTEXITCODE -ne 0) { $ok = $false }
}
if ($ok) { git remote add origin $repo; git push -q -f origin gh-pages; if ($LASTEXITCODE -ne 0) { $ok = $false } }
Pop-Location

if ($ok) {
    Write-Host "Published: https://acostaluis23.github.io/nba-picks/"
    exit 0
}
Write-Host "Publishing failed. If this is the first time, make sure the GitHub repository exists and you are signed in."
exit 1
