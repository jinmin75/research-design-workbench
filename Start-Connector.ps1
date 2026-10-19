param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$connectorRoot = $PSScriptRoot
$connectorPort = 4319
$connectorUrl = "http://127.0.0.1:$connectorPort"
try {
    $nodeCommand = Get-Command node -ErrorAction Stop
    $nodeVersion = & $nodeCommand.Source --version
    if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 이상이 필요합니다. https://nodejs.org 에서 LTS 버전을 설치해 주세요.' }
    $healthy = $false
    try {
        $connectorHealth = Invoke-RestMethod "$connectorUrl/api/connector/health" -TimeoutSec 2
        $healthy = $connectorHealth.kind -eq 'student-local-connector' -and $connectorHealth.version -eq '1.1.0'
    } catch { }
    if (-not $healthy) {
        $portUsed = Get-NetTCPConnection -State Listen -LocalPort $connectorPort -ErrorAction SilentlyContinue
        if ($portUsed) { throw "4319 포트를 다른 프로그램이 사용하고 있습니다. 해당 프로그램을 확인해 주세요." }
        $logRoot = Join-Path $connectorRoot 'logs'
        New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        $nodeArgs = @('"' + (Join-Path $connectorRoot 'connector-server.mjs') + '"')
        $env:RESEARCH_CONNECTOR_PORT = "$connectorPort"
        $connectorProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList $nodeArgs -WorkingDirectory $connectorRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'connector.out.log') -RedirectStandardError (Join-Path $logRoot 'connector.err.log') -PassThru
        for ($attempt = 0; $attempt -lt 24; $attempt++) {
            Start-Sleep -Milliseconds 250
            try {
                $connectorHealth = Invoke-RestMethod "$connectorUrl/api/connector/health" -TimeoutSec 1
                if ($connectorHealth.kind -eq 'student-local-connector' -and $connectorHealth.version -eq '1.1.0') { $healthy = $true; break }
            } catch { }
            if ($connectorProcess.HasExited) { break }
        }
        if (-not $healthy) { throw '연결기가 시작되지 않았습니다. logs/connector.err.log를 확인해 주세요.' }
    }
    Write-Host "학생 개인 AI 연결기 실행 중: $connectorUrl/connect"
    Write-Host 'GPT·Claude 공식 로그인과 Gemini API 키 입력은 CONNECTOR-README.md를 참고해 주세요.'
    if (-not $NoBrowser) { Start-Process "$connectorUrl/connect" }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
