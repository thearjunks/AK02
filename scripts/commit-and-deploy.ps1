$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectRoot

Write-Host "STC Dashboard - Commit and Deploy" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
Write-Host ""

Write-Host "Fetching and validating the latest STC data before deployment..." -ForegroundColor Cyan
$fetchOutput = & node (Join-Path $PSScriptRoot "fetch-live-data.mjs") 2>&1
if ($LASTEXITCODE -ne 0) { throw ($fetchOutput -join [Environment]::NewLine) }
$summary = ($fetchOutput -join "") | ConvertFrom-Json
$snapshot = Get-Content -LiteralPath (Join-Path $projectRoot "data\latest-snapshot.json") -Raw | ConvertFrom-Json
$generatedAt = [DateTimeOffset]$snapshot.generatedAt
if ($generatedAt -ne [DateTimeOffset]$summary.generatedAt) { throw "Fetch summary and snapshot timestamps do not match." }
if ((([DateTimeOffset]::UtcNow) - $generatedAt.ToUniversalTime()).TotalMinutes -gt 60) { throw "Fetched snapshot is older than 60 minutes." }
if ([int]$summary.currentTotal -le 0) { throw "Current device total is zero." }
if ([int]$summary.displayedTotal -lt [int]$summary.currentTotal) { throw "Displayed device total is lower than current total." }
if ($snapshot.devices.Count -ne [int]$summary.displayedTotal) { throw "Snapshot device count does not match the fetch summary." }
Write-Host "Validated $($summary.currentTotal) current devices, generated $($summary.generatedAt)." -ForegroundColor Green
Write-Host ""

$changes = git status --porcelain
if (-not $changes) {
  Write-Host "No changes were found. Nothing to deploy." -ForegroundColor Yellow
  exit 0
}

$commitMessage = "Deploy STC dashboard " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

$deploymentId = [Guid]::NewGuid().ToString("N").Substring(0, 12)
$deploymentInfo = [ordered]@{
  deploymentId = $deploymentId
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $projectRoot "deployment.json"), $deploymentInfo + "`n", $utf8WithoutBom)

git add --all
git diff --cached --check
if ($LASTEXITCODE -ne 0) { throw "Git validation failed." }

git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }

git push origin main
if ($LASTEXITCODE -ne 0) { throw "GitHub push failed." }

$commitSha = (git rev-parse --short HEAD).Trim()
Write-Host ""
Write-Host "Pushed commit $commitSha. Waiting for Hostinger deployment..." -ForegroundColor Cyan

$healthUrl = "https://devices.stcdigitalhub.com/health"
$deadline = (Get-Date).AddMinutes(8)
while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 15
    if ($health.status -eq "ok" -and $health.deploymentId -eq $deploymentId -and $health.cachedDataLoaded -and ([DateTimeOffset]$health.cachedDataGeneratedAt) -eq ([DateTimeOffset]$summary.generatedAt)) {
      $homepage = Invoke-WebRequest -Uri "https://devices.stcdigitalhub.com/" -UseBasicParsing -TimeoutSec 15
      if ($homepage.StatusCode -ne 200) { throw "The dashboard homepage did not return HTTP 200." }
      Write-Host ""
      Write-Host "Deployment completed successfully." -ForegroundColor Green
      Write-Host "Commit: $commitSha"
      Write-Host "Website: https://devices.stcdigitalhub.com/"
      Start-Process "https://devices.stcdigitalhub.com/"
      exit 0
    }
  } catch {
    # Hostinger may briefly return 503 while replacing the running release.
  }
  Start-Sleep -Seconds 10
}

Write-Host ""
Write-Host "The GitHub push succeeded, but the new Hostinger release was not verified within 8 minutes." -ForegroundColor Red
Write-Host "Expected deployment ID: $deploymentId"
Write-Host "Check Hostinger Deployments and Runtime Logs."
exit 1
