$ErrorActionPreference = 'Stop'
# Instala a tarefa agendada "Ficha Kamba - Ao vivo": recolhe os jogos ao vivo (SofaScore) a cada
# minuto e grava em match_statistics para os boletins e o painel Ao vivo. Nao pede chave: reutiliza
# a configuracao e a chave cifrada ja criadas por install-reserve-task.ps1.
$appData = Join-Path $env:LOCALAPPDATA 'FichaKamba'
$configPath = Join-Path $appData 'reserve-config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
    throw 'Falta a configuracao das reservas. Corre primeiro tools\windows\install-reserve-task.ps1.'
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'tools\collect-live-sofascore.js'))) {
    throw 'tools\collect-live-sofascore.js nao existe nesta pasta. Faz git pull do branch com o ao vivo e volta a correr.'
}
$taskName = 'Ficha Kamba - Ao vivo'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName; Start-Sleep -Seconds 2 }
$supervisor = Join-Path $PSScriptRoot 'live-supervisor.ps1'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $supervisor, $configPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host ''
Write-Host 'Instalado.' -ForegroundColor Green
Write-Host 'A tarefa arranca ao iniciar sessao e recolhe os jogos ao vivo a cada minuto.'
Write-Host ('Registo: {0}\logs\ao-vivo-AAAA-MM-DD.log' -f $appData)
