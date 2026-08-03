$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $projectRoot

Write-Host "STC Dashboard - Commit and Deploy" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"
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
    if ($health.status -eq "ok" -and $health.deploymentId -eq $deploymentId) {
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
