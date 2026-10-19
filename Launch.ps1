param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 22 이상을 설치한 뒤 다시 실행해 주세요.' }
$majorVersion = [int]((& $nodeCommand.Source --version) -replace '^v(\d+).*','$1')
if ($majorVersion -lt 22) { throw 'Node.js 22 이상이 필요합니다.' }
$portNumber = if ($env:PORT) { [int]$env:PORT } else { 4317 }
$localUrl = "http://127.0.0.1:$portNumber"
$ready = $false
try { $health = Invoke-RestMethod "$localUrl/api/health" -TimeoutSec 2; $ready = ($health.appVersion -eq '0.9.0' -and $health.specVersion -eq '4.0' -and $health.appRoot -eq $PSScriptRoot) } catch { }
if (-not $ready) {
    $logDirectory = Join-Path $PSScriptRoot 'logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $serverScript = Join-Path $PSScriptRoot 'server.mjs'
    $serverProcess = Start-Process -FilePath $nodeCommand.Source -WorkingDirectory $PSScriptRoot -ArgumentList @('"' + $serverScript + '"') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log') -PassThru
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        if ($serverProcess.HasExited) { throw "서버 시작 실패. $logDirectory\server-error.log 파일을 확인해 주세요." }
        try { $health = Invoke-RestMethod "$localUrl/api/health" -TimeoutSec 1; $ready = ($health.appVersion -eq '0.9.0' -and $health.specVersion -eq '4.0' -and $health.appRoot -eq $PSScriptRoot) } catch { }
        if ($ready) { break }
    }
}
if (-not $ready) { throw '서버 준비를 확인하지 못했습니다. 로그를 확인해 주세요.' }
if (-not $NoBrowser) { Start-Process $localUrl }
Write-Host "연구설계 작업실: $localUrl"
Write-Host '로컬 서버는 창을 닫아도 실행됩니다. 종료하려면 Stop.ps1을 실행하세요.'
