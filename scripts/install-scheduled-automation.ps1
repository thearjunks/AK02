$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runner = Join-Path $PSScriptRoot "automated-refresh-deploy.ps1"
$taskName = "STC Device Dashboard - Refresh and Deploy"
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
  -WorkingDirectory $projectRoot

$days = @("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday")
$triggers = @(
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $days -At "10:00 AM"
  New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek $days -At "3:00 PM"
)
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
  -Description "Fetch STC devices, push AK02 to GitHub, verify Hostinger, and email results at 10 AM and 3 PM Sunday-Thursday." `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
Write-Host "Scheduled automation installed successfully." -ForegroundColor Green
Write-Host "Task: $taskName"
Write-Host "Windows timezone: $((Get-TimeZone).DisplayName)"
$task.Triggers | Select-Object StartBoundary, DaysOfWeek | Format-Table
Write-Host "The computer must be on and this Windows user must be signed in."
