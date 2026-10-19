param([switch]$CoreOnly, [switch]$Offline, [switch]$ForceRepair, [string]$ToolsRoot, [switch]$PassThru)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'scripts\Dependency-Setup.psm1') -Force
$parameters = @{ LockPath = (Join-Path $PSScriptRoot 'dependency-lock.json'); CoreOnly = $CoreOnly; Offline = $Offline; ForceRepair = $ForceRepair }
if ($ToolsRoot) { $parameters.ToolsRoot = $ToolsRoot }
Write-Host '연구설계 작업실에 필요한 실행 도구를 확인합니다. 처음에는 인터넷 다운로드가 필요합니다.'
$setupResult = Invoke-ResearchDependencySetup @parameters
foreach ($message in $setupResult.Messages) { Write-Host $message }
if ($setupResult.Status -eq 'failed') { throw '실행 환경을 준비하지 못했습니다. 네트워크를 확인하고 Setup.cmd를 다시 실행해 주세요.' }
if ($PassThru) { Write-Output $setupResult }
