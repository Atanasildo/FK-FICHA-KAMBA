$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$appData = Join-Path $env:LOCALAPPDATA 'FichaKamba'
$logs = Join-Path $appData 'logs'
New-Item -ItemType Directory -Force -Path $appData, $logs | Out-Null

Write-Host ''
Write-Host 'FICHA KAMBA - DAILY COLLECTOR INSTALLER' -ForegroundColor Cyan
Write-Host 'Secrets will be stored encrypted for this Windows user.'
$cron = Read-Host 'Enter the current CRON_SECRET' -AsSecureString
$bypass = Read-Host 'Enter the current VERCEL_AUTOMATION_BYPASS_SECRET' -AsSecureString
if ($cron.Length -lt 1 -or $bypass.Length -lt 1) {
    throw 'Both credentials are required.'
}

$secretsPath = Join-Path $appData 'secrets.json'
$secretData = [ordered]@{
    cronSecret = ConvertFrom-SecureString $cron
    vercelBypass = ConvertFrom-SecureString $bypass
}
$secretData | ConvertTo-Json | Set-Content -LiteralPath $secretsPath -Encoding UTF8

$config = [ordered]@{
    repoPath = $repoRoot
    nodePath = $nodePath
    apiBaseUrl = 'https://fk-ficha-kamba-git-feat-swarm-live-stats-atanasildos-projects.vercel.app'
    maxGames = 150
    pollSeconds = 60
    retryMinutes = 15
    secretsPath = $secretsPath
    statePath = Join-Path $appData 'daily-state.json'
    logDir = $logs
}
$configPath = Join-Path $appData 'daily-collector-config.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$userAcl = '{0}:(R,W)' -f $currentUser
$aclArgs = @($secretsPath, '/inheritance:r', '/grant:r', $userAcl, 'SYSTEM:(R)')
& icacls.exe @aclArgs | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Could not set permissions on the encrypted secrets file.'
}

$supervisor = Join-Path $PSScriptRoot 'daily-collector-supervisor.ps1'
$taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $supervisor, $configPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'Ficha Kamba - Recolha diaria' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'Ficha Kamba - Recolha diaria'

Write-Host ''
Write-Host 'Installation completed.' -ForegroundColor Green
Write-Host ('The task starts at Windows sign-in and checks Internet every {0} seconds.' -f $config.pollSeconds)
Write-Host ('Maximum: one confirmed collection per day, up to {0} games.' -f $config.maxGames)
Write-Host ('Logs: {0}' -f $logs)
