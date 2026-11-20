# Recolhe AGORA os jogos de hoje que ainda faltam (sem esperar pela tarefa diária e sem repetir os já gravados).
#   Ver o que seria recolhido, sem gravar:  powershell -ExecutionPolicy Bypass -File tools\windows\collect-now.ps1 -After "2026-11-21T13:30:00Z" -DryRun
#   Recolher de verdade:                    powershell -ExecutionPolicy Bypass -File tools\windows\collect-now.ps1 -After "2026-11-21T13:30:00Z"
param(
  [string]$After = "",
  [int]$MaxGames = 1000,
  [switch]$DryRun,
  [string]$ConfigPath = ""
)
$ErrorActionPreference = "Stop"
if (-not $ConfigPath) { $ConfigPath = Join-Path $env:LOCALAPPDATA "FichaKamba\daily-collector-config.json" }
if (-not (Test-Path -LiteralPath $ConfigPath)) { Write-Host "Configuração não encontrada: $ConfigPath (corre primeiro install-daily-collector.ps1)."; exit 2 }
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
function Convert-SecureStringToPlainText([string]$Encrypted) {
  $secure = ConvertTo-SecureString $Encrypted
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
$secrets = Get-Content -LiteralPath ([string]$config.secretsPath) -Raw | ConvertFrom-Json
$env:CRON_SECRET = Convert-SecureStringToPlainText ([string]$secrets.cronSecret)
$env:VERCEL_AUTOMATION_BYPASS_SECRET = Convert-SecureStringToPlainText ([string]$secrets.vercelBypass)
$env:FK_API_URL = [string]$config.apiBaseUrl
$collectorArgs = @((Join-Path ([string]$config.repoPath) "tools/collect-swarm-upload.js"), "--max-games=$MaxGames")
if ($After) { $collectorArgs += "--after=$After" }
if ($DryRun) { $collectorArgs += "--dry-run" }
try {
  Set-Location -LiteralPath ([string]$config.repoPath)
  $ErrorActionPreference = "Continue"
  & ([string]$config.nodePath) @collectorArgs 2>&1 | ForEach-Object { Write-Host ([string]$_) }
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:CRON_SECRET -ErrorAction SilentlyContinue
  Remove-Item Env:VERCEL_AUTOMATION_BYPASS_SECRET -ErrorAction SilentlyContinue
}
