param(
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"

function Get-KuwaitNow {
  $timeZone = [TimeZoneInfo]::FindSystemTimeZoneById("Arab Standard Time")
  [TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $timeZone)
}

function Get-DaySkipReason([DateTime]$Date, [string[]]$HolidayDates, [hashtable]$HolidayNames) {
  if ($Date.DayOfWeek -in @([DayOfWeek]::Friday, [DayOfWeek]::Saturday)) {
    return "$($Date.DayOfWeek) is a non-deployment day."
  }
  $dateKey = $Date.ToString("yyyy-MM-dd")
  if ($dateKey -in $HolidayDates) {
    return "Kuwait public holiday: $($HolidayNames[$dateKey])."
  }
  return $null
}

if ($SelfTest) {
  $names = @{ "2026-02-25" = "National Day" }
  if (-not (Get-DaySkipReason ([DateTime]"2026-08-07") @() @{})) { throw "Friday test failed." }
  if (-not (Get-DaySkipReason ([DateTime]"2026-08-08") @() @{})) { throw "Saturday test failed." }
  if (-not (Get-DaySkipReason ([DateTime]"2026-02-25") @("2026-02-25") $names)) { throw "Holiday test failed." }
  if (Get-DaySkipReason ([DateTime]"2026-08-09") @() @{}) { throw "Working-day test failed." }
  Write-Host "Automation schedule self-test passed."
  exit 0
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$configDir = Join-Path $env:LOCALAPPDATA "STCDeviceDashboard"
$settingsPath = Join-Path $configDir "email-settings.json"
$credentialPath = Join-Path $configDir "gmail-credential.xml"
$logDir = Join-Path $configDir "logs"
$statePath = Join-Path $configDir "last-successful-run.json"
$holidayCachePath = Join-Path $configDir "kuwait-holidays.ics"
$holidayUrl = "https://calendar.google.com/calendar/ical/en.kw%23holiday%40group.v.calendar.google.com/public/basic.ics"
$kuwaitNow = Get-KuwaitNow
$runId = $kuwaitNow.ToString("yyyyMMdd-HHmmss")
$logPath = Join-Path $logDir "automation-$runId.log"
$websiteUrl = "https://devices.stcdigitalhub.com/"
$healthUrl = "https://devices.stcdigitalhub.com/health"
$mutex = [Threading.Mutex]::new($false, "Local\STCDeviceDashboardAutomation")
$stageNames = @(
  "Data Fetch Started",
  "Data Fetch Completed",
  "Dashboard Update Completed",
  "GitHub Commit Started",
  "GitHub Commit Completed",
  "Hostinger Deployment Started",
  "Hostinger Deployment Completed"
)
$sentStages = @{}
$runFinalized = $false

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
if (-not $mutex.WaitOne(0)) {
  "Another automation run is already active." | Set-Content -LiteralPath $logPath
  exit 2
}

function Write-RunLog([string]$Message) {
  $line = "[$((Get-KuwaitNow).ToString('yyyy-MM-dd HH:mm:ss')) KWT] $Message"
  $line | Tee-Object -FilePath $logPath -Append | Write-Host
}

function Send-StageNotification([string]$Stage, [string]$Status, [string]$Details) {
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  $credential = Import-Clixml -LiteralPath $credentialPath
  $timestamp = (Get-KuwaitNow).ToString("yyyy-MM-dd HH:mm:ss 'KWT'")
  $message = [Net.Mail.MailMessage]::new($settings.sender, $settings.recipient)
  $message.Subject = "STC dashboard - $Stage - $Status"
  $message.Body = @"
Stage: $Stage
Status: $Status
Timestamp: $timestamp
Run: $runId
Computer: $env:COMPUTERNAME

$Details

Log: $logPath
"@
  $smtp = [Net.Mail.SmtpClient]::new($settings.smtpServer, [int]$settings.smtpPort)
  $smtp.EnableSsl = $true
  $smtp.Credentials = $credential.GetNetworkCredential()
  try {
    $smtp.Send($message)
    $script:sentStages[$Stage] = $true
    Write-RunLog "Email sent: $Stage - $Status."
  } finally {
    $message.Dispose()
    $smtp.Dispose()
  }
}

function Send-RemainingSkipped([string]$Reason) {
  foreach ($stage in $stageNames) {
    if (-not $sentStages.ContainsKey($stage)) {
      Send-StageNotification $stage "SKIPPED" $Reason
    }
  }
}

function Complete-SkippedRun([string]$Reason) {
  Write-RunLog "Automation skipped: $Reason"
  Send-RemainingSkipped $Reason
  Send-StageNotification "Deployment Summary" "SKIPPED" $Reason
  $script:runFinalized = $true
}

function Stop-FailedRun([string]$FailedStage, [string]$Reason) {
  Write-RunLog "$FailedStage failed: $Reason"
  if (-not $sentStages.ContainsKey($FailedStage)) {
    Send-StageNotification $FailedStage "FAILED" $Reason
  }
  Send-RemainingSkipped "Skipped because $FailedStage failed. Reason: $Reason"
  Send-StageNotification "Deployment Summary" "FAILED" "Failed stage: $FailedStage`r`nReason: $Reason"
  $script:runFinalized = $true
  throw $Reason
}

function Get-KuwaitPublicHolidays {
  try {
    $calendar = (Invoke-WebRequest -UseBasicParsing -Uri $holidayUrl -TimeoutSec 30).Content
    [IO.File]::WriteAllText($holidayCachePath, $calendar, [Text.UTF8Encoding]::new($false))
    Write-RunLog "Kuwait holiday calendar refreshed."
  } catch {
    if (-not (Test-Path -LiteralPath $holidayCachePath)) {
      throw "Kuwait holiday calendar could not be refreshed and no cache exists: $($_.Exception.Message)"
    }
    $calendar = Get-Content -LiteralPath $holidayCachePath -Raw
    Write-RunLog "Holiday refresh failed; using cached calendar. $($_.Exception.Message)"
  }

  $calendar = $calendar -replace "`r?`n[ `t]", ""
  $dates = [Collections.Generic.List[string]]::new()
  $names = @{}
  foreach ($event in [regex]::Matches($calendar, "(?s)BEGIN:VEVENT\r?\n(.*?)END:VEVENT")) {
    $body = $event.Groups[1].Value
    $dateMatch = [regex]::Match($body, "DTSTART;VALUE=DATE:(\d{8})")
    $nameMatch = [regex]::Match($body, "SUMMARY:([^\r\n]+)")
    $descriptionMatch = [regex]::Match($body, "DESCRIPTION:([^\r\n]+)")
    if ($dateMatch.Success -and $nameMatch.Success -and $descriptionMatch.Value -like "*Public holiday*") {
      $date = [DateTime]::ParseExact($dateMatch.Groups[1].Value, "yyyyMMdd", $null).ToString("yyyy-MM-dd")
      $dates.Add($date)
      $names[$date] = $nameMatch.Groups[1].Value.Replace("\,", ",")
    }
  }
  if ($dates.Count -eq 0) { throw "The Kuwait holiday calendar contained no public holidays." }
  @{ Dates = $dates.ToArray(); Names = $names }
}

try {
  if (-not (Test-Path -LiteralPath $settingsPath) -or -not (Test-Path -LiteralPath $credentialPath)) {
    throw "Email is not configured. Run scripts\setup-email-notifications.ps1 first."
  }

  Set-Location $projectRoot
  Write-RunLog "Automation started on $env:COMPUTERNAME."

  try {
    $holidays = Get-KuwaitPublicHolidays
  } catch {
    Stop-FailedRun "Data Fetch Started" $_.Exception.Message
  }

  $skipReason = Get-DaySkipReason $kuwaitNow $holidays.Dates $holidays.Names
  if ($skipReason) {
    Complete-SkippedRun $skipReason
    exit 0
  }

  if (Test-Path -LiteralPath $statePath) {
    $lastRun = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($lastRun.kuwaitDate -eq $kuwaitNow.ToString("yyyy-MM-dd")) {
      Complete-SkippedRun "A successful deployment has already completed today (run $($lastRun.runId))."
      exit 0
    }
  }

  $allowedDirtyPaths = @("data/latest-snapshot.json", "deployment.json")
  $dirtyPaths = @(git status --porcelain | ForEach-Object { $_.Substring(3).Replace('\', '/') })
  $unrelatedChanges = @($dirtyPaths | Where-Object { $_ -notin $allowedDirtyPaths })
  if ($unrelatedChanges.Count -gt 0) {
    Stop-FailedRun "Data Fetch Started" "Unrelated working-tree changes must be committed first: $($unrelatedChanges -join ', ')"
  }

  git restore -- data/latest-snapshot.json deployment.json 2>$null
  git pull --ff-only origin main | ForEach-Object { Write-RunLog $_ }
  if ($LASTEXITCODE -ne 0) { Stop-FailedRun "Data Fetch Started" "Git pull failed." }

  Send-StageNotification "Data Fetch Started" "STARTED" "Fetching the latest STC Kuwait device data."
  try {
    $fetchOutput = & node (Join-Path $PSScriptRoot "fetch-live-data.mjs") 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($fetchOutput -join [Environment]::NewLine) }
    $summary = ($fetchOutput -join "") | ConvertFrom-Json
  } catch {
    Stop-FailedRun "Data Fetch Completed" $_.Exception.Message
  }
  Send-StageNotification "Data Fetch Completed" "SUCCESS" "Generated: $($summary.generatedAt)`r`nCurrent devices: $($summary.currentTotal)`r`nDisplayed devices: $($summary.displayedTotal)`r`nAdded: $($summary.added)`r`nRemoved: $($summary.removed)`r`nColor / SKU rows: $($summary.colors)"

  try {
    $snapshotPath = Join-Path $projectRoot "data\latest-snapshot.json"
    $snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
    $generatedAt = [DateTimeOffset]$snapshot.generatedAt
    if ($generatedAt -ne [DateTimeOffset]$summary.generatedAt) { throw "Fetch summary and snapshot timestamps do not match." }
    if ((([DateTimeOffset]::UtcNow) - $generatedAt.ToUniversalTime()).TotalMinutes -gt 60) { throw "Fetched snapshot is older than 60 minutes." }
    if ([int]$summary.currentTotal -le 0) { throw "Current device total is zero." }
    if ([int]$summary.displayedTotal -lt [int]$summary.currentTotal) { throw "Displayed device total is lower than current total." }
    if ($snapshot.devices.Count -ne [int]$summary.displayedTotal) { throw "Snapshot device count does not match the fetch summary." }
    foreach ($dataset in @("colors", "plans", "zeed")) {
      if ($null -eq $snapshot.$dataset) { throw "Snapshot is missing the $dataset dataset." }
    }
  } catch {
    Stop-FailedRun "Dashboard Update Completed" $_.Exception.Message
  }
  Send-StageNotification "Dashboard Update Completed" "SUCCESS" "The latest snapshot passed validation and is ready to publish. No live files were updated before this validation completed."

  Send-StageNotification "GitHub Commit Started" "STARTED" "Preparing the validated dashboard snapshot for the main branch."
  try {
    $deploymentId = [Guid]::NewGuid().ToString("N").Substring(0, 12)
    $deploymentInfo = [ordered]@{
      deploymentId = $deploymentId
      createdAt = [DateTime]::UtcNow.ToString("o")
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $projectRoot "deployment.json"), $deploymentInfo + "`n", [Text.UTF8Encoding]::new($false))

    git add -- data/latest-snapshot.json deployment.json
    git diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw "Git validation failed." }
    git commit -m "Automated STC data refresh $($kuwaitNow.ToString('yyyy-MM-dd HH:mm')) KWT"
    if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "GitHub push failed." }
    $commitSha = (git rev-parse --short HEAD).Trim()
  } catch {
    Stop-FailedRun "GitHub Commit Completed" $_.Exception.Message
  }
  Send-StageNotification "GitHub Commit Completed" "SUCCESS" "Commit: $commitSha`r`nBranch: main`r`nDeployment ID: $deploymentId"

  Send-StageNotification "Hostinger Deployment Started" "STARTED" "GitHub push completed. Waiting for Hostinger auto-deployment $deploymentId."
  try {
    $deadline = (Get-Date).AddMinutes(12)
    $lastDeploymentError = "No response received."
    $deployed = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 20
        if ($health.status -eq "ok" -and $health.deploymentId -eq $deploymentId -and $health.cachedDataLoaded) {
          $homepage = Invoke-WebRequest -Uri $websiteUrl -UseBasicParsing -TimeoutSec 20
          if ($homepage.StatusCode -eq 200 -and ([DateTimeOffset]$health.cachedDataGeneratedAt) -eq ([DateTimeOffset]$summary.generatedAt)) {
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
  } catch {
    Stop-FailedRun "Hostinger Deployment Completed" $_.Exception.Message
  }
  Send-StageNotification "Hostinger Deployment Completed" "SUCCESS" "Commit $commitSha is live at $websiteUrl with snapshot $($summary.generatedAt)."

  $state = [ordered]@{
    kuwaitDate = $kuwaitNow.ToString("yyyy-MM-dd")
    completedAt = (Get-KuwaitNow).ToString("o")
    runId = $runId
    commit = $commitSha
    deploymentId = $deploymentId
    generatedAt = $summary.generatedAt
  } | ConvertTo-Json
  [IO.File]::WriteAllText($statePath, $state + "`n", [Text.UTF8Encoding]::new($false))

  Send-StageNotification "Deployment Summary" "SUCCESS" "All validation, GitHub, Hostinger, and live website checks completed successfully.`r`nCommit: $commitSha`r`nDeployment ID: $deploymentId`r`nSnapshot: $($summary.generatedAt)`r`nWebsite: $websiteUrl"
  $runFinalized = $true
  Write-RunLog "Automation completed successfully."
  exit 0
} catch {
  Write-RunLog "Automation stopped: $($_.Exception.Message)"
  if (-not $runFinalized -and (Test-Path -LiteralPath $settingsPath) -and (Test-Path -LiteralPath $credentialPath)) {
    try {
      Send-RemainingSkipped "Automation stopped before this stage. Reason: $($_.Exception.Message)"
      Send-StageNotification "Deployment Summary" "FAILED" $_.Exception.Message
    } catch {
      Write-RunLog "Failure notification could not be sent: $($_.Exception.Message)"
    }
  }
  exit 1
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
