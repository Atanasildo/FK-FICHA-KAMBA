$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$appData = Join-Path $env:LOCALAPPDATA "FichaKamba"
$logs = Join-Path $appData "logs"
New-Item -ItemType Directory -Force -Path $appData, $logs | Out-Null
Write-Host ""
Write-Host "INSTALADOR DA RECOLHA DIARIA — FICHA KAMBA" -ForegroundColor Cyan
Write-Host "As credenciais serão guardadas cifradas para este utilizador do Windows."
$cron = Read-Host "Introduz o CRON_SECRET actual" -AsSecureString
$bypass = Read-Host "Introduz o VERCEL_AUTOMATION_BYPASS_SECRET actual" -AsSecureString
if ($cron.Length -lt 1 -or $bypass.Length -lt 1) { throw "As duas credenciais são necessárias." }
$secretsPath = Join-Path $appData "secrets.json"
([ordered]@{ cronSecret=(ConvertFrom-SecureString $cron); vercelBypass=(ConvertFrom-SecureString $bypass) } | ConvertTo-Json) |
  Set-Content -LiteralPath $secretsPath -Encoding UTF8
$config = [ordered]@{
  repoPath = $repoRoot
  nodePath = $nodePath
  apiBaseUrl = "https://fk-ficha-kamba-git-feat-swarm-live-stats-atanasildos-projects.vercel.app"
  maxGames = 150
  pollSeconds = 60
  retryMinutes = 15
  secretsPath = $secretsPath
  statePath = (Join-Path $appData "daily-state.json")
  logDir = $logs
}
$configPath = Join-Path $appData "daily-collector-config.json"
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$userAcl = '{0}:(R,W)' -f $currentUser
$aclArgs = @($secretsPath, '/inheritance:r', '/grant:r', $userAcl, 'SYSTEM:(R)')
& icacls.exe @aclArgs | Out-Null
$supervisor = Join-Path $PSScriptRoot "daily-collector-supervisor.ps1"
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $supervisor + '" -ConfigPath "' + $configPath + '"'
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName "Ficha Kamba - Recolha diaria" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName "Ficha Kamba - Recolha diaria"
Write-Host ""
Write-Host "Instalacao concluida." -ForegroundColor Green
Write-Host "A tarefa inicia no início da sessão Windows e verifica a Internet a cada $($config.pollSeconds) segundos."
Write-Host "Máximo: uma recolha confirmada por dia, até $($config.maxGames) jogos."
Write-Host "Logs: $logs"
