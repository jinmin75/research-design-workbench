param(
  [Parameter(Mandatory = $true)] [ValidateSet('codex', 'claude', 'gemini')] [string] $Provider,
  [Parameter(Mandatory = $true)] [string] $Executable,
  [Parameter(Mandatory = $true)] [string] $NodeExecutable,
  [switch] $InLoginWindow
)

$ErrorActionPreference = 'Stop'
try {
  if (-not [System.IO.Path]::IsPathRooted($Executable) -or -not (Test-Path -LiteralPath $Executable -PathType Leaf)) { throw 'Missing executable' }
  if ($Executable -match '[\x00-\x1f\x7f"]' -or $NodeExecutable -match '[\x00-\x1f\x7f"]') { throw 'Invalid executable' }
  $extension = [System.IO.Path]::GetExtension($Executable).ToLowerInvariant()
  if ($extension -notin @('.exe', '.js', '.mjs', '.cjs')) { throw 'Unsupported executable' }
  $nodeScript = $extension -in @('.js', '.mjs', '.cjs')
  if ($nodeScript -and (-not [System.IO.Path]::IsPathRooted($NodeExecutable) -or [System.IO.Path]::GetExtension($NodeExecutable) -ne '.exe' -or -not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf))) { throw 'Missing Node' }

  if (-not $InLoginWindow) {
    # Initialize a real console before PowerShell and the official CLI initialize
    # stdin. No -Command, output redirection, credential reading or shell expression.
    # Every variable argument is a validated path or the fixed provider enum.
    $window = New-Object System.Diagnostics.ProcessStartInfo
    $window.FileName = Join-Path $PSHOME 'powershell.exe'
    $window.UseShellExecute = $true
    $window.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
    $window.WorkingDirectory = (Get-Location).Path
    $quotedScript = '"' + $PSCommandPath + '"'
    $quotedExecutable = '"' + $Executable + '"'
    $quotedNode = '"' + $NodeExecutable + '"'
    $window.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ' + $quotedScript + ' -InLoginWindow -Provider ' + $Provider + ' -Executable ' + $quotedExecutable + ' -NodeExecutable ' + $quotedNode
    $loginWindow = [System.Diagnostics.Process]::Start($window)
    $loginWindow.WaitForExit()
    exit $loginWindow.ExitCode
  }

  $Host.UI.RawUI.WindowTitle = 'Research Workbench - Official Account Login'
  Write-Host '공식 도구에서 본인의 계정으로 로그인하세요. 이 창의 인증 정보는 연구 앱으로 전달되지 않습니다.'
  $loginArguments = switch ($Provider) {
    'codex' { @('login') }
    'claude' { @('auth', 'login', '--claudeai') }
    'gemini' { @() }
  }
  if ($Provider -eq 'gemini') { Write-Host 'Google 로그인 후 Gemini에서 /quit를 입력해 종료하고, 연구 앱의 연결 상태를 갱신하세요.' }
  if ($nodeScript) { & $NodeExecutable $Executable @loginArguments }
  else { & $Executable @loginArguments }
  Write-Host '연구 앱에서 연결 상태를 갱신하세요. 창을 열었다는 사실만으로 연결 완료가 확인되지는 않습니다.'
  Read-Host '창을 닫으려면 Enter를 누르세요' | Out-Null
}
catch {
  Write-Host '공식 로그인 창을 실행하지 못했습니다. 도구 설치와 PC 실행 권한을 확인해 주세요.'
  exit 1
}
