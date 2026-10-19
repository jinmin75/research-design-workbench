$ErrorActionPreference = 'Stop'
$serverFile = Join-Path $PSScriptRoot 'server.mjs'
$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverFile) }
foreach ($processInfo in $processes) { Stop-Process -Id $processInfo.ProcessId }
Write-Host '이 폴더에서 실행한 연구설계 서버를 종료했습니다.'
