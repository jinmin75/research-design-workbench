param([switch]$NoBrowser, [switch]$CoreOnly, [switch]$Offline, [string]$ToolsRoot)
$ErrorActionPreference = 'Stop'
$setupArguments = @{ CoreOnly = $CoreOnly; Offline = $Offline }
if ($ToolsRoot) { $setupArguments.ToolsRoot = $ToolsRoot }
$dependencies = & (Join-Path $PSScriptRoot 'Setup.ps1') -PassThru @setupArguments
$nodePath = $dependencies.NodePath
if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw '필수 실행 도구를 준비하지 못했습니다. Setup.cmd를 다시 실행해 주세요.' }
# Process-local paths only; official account files stay with the official tools.
$env:PATH = (Split-Path $nodePath) + [IO.Path]::PathSeparator + $env:PATH
if ($dependencies.CodexPath -and -not $env:RESEARCH_CODEX_PATH) { $env:RESEARCH_CODEX_PATH = $dependencies.CodexPath }
if ($dependencies.ClaudePath -and -not $env:RESEARCH_CLAUDE_PATH) { $env:RESEARCH_CLAUDE_PATH = $dependencies.ClaudePath }
$portNumber = if ($env:PORT) { [int]$env:PORT } else { 4317 }
$localUrl = "http://127.0.0.1:$portNumber"
$ready = $false
try { $health = Invoke-RestMethod "$localUrl/api/health" -TimeoutSec 2; $ready = ($health.appVersion -eq '0.10.0' -and $health.specVersion -eq '4.0' -and $health.appRoot -eq $PSScriptRoot) } catch { }
if (-not $ready) {
    $logDirectory = Join-Path $PSScriptRoot 'logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $serverScript = Join-Path $PSScriptRoot 'server.mjs'
    $serverProcess = Start-Process -FilePath $nodePath -WorkingDirectory $PSScriptRoot -ArgumentList @('"' + $serverScript + '"') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($serverProcess.HasExited) { throw "서버 시작 실패. $logDirectory\server-error.log 파일을 확인해 주세요." }
        try { $health = Invoke-RestMethod "$localUrl/api/health" -TimeoutSec 1; $ready = ($health.appVersion -eq '0.10.0' -and $health.specVersion -eq '4.0' -and $health.appRoot -eq $PSScriptRoot) } catch { }
        if ($ready) { break }
    }
}
if (-not $ready) { throw '서버 준비를 확인하지 못했습니다. 로그를 확인해 주세요.' }
if (-not $NoBrowser) { Start-Process $localUrl }
Write-Host "연구설계 작업실: $localUrl"
Write-Host '로컬 서버는 창을 닫아도 실행됩니다. 종료하려면 Stop.ps1을 실행하세요.'
