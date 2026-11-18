param([string]$ConfigPath = "")
$ErrorActionPreference = "Stop"
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot "daily-collector-config.json" }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$secretsPath = [string]$config.secretsPath
$statePath = [string]$config.statePath
$logDir = [string]$config.logDir
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Write-Log([string]$Message) {
  Add-Content -LiteralPath (Join-Path $logDir ("collector-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")) -Value ("$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message")
}
function Test-Internet {
  try {
    $client = [System.Net.Sockets.TcpClient]::new()
    $task = $client.BeginConnect("1.1.1.1", 443, $null, $null)
    $connected = $task.AsyncWaitHandle.WaitOne(4000, $false)
    if ($connected -and $client.Connected) { $client.EndConnect($task); $client.Close(); return $true }
    $client.Close()
  } catch {}
  return $false
}
function Convert-SecureStringToPlainText([string]$Encrypted) {
  $secure = ConvertTo-SecureString $Encrypted
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not (Test-Path -LiteralPath $secretsPath)) { Write-Log "ERRO: credenciais não encontradas."; exit 2 }
$secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
$env:CRON_SECRET = Convert-SecureStringToPlainText ([string]$secrets.cronSecret)
$env:VERCEL_AUTOMATION_BYPASS_SECRET = Convert-SecureStringToPlainText ([string]$secrets.vercelBypass)
$env:FK_API_URL = [string]$config.apiBaseUrl
$env:FK_MAX_GAMES = [string]$config.maxGames
$lastAttemptDate = ""
$lastAttemptAt = [datetime]::MinValue
Write-Log "Supervisor iniciado. A aguardar Internet; limite diário: uma recolha confirmada."
try {
  while ($true) {
    $today = (Get-Date).ToString("yyyy-MM-dd")
    $state = $null
    if (Test-Path -LiteralPath $statePath) { try { $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch {} }
    if ($state -and $state.lastSuccessDate -eq $today) { Start-Sleep -Seconds ([int]$config.pollSeconds); continue }
    if (-not (Test-Internet)) { Start-Sleep -Seconds ([int]$config.pollSeconds); continue }
    if ($lastAttemptDate -eq $today -and ((Get-Date) - $lastAttemptAt).TotalMinutes -lt [int]$config.retryMinutes) {
      Start-Sleep -Seconds ([int]$config.pollSeconds); continue
    }
    $lastAttemptDate = $today
    $lastAttemptAt = Get-Date
    Write-Log "Internet detectada. A iniciar recolha de até $($config.maxGames) jogos."
    $oldLocation = Get-Location
    try {
      Set-Location -LiteralPath ([string]$config.repoPath)
      & ([string]$config.nodePath) (Join-Path ([string]$config.repoPath) "tools/collect-swarm-upload.js") "--max-games=$($config.maxGames)" 2>&1 | ForEach-Object { Write-Log ([string]$_) }
      $exitCode = $LASTEXITCODE
    } catch { Write-Log "ERRO ao executar Node: $($_.Exception.Message)"; $exitCode = 1 }
    finally { Set-Location $oldLocation }
    if ($exitCode -eq 0) {
      ([ordered]@{ lastSuccessDate=$today; completedAt=(Get-Date).ToString("o"); maxGames=[int]$config.maxGames; apiBaseUrl=[string]$config.apiBaseUrl } | ConvertTo-Json) |
        Set-Content -LiteralPath $statePath -Encoding UTF8
      Write-Log "RECOLHA CONFIRMADA. Não haverá nova recolha hoje."
    } else { Write-Log "A recolha terminou com código $exitCode. Não foi marcada como concluída; nova tentativa após $($config.retryMinutes) minutos." }
    Start-Sleep -Seconds ([int]$config.pollSeconds)
  }
} finally {
  Remove-Item Env:CRON_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:VERCEL_AUTOMATION_BYPASS_SECRET -ErrorAction SilentlyContinue
}