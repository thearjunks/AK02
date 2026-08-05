$ErrorActionPreference = "Stop"

$configDir = Join-Path $env:LOCALAPPDATA "STCDeviceDashboard"
$settingsPath = Join-Path $configDir "email-settings.json"
$credentialPath = Join-Path $configDir "gmail-credential.xml"
$recipient = "thearjunks@gmail.com"

New-Item -ItemType Directory -Path $configDir -Force | Out-Null

Write-Host "STC Dashboard Email Setup" -ForegroundColor Cyan
Write-Host "Use a Gmail App Password, not your normal Gmail password."
Write-Host "The password is encrypted for this Windows user and this computer."
Write-Host ""

$sender = Read-Host "Gmail sender address (press Enter for thearjunks@gmail.com)"
if ([string]::IsNullOrWhiteSpace($sender)) { $sender = "thearjunks@gmail.com" }
$appPassword = Read-Host "Enter the 16-character Gmail App Password" -AsSecureString
$credential = [PSCredential]::new($sender, $appPassword)
$credential | Export-Clixml -LiteralPath $credentialPath -Force

$settings = [ordered]@{
  sender = $sender
  recipient = $recipient
  smtpServer = "smtp.gmail.com"
  smtpPort = 587
} | ConvertTo-Json
[IO.File]::WriteAllText($settingsPath, $settings + "`n", [Text.UTF8Encoding]::new($false))

$message = [Net.Mail.MailMessage]::new($sender, $recipient)
$message.Subject = "STC dashboard automation - test email"
$message.Body = "Email notifications are configured successfully on $env:COMPUTERNAME."
$smtp = [Net.Mail.SmtpClient]::new("smtp.gmail.com", 587)
$smtp.EnableSsl = $true
$smtp.Credentials = $credential.GetNetworkCredential()
try {
  $smtp.Send($message)
} finally {
  $message.Dispose()
  $smtp.Dispose()
}

Write-Host ""
Write-Host "Test email sent successfully to $recipient." -ForegroundColor Green
