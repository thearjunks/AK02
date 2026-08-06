$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runner = Join-Path $PSScriptRoot "automated-refresh-deploy.ps1"
$taskName = "STC Device Dashboard - Refresh and Deploy"
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$timeZone = Get-TimeZone

if ($timeZone.Id -ne "Arab Standard Time") {
  throw "Windows timezone must be Kuwait (UTC+03:00) before installing this task. Current timezone: $($timeZone.DisplayName)"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
  -WorkingDirectory $projectRoot

$triggers = @(New-ScheduledTaskTrigger -Daily -At "10:00 AM")
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description "At 10 AM Kuwait time, validate STC devices, push AK02, verify Hostinger, and email every stage. Fridays, Saturdays, and Kuwait public holidays are skipped." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
Write-Host "Scheduled automation installed successfully." -ForegroundColor Green
Write-Host "Task: $taskName"
Write-Host "Windows timezone: $($timeZone.DisplayName)"
$task.Triggers | Select-Object StartBoundary | Format-Table
Write-Host "The computer must be on and this Windows user must be signed in."
