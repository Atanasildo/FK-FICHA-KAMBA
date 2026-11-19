$ErrorActionPreference = 'Stop'
# Instala a tarefa agendada "Ficha Kamba - Reservas": pede os codigos de reserva dos
# boletins publicados sem codigo, a cada 2 minutos, a partir deste PC (o Swarm recusa a Vercel).

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'tools\reserve-pending.js'))) {
    throw 'tools\reserve-pending.js nao existe nesta pasta. Faz git pull do branch com a reserva e volta a correr.'
}
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) {
    throw 'Falta a pasta node_modules. Corre npm install nesta pasta e volta a correr.'
}
$appData = Join-Path $env:LOCALAPPDATA 'FichaKamba'
$logs = Join-Path $appData 'logs'
New-Item -ItemType Directory -Force -Path $appData, $logs | Out-Null

Write-Host ''
Write-Host 'FICHA KAMBA - INSTALADOR DAS RESERVAS' -ForegroundColor Cyan
Write-Host 'A chave fica cifrada para este utilizador do Windows e nunca e escrita em texto simples.'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Ficha Kamba - Reservas'
$form.Size = New-Object System.Drawing.Size(570, 210)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Text = 'SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API Keys)'
$label.Location = New-Object System.Drawing.Point(18, 20)
$label.Size = New-Object System.Drawing.Size(515, 22)
$form.Controls.Add($label)

$text = New-Object System.Windows.Forms.TextBox
$text.Location = New-Object System.Drawing.Point(18, 45)
$text.Size = New-Object System.Drawing.Size(515, 25)
$text.UseSystemPasswordChar = $true
$form.Controls.Add($text)

$okButton = New-Object System.Windows.Forms.Button
$okButton.Text = 'Guardar chave'
$okButton.Location = New-Object System.Drawing.Point(310, 110)
$okButton.Size = New-Object System.Drawing.Size(140, 32)
$okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($okButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Text = 'Cancelar'
$cancelButton.Location = New-Object System.Drawing.Point(458, 110)
$cancelButton.Size = New-Object System.Drawing.Size(75, 32)
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancelButton)
$form.AcceptButton = $okButton
$form.CancelButton = $cancelButton

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    $text.Clear(); $form.Dispose()
    throw 'Instalacao cancelada. Nada foi alterado.'
}
$keyText = $text.Text.Trim()
$text.Clear(); $form.Dispose()
if ($keyText.Length -lt 20) {
    $keyText = $null
    throw 'A chave parece incompleta (menos de 20 caracteres). Nada foi instalado.'
}
$secure = ConvertTo-SecureString $keyText -AsPlainText -Force
$keyText = $null

$secretsPath = Join-Path $appData 'reserve-secrets.json'
([ordered]@{ supabaseServiceRoleKey = ConvertFrom-SecureString $secure }) | ConvertTo-Json |
    Set-Content -LiteralPath $secretsPath -Encoding UTF8
$secure.Dispose()

$config = [ordered]@{
    repoPath = $repoRoot
    nodePath = $nodePath
    supabaseUrl = 'https://dcvadrtvyzwwvlwejach.supabase.co'
    intervalSeconds = 120
    secretsPath = $secretsPath
    logDir = $logs
}
$configPath = Join-Path $appData 'reserve-config.json'
$config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$aclArgs = @($secretsPath, '/inheritance:r', '/grant:r', ('{0}:(R,W)' -f $currentUser), 'SYSTEM:(R)')
& icacls.exe @aclArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel proteger o ficheiro das credenciais.' }

$taskName = 'Ficha Kamba - Reservas'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq 'Running') { Stop-ScheduledTask -TaskName $taskName; Start-Sleep -Seconds 2 }

$supervisor = Join-Path $PSScriptRoot 'reserve-supervisor.ps1'
$taskArgs = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $supervisor, $configPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ''
Write-Host 'Instalado.' -ForegroundColor Green
Write-Host ('A tarefa arranca ao iniciar sessao e verifica boletins sem codigo a cada {0} segundos.' -f $config.intervalSeconds)
Write-Host ('Registo: {0}\reservas-AAAA-MM-DD.log' -f $logs)
