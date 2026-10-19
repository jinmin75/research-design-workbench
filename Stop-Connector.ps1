$ErrorActionPreference = 'Stop'
$connectorFile = Join-Path $PSScriptRoot 'connector-server.mjs'
$escapedFile = [regex]::Escape($connectorFile)
$scriptArgument = if ($connectorFile -match '\s') { '"' + $escapedFile + '"(?=\s|$)' } else { '(?:"' + $escapedFile + '"|' + $escapedFile + ')(?=\s|$)' }
$launchPattern = '^\s*(?:"[^"]+"|\S+)\s+' + $scriptArgument
$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and [regex]::IsMatch($_.CommandLine,$launchPattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase) }
foreach ($processInfo in $processes) { Stop-Process -Id $processInfo.ProcessId }
Write-Host '이 폴더에서 실행한 개인 AI 연결기를 종료했습니다. 메모리에 보관한 Gemini 키도 지워집니다.'
