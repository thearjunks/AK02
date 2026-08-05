$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDir = Join-Path $env:LOCALAPPDATA "STCDeviceDashboard"
$settingsPath = Join-Path $configDir "email-settings.json"
$credentialPath = Join-Path $configDir "gmail-credential.xml"
$logDir = Join-Path $configDir "logs"
$runId = (Get-Date).ToString("yyyyMMdd-HHmmss")
$logPath = Join-Path $logDir "automation-$runId.log"
$websiteUrl = "https://devices.stcdigitalhub.com/"
$healthUrl = "https://devices.stcdigitalhub.com/health"
$mutex = [Threading.Mutex]::new($false, "Local\STCDeviceDashboardAutomation")

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
if (-not $mutex.WaitOne(0)) {
  "Another automation run is already active." | Set-Content -LiteralPath $logPath
  exit 2
}

$log = [Text.StringBuilder]::new()
function Write-RunLog([string]$Message) {
  $line = "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] $Message"
  $line | Tee-Object -FilePath $logPath -Append | Write-Host
  [void]$log.AppendLine($line)
}

function Send-Notification([string]$Subject, [string]$Body) {
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  $credential = Import-Clixml -LiteralPath $credentialPath
  $message = [Net.Mail.MailMessage]::new($settings.sender, $settings.recipient)
  $message.Subject = $Subject
  $message.Body = $Body
  $smtp = [Net.Mail.SmtpClient]::new($settings.smtpServer, [int]$settings.smtpPort)
  $smtp.EnableSsl = $true
  $smtp.Credentials = $credential.GetNetworkCredential()
  try {
    $smtp.Send($message)
  } finally {
    $message.Dispose()
    $smtp.Dispose()
  }
}

try {
  if (-not (Test-Path -LiteralPath $settingsPath) -or -not (Test-Path -LiteralPath $credentialPath)) {
    throw "Email is not configured. Run scripts\setup-email-notifications.ps1 first."
  }

  Set-Location $projectRoot
  Write-RunLog "Automation started on $env:COMPUTERNAME."

  $allowedDirtyPaths = @("data/latest-snapshot.json", "deployment.json")
  $dirtyPaths = @(git status --porcelain | ForEach-Object { $_.Substring(3).Replace('\', '/') })
  $unrelatedChanges = @($dirtyPaths | Where-Object { $_ -notin $allowedDirtyPaths })
  if ($unrelatedChanges.Count -gt 0) {
    throw "Unrelated working-tree changes must be committed first: $($unrelatedChanges -join ', ')"
  }

  git restore -- data/latest-snapshot.json deployment.json 2>$null
  git pull --ff-only origin main | ForEach-Object { Write-RunLog $_ }
  if ($LASTEXITCODE -ne 0) { throw "Git pull failed." }

  try {
    Write-RunLog "Fetching current STC device data."
    $fetchOutput = & node (Join-Path $PSScriptRoot "fetch-live-data.mjs") 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($fetchOutput -join [Environment]::NewLine) }
    $summary = ($fetchOutput -join "") | ConvertFrom-Json
    Write-RunLog "Fetch succeeded: $($summary.currentTotal) current, $($summary.displayedTotal) displayed, generated $($summary.generatedAt)."
    Send-Notification "STC dashboard - Data Fetch Success" @"
Data fetch completed successfully.

Generated: $($summary.generatedAt)
Current devices: $($summary.currentTotal)
Displayed devices: $($summary.displayedTotal)
Added: $($summary.added)
Removed: $($summary.removed)
Color / SKU rows: $($summary.colors)
Computer: $env:COMPUTERNAME
Run: $runId
"@
  } catch {
    $reason = $_.Exception.Message
    Write-RunLog "Fetch failed: $reason"
    Send-Notification "STC dashboard - Data Fetch Failure" "Data fetch failed immediately.`r`n`r`nReason: $reason`r`nComputer: $env:COMPUTERNAME`r`nRun: $runId`r`nLog: $logPath"
    throw
  }

  try {
    $deploymentId = [Guid]::NewGuid().ToString("N").Substring(0, 12)
    $deploymentInfo = [ordered]@{
      deploymentId = $deploymentId
      createdAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $projectRoot "deployment.json"), $deploymentInfo + "`n", [Text.UTF8Encoding]::new($false))

    git add -- data/latest-snapshot.json deployment.json
    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw "Git validation failed." }
    git commit -m "Automated STC data refresh $((Get-Date).ToString('yyyy-MM-dd HH:mm'))"
    if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "GitHub push failed." }

    $commitSha = (git rev-parse --short HEAD).Trim()
    Write-RunLog "Pushed commit $commitSha. Waiting for Hostinger deployment $deploymentId."
    $deadline = (Get-Date).AddMinutes(12)
    $lastDeploymentError = "No response received."
    $deployed = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 20
        if ($health.status -eq "ok" -and $health.deploymentId -eq $deploymentId -and $health.cachedDataLoaded) {
          $homepage = Invoke-WebRequest -Uri $websiteUrl -UseBasicParsing -TimeoutSec 20
          $cachedData = Invoke-RestMethod -Uri "$($websiteUrl)api/cached-data" -TimeoutSec 30
          if ($homepage.StatusCode -eq 200 -and $cachedData.generatedAt -eq $summary.generatedAt) {
            $deployed = $true
            break
          }
        }
        $lastDeploymentError = "Expected deployment $deploymentId with snapshot $($summary.generatedAt), but production is not ready yet."
      } catch {
        $lastDeploymentError = $_.Exception.Message
      }
      Start-Sleep -Seconds 15
    }
    if (-not $deployed) { throw "Hostinger verification timed out. $lastDeploymentError" }

    Write-RunLog "Deployment succeeded: commit $commitSha is live."
    Send-Notification "STC dashboard - Deployment Success" "Deployment completed successfully.`r`n`r`nCommit: $commitSha`r`nDeployment ID: $deploymentId`r`nWebsite: $websiteUrl`r`nRun: $runId"
  } catch {
    $reason = $_.Exception.Message
    Write-RunLog "Deployment failed: $reason"
    Send-Notification "STC dashboard - Deployment Failure" "Deployment failed.`r`n`r`nReason: $reason`r`nRun: $runId`r`nLog: $logPath`r`n`r`nRecent log:`r`n$($log.ToString())"
    throw
  }

  Write-RunLog "Automation completed successfully."
  exit 0
} catch {
  Write-RunLog "Automation stopped: $($_.Exception.Message)"
  exit 1
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
