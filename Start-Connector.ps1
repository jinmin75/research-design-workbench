param([switch]$NoBrowser, [switch]$CoreOnly, [switch]$Offline, [string]$ToolsRoot)
$ErrorActionPreference = 'Stop'
$connectorRoot = $PSScriptRoot
$connectorPort = 4319
$connectorUrl = "http://127.0.0.1:$connectorPort"
try {
    $setupArguments = @{ CoreOnly = $CoreOnly; Offline = $Offline }
    if ($ToolsRoot) { $setupArguments.ToolsRoot = $ToolsRoot }
    $dependencies = & (Join-Path $PSScriptRoot 'Setup.ps1') -PassThru @setupArguments
    $nodePath = $dependencies.NodePath
    if (-not $nodePath -or -not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw '필수 실행 도구를 준비하지 못했습니다. Setup.cmd를 다시 실행해 주세요.' }
    $env:PATH = (Split-Path $nodePath) + [IO.Path]::PathSeparator + $env:PATH
    if ($dependencies.CodexPath -and -not $env:RESEARCH_CODEX_PATH) { $env:RESEARCH_CODEX_PATH = $dependencies.CodexPath }
    if ($dependencies.ClaudePath -and -not $env:RESEARCH_CLAUDE_PATH) { $env:RESEARCH_CLAUDE_PATH = $dependencies.ClaudePath }
    $healthy = $false
    try {
        $connectorHealth = Invoke-RestMethod "$connectorUrl/api/connector/health" -TimeoutSec 2
        $healthy = $connectorHealth.kind -eq 'student-local-connector' -and $connectorHealth.version -eq '1.2.0'
    } catch { }
    if (-not $healthy) {
        $portUsed = Get-NetTCPConnection -State Listen -LocalPort $connectorPort -ErrorAction SilentlyContinue
        if ($portUsed) { throw "4319 포트를 다른 프로그램이 사용하고 있습니다. 해당 프로그램을 확인해 주세요." }
        $logRoot = Join-Path $connectorRoot 'logs'
        New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
        $nodeArgs = @('"' + (Join-Path $connectorRoot 'connector-server.mjs') + '"')
        $env:RESEARCH_CONNECTOR_PORT = "$connectorPort"
        $connectorProcess = Start-Process -FilePath $nodePath -ArgumentList $nodeArgs -WorkingDirectory $connectorRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logRoot 'connector.out.log') -RedirectStandardError (Join-Path $logRoot 'connector.err.log') -PassThru
        for ($attempt = 0; $attempt -lt 24; $attempt++) {
            Start-Sleep -Milliseconds 250
            try {
                $connectorHealth = Invoke-RestMethod "$connectorUrl/api/connector/health" -TimeoutSec 1
                if ($connectorHealth.kind -eq 'student-local-connector' -and $connectorHealth.version -eq '1.2.0') { $healthy = $true; break }
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
