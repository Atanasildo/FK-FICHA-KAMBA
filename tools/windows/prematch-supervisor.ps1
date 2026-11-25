param([string]$ConfigPath = "")
# Recolhe marcador, minuto e estatisticas dos jogos ao vivo (SofaScore) e grava em match_statistics.
# Corre ao iniciar sessao no Windows. Usa a mesma configuracao e a mesma chave cifrada das reservas.
# Se o SofaScore responder 403/429, o recolhedor pausa sozinho; este supervisor so o reinicia se terminar.
$ErrorActionPreference = "Stop"
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:LOCALAPPDATA "FichaKamba\reserve-config.json" }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$secretsPath = [string]$config.secretsPath
$logDir = [string]$config.logDir
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
function Write-Log([string]$Message) {
  Add-Content -LiteralPath (Join-Path $logDir ("pre-jogo-" + (Get-Date -Format 'yyyy-MM-dd') + ".log")) -Value ("$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message")
}
function Convert-SecureStringToPlainText([string]$Encrypted) {
  $secure = ConvertTo-SecureString $Encrypted
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
if (-not (Test-Path -LiteralPath $secretsPath)) { Write-Log "ERRO: credenciais nao encontradas. Corre install-reserve-task.ps1 primeiro."; exit 2 }
$secrets = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
$env:SUPABASE_URL = [string]$config.supabaseUrl
$env:SUPABASE_SERVICE_ROLE_KEY = Convert-SecureStringToPlainText ([string]$secrets.supabaseServiceRoleKey)
Write-Log "Recolha pre-jogo iniciada (SofaScore, de 3 em 3 horas)."
try {
  while ($true) {
    $oldLocation = Get-Location
    try {
      Set-Location -LiteralPath ([string]$config.repoPath)
      # stderr do Node nao pode terminar o supervisor.
      $ErrorActionPreference = "Continue"
      & ([string]$config.nodePath) "tools/collect-prematch-sofascore.js" "--watch" 2>&1 | ForEach-Object { Write-Log ([string]$_) }
      $ErrorActionPreference = "Stop"
      Write-Log "Recolhedor terminou. A reiniciar em 30 s."
    } catch { Write-Log "ERRO ao executar Node: $($_.Exception.Message)" }
    finally { $ErrorActionPreference = "Stop"; Set-Location $oldLocation }
    Start-Sleep -Seconds 30
  }
} finally {
  Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue
}
