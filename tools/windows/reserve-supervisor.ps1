param([string]$ConfigPath = "")
# Pede os codigos de reserva dos boletins publicados sem codigo, de forma continua.
# Corre ao iniciar sessao no Windows (tarefa agendada) e repete a cada intervalSeconds.
# So cria codigos de reserva (Amount 0); nao coloca apostas nem movimenta dinheiro.
$ErrorActionPreference = "Stop"
if (-not $ConfigPath) { $ConfigPath = Join-Path $PSScriptRoot "reserve-config.json" }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$secretsPath = [string]$config.secretsPath
$logDir = [string]$config.logDir
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Write-Log([string]$Message) {
  Add-Content -LiteralPath (Join-Path $logDir ("reservas-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")) -Value ("$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message")
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
if (-not (Test-Path -LiteralPath $secretsPath)) { Write-Log "ERRO: credenciais nao encontradas. Corre install-reserve-task.ps1."; exit 2 }
$secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
$env:SUPABASE_URL = [string]$config.supabaseUrl
$env:SUPABASE_SERVICE_ROLE_KEY = Convert-SecureStringToPlainText ([string]$secrets.supabaseServiceRoleKey)
Write-Log "Supervisor de reservas iniciado. Intervalo: $($config.intervalSeconds) s."
try {
  while ($true) {
    if (Test-Internet) {
      $oldLocation = Get-Location
      try {
        Set-Location -LiteralPath ([string]$config.repoPath)
        $ErrorActionPreference = "Continue"
        $lines = & ([string]$config.nodePath) "tools/reserve-pending.js" 2>&1 | ForEach-Object { [string]$_ }
        $ErrorActionPreference = "Stop"
        foreach ($line in $lines) {
          # Evita encher o registo: os boletins antigos saltados repetem-se em cada ciclo.
          if ($line -match '^SALTA') { continue }
          if ($line -match 'reservados: 0 \|') { continue }
          Write-Log $line
        }
      } catch { Write-Log "ERRO ao executar Node: $($_.Exception.Message)" }
      finally { $ErrorActionPreference = "Stop"; Set-Location $oldLocation }
    }
    Start-Sleep -Seconds ([int]$config.intervalSeconds)
  }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
