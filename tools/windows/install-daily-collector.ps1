$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
$appData = Join-Path $env:LOCALAPPDATA 'FichaKamba'
$logs = Join-Path $appData 'logs'
New-Item -ItemType Directory -Force -Path $appData, $logs | Out-Null

Write-Host ''
Write-Host 'FICHA KAMBA - DAILY COLLECTOR INSTALLER' -ForegroundColor Cyan
Write-Host 'Credentials will be entered in a masked Windows dialog and stored encrypted for this Windows user.'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ficha Kamba - Credenciais'
$form.Size = New-Object System.Drawing.Size(570, 270)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$labelCron = New-Object System.Windows.Forms.Label
$labelCron.Text = 'CRON_SECRET'
$labelCron.Location = New-Object System.Drawing.Point(18, 20)
$labelCron.Size = New-Object System.Drawing.Size(510, 22)
$form.Controls.Add($labelCron)

$textCron = New-Object System.Windows.Forms.TextBox
$textCron.Location = New-Object System.Drawing.Point(18, 45)
$textCron.Size = New-Object System.Drawing.Size(515, 25)
$textCron.UseSystemPasswordChar = $true
$textCron.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$form.Controls.Add($textCron)

$labelBypass = New-Object System.Windows.Forms.Label
$labelBypass.Text = 'VERCEL_AUTOMATION_BYPASS_SECRET'
$labelBypass.Location = New-Object System.Drawing.Point(18, 82)
$labelBypass.Size = New-Object System.Drawing.Size(510, 22)
$form.Controls.Add($labelBypass)

$textBypass = New-Object System.Windows.Forms.TextBox
$textBypass.Location = New-Object System.Drawing.Point(18, 107)
$textBypass.Size = New-Object System.Drawing.Size(515, 25)
$textBypass.UseSystemPasswordChar = $true
$textBypass.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$form.Controls.Add($textBypass)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'Cole cada chave completa (Ctrl+V). Os caracteres ficam ocultos.'
$hint.Location = New-Object System.Drawing.Point(18, 145)
$hint.Size = New-Object System.Drawing.Size(515, 22)
$form.Controls.Add($hint)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = 'Guardar credenciais'
$okButton.Location = New-Object System.Drawing.Point(310, 185)
$okButton.Size = New-Object System.Drawing.Size(140, 32)
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($okButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancelar'
$cancelButton.Location = New-Object System.Drawing.Point(458, 185)
$cancelButton.Size = New-Object System.Drawing.Size(75, 32)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancelButton)
$form.AcceptButton = $okButton
$form.CancelButton = $cancelButton

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    $textCron.Clear()
    $textBypass.Clear()
    $form.Dispose()
    throw 'Installation cancelled. No credentials were changed.'
}

$cronText = $textCron.Text.Trim()
$bypassText = $textBypass.Text.Trim()
$textCron.Clear()
$textBypass.Clear()
$form.Dispose()

if ($cronText.Length -lt 20 -or $bypassText.Length -lt 20) {
    $cronText = $null
    $bypassText = $null
    throw 'A credential appears incomplete (fewer than 20 characters). Nothing was installed. Re-run the installer and paste both complete keys.'
}

$cron = ConvertTo-SecureString $cronText -AsPlainText -Force
$bypass = ConvertTo-SecureString $bypassText -AsPlainText -Force
$cronText = $null
$bypassText = $null

$secretsPath = Join-Path $appData 'secrets.json'
$secretData = [ordered]@{
    cronSecret = ConvertFrom-SecureString $cron
    vercelBypass = ConvertFrom-SecureString $bypass
}
$secretData | ConvertTo-Json | Set-Content -LiteralPath $secretsPath -Encoding UTF8
$cron.Dispose()
$bypass.Dispose()

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

$taskName = 'Ficha Kamba - Recolha diaria'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.State -eq 'Running') {
    Stop-ScheduledTask -TaskName $taskName
    Start-Sleep -Seconds 2
}

$supervisor = Join-Path $PSScriptRoot 'daily-collector-supervisor.ps1'
$taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $supervisor, $configPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ''
Write-Host 'Installation completed.' -ForegroundColor Green
Write-Host 'Credential lengths were validated before saving.'
Write-Host 'The previous supervisor instance was restarted with the new credentials.'
Write-Host ('The task starts at Windows sign-in and checks Internet every {0} seconds.' -f $config.pollSeconds)
Write-Host ('Maximum: one confirmed collection per day, up to {0} games.' -f $config.maxGames)
Write-Host ('Logs: {0}' -f $logs)
