Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function ConvertTo-ProcessArgument {
    param([AllowEmptyString()][string]$Value)
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    return '"' + ([regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1')) + '"'
}

function Invoke-SetupProcess {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory, [string]$NodeDirectory, [int]$TimeoutSeconds = 180)
    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $FilePath
    $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ')
    if ([IO.Path]::GetExtension($FilePath) -ne '.exe') { throw 'DIRECT_EXECUTABLE_REQUIRED' }
    $info.WorkingDirectory = $WorkingDirectory
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    # npm receives no account tokens, custom config, Node preload hooks or shell hooks.
    $info.EnvironmentVariables.Clear()
    foreach ($name in @('SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC','PATHEXT','PROCESSOR_ARCHITECTURE','PROCESSOR_ARCHITEW6432')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value) { $info.EnvironmentVariables[$name] = $value }
    }
    $systemRoot = [Environment]::GetEnvironmentVariable('SYSTEMROOT')
    $info.EnvironmentVariables['PATH'] = "$NodeDirectory;$systemRoot\System32;$systemRoot"
    $info.EnvironmentVariables['NO_COLOR'] = '1'
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $info
    try {
        if (-not $process.Start()) { throw 'PROCESS_START_FAILED' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill() } catch { }
            throw 'PROCESS_TIMEOUT'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output; ErrorOutput = $errors }
    } finally { $process.Dispose() }
}

function Get-SetupArchitecture {
    $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($architecture.ToUpperInvariant()) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { throw 'UNSUPPORTED_ARCHITECTURE: Windows x64 또는 ARM64가 필요합니다.' }
    }
}

function Invoke-SetupDownload {
    param([string]$Url, [string]$Destination)
    $oldProtocol = [Net.ServicePointManager]::SecurityProtocol
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -TimeoutSec 120 -MaximumRedirection 0 | Out-Null
    } finally { [Net.ServicePointManager]::SecurityProtocol = $oldProtocol }
}

function Expand-SetupArchive {
    param([string]$Archive, [string]$Destination)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $root = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    [IO.Directory]::CreateDirectory($root) | Out-Null
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($zip.Entries.Count -gt 20000) { throw 'ARCHIVE_TOO_LARGE' }
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $total += $entry.Length
            if ($total -gt 700MB) { throw 'ARCHIVE_TOO_LARGE' }
            if ($entry.FullName -match '(^[/\\]|:|(^|[/\\])\.\.([/\\]|$))') { throw 'UNSAFE_ARCHIVE_PATH' }
            if (($entry.ExternalAttributes -band 0xA0000000) -eq 0xA0000000) { throw 'ARCHIVE_LINK_NOT_ALLOWED' }
            $target = [IO.Path]::GetFullPath((Join-Path $root $entry.FullName.Replace('/', '\')))
            if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'UNSAFE_ARCHIVE_PATH' }
            if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    } finally { $zip.Dispose() }
}

function Remove-SetupStage {
    param([string]$Root, [string]$Stage)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($Stage)
    if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($target) -notmatch '^\.setup-stage-[a-f0-9]{32}$') { throw 'UNSAFE_CLEANUP_PATH' }
    if (Test-Path -LiteralPath $target) {
        $item = Get-Item -LiteralPath $target -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'CLEANUP_LINK_NOT_ALLOWED' }
        foreach ($child in Get-ChildItem -LiteralPath $target -Recurse -Force) {
            if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'CLEANUP_LINK_NOT_ALLOWED' }
        }
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

function Assert-SetupOwnedPath {
    param([string]$Root, [string]$Path)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $target = [IO.Path]::GetFullPath($Path)
    if (-not $target.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { throw 'INSTALL_PATH_OUTSIDE_TOOLS_ROOT' }
    $cursor = $target
    while ($cursor -and $cursor.Length -ge $base.TrimEnd('\').Length) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALL_PATH_LINK_NOT_ALLOWED' }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}

function Get-SetupNpmFailure {
    param([string]$ErrorOutput)
    if ($ErrorOutput -match 'double-loading config') { return 'NPM_CONFIG_COLLISION: npm 설정 경로가 충돌했습니다.' }
    if ($ErrorOutput -match '(?im)(?:npm\s+(?:ERR!|error)\s+code\s+)([A-Z][A-Z0-9_]{1,40})') {
        $code = $Matches[1]
        $detail = switch -Regex ($code) {
            '^(EAI_AGAIN|ENETUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND)$' { '다운로드 연결을 확인해 주세요.'; break }
            '^(EACCES|EPERM)$' { '보안 프로그램 또는 폴더 사용 권한 때문에 쓰기가 차단됐습니다.'; break }
            '^ENOSPC$' { '저장 공간이 부족합니다.'; break }
            '^EINTEGRITY$' { '패키지 무결성 검사가 실패했습니다. 검증되지 않은 파일은 실행하지 않았습니다.'; break }
            'CERT|SSL|VERIFY' { '인증서를 확인하지 못했습니다. 인증서 검증을 끄지 말고 네트워크 관리자에게 확인해 주세요.'; break }
            default { '공식 패키지 설치가 완료되지 않았습니다.' }
        }
        return ('NPM_' + $code + ': ' + $detail)
    }
    return 'NPM_INSTALL_FAILED: 공식 패키지 설치가 완료되지 않았습니다. 네트워크 또는 보안 프로그램의 차단을 확인해 주세요.'
}

function Move-SetupDirectory {
    param([string]$Root, [string]$Stage, [string]$Source, [string]$Destination)
    Assert-SetupOwnedPath $Root $Source
    Assert-SetupOwnedPath $Root $Destination
    $stageRoot = [IO.Path]::GetFullPath($Stage).TrimEnd('\') + '\'
    if (-not ([IO.Path]::GetFullPath($Source)).StartsWith($stageRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $Destination)) { throw 'INSTALL_MOVE_NOT_OWNED' }
    foreach ($item in Get-ChildItem -LiteralPath $Source -Recurse -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'INSTALL_CONTENT_LINK_NOT_ALLOWED' }
    }
    Move-Item -LiteralPath ([IO.Path]::GetFullPath($Source)) -Destination ([IO.Path]::GetFullPath($Destination))
}

function Assert-DependencyLock {
    param($Lock)
    if ($Lock.schemaVersion -ne 1 -or $Lock.node.minimumMajor -ne 22 -or $Lock.node.version -notmatch '^24\.\d+\.\d+$') { throw 'INVALID_DEPENDENCY_LOCK' }
    foreach ($arch in @('x64','arm64')) {
        $archive = $Lock.node.archives.$arch
        $expectedUrl = 'https://nodejs.org/dist/v' + $Lock.node.version + '/node-v' + $Lock.node.version + '-win-' + $arch + '.zip'
        if ($archive.url -cne $expectedUrl -or $archive.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'INVALID_NODE_LOCK' }
    }
    foreach ($provider in @('codex','claude')) {
        $package = $Lock.providers.$provider
        $expectedName = if ($provider -eq 'codex') { '@openai/codex' } else { '@anthropic-ai/claude-code' }
        if ($package.name -cne $expectedName -or $package.version -notmatch '^\d+\.\d+\.\d+$' -or $package.integrity -notmatch '^sha512-[A-Za-z0-9+/]+={0,2}$') { throw 'INVALID_PROVIDER_LOCK' }
    }
}

function Test-SetupTool {
    param([string]$Path, [string]$Kind, [hashtable]$Services, [string]$NodePath)
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $extension = [IO.Path]::GetExtension($Path)
        if ($extension -eq '.js' -and $Kind -ne 'node' -and $NodePath) {
            $result = & $Services.Run $NodePath @($Path,'--version') ([IO.Path]::GetDirectoryName($Path)) ([IO.Path]::GetDirectoryName($NodePath)) 20
        } elseif ($extension -eq '.exe') {
            $result = & $Services.Run $Path @('--version') ([IO.Path]::GetDirectoryName($Path)) ([IO.Path]::GetDirectoryName($Path)) 20
        } else { return $false }
        if ($result.ExitCode -ne 0) { return $false }
        if ($Kind -eq 'node') { return ($result.Output.Trim() -match '^v(\d+)\.\d+\.\d+$' -and [int]$Matches[1] -ge 22) }
        return ($result.Output -match '\d+\.\d+\.\d+')
    } catch { return $false }
}

function Assert-NpmInstallation {
    param([string]$Prefix, $Package, $Lock, [string]$Architecture)
    $file = Join-Path $Prefix 'package-lock.json'
    if (-not (Test-Path -LiteralPath $file)) { throw 'NPM_LOCK_MISSING' }
    # npm's packages[""] is legal JSON; Windows PowerShell 5.1 ConvertFrom-Json rejects empty keys.
    Add-Type -AssemblyName System.Web.Extensions
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = 16MB
    $serializer.RecursionLimit = 64
    $installedLock = $serializer.DeserializeObject([IO.File]::ReadAllText($file))
    if ($installedLock['lockfileVersion'] -lt 2) { throw 'NPM_LOCK_INVALID' }
    $packages = $installedLock['packages']
    $rootEntryName = 'node_modules/' + $Package.name
    $rootEntry = $packages[$rootEntryName]
    if (-not $rootEntry -or $rootEntry['version'] -cne $Package.version -or $rootEntry['integrity'] -cne $Package.integrity) { throw 'NPM_PACKAGE_INTEGRITY_MISMATCH' }
    foreach ($name in $packages.Keys) {
        if ($name -eq '') { continue }
        if ($name -match '(^[/\\]|:|(^|[/\\])\.\.([/\\]|$))') { throw 'NPM_UNSAFE_LOCK_PATH' }
        # npm records other OS packages in the lock; only installed packages can execute.
        if (-not (Test-Path -LiteralPath (Join-Path $Prefix $name))) { continue }
        $value = $packages[$name]
        if (-not $value['resolved'] -or $value['resolved'] -notmatch '^https://registry\.npmjs\.org/' -or $value['integrity'] -notmatch '^sha512-[A-Za-z0-9+/]+={0,2}$') { throw 'NPM_DEPENDENCY_UNVERIFIED' }
        $approved = $Lock.npmArtifacts.PSObject.Properties[$value['resolved']]
        if (-not $approved -or $approved.Value -cne $value['integrity']) { throw 'NPM_DEPENDENCY_NOT_PINNED' }
    }
    $metadataFile = Join-Path (Join-Path $Prefix 'node_modules') ($Package.name.Replace('/', '\') + '\package.json')
    $metadata = Get-Content -LiteralPath $metadataFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($metadata.name -cne $Package.name -or $metadata.version -cne $Package.version) { throw 'NPM_INSTALLED_VERSION_MISMATCH' }
    $nativeName = if ($Package.name -eq '@openai/codex') { '@openai/codex-win32-' + $Architecture } else { '@anthropic-ai/claude-code-win32-' + $Architecture }
    $native = $packages[('node_modules/' + $nativeName)]
    $nativeDirectory = Join-Path (Join-Path $Prefix 'node_modules') $nativeName.Replace('/', '\')
    if (-not $native -or -not (Test-Path -LiteralPath $nativeDirectory -PathType Container)) { throw 'NATIVE_PACKAGE_REQUIRED_NO_FALLBACK' }
    if ($Package.name -eq '@anthropic-ai/claude-code' -and -not (Test-Path -LiteralPath (Join-Path $nativeDirectory 'claude.exe') -PathType Leaf)) { throw 'CLAUDE_NATIVE_REQUIRED_NO_FALLBACK' }
}

function Invoke-ResearchDependencySetup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$LockPath,
        [string]$ToolsRoot = (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ResearchWorkbench\tools'),
        [switch]$CoreOnly, [switch]$Offline, [switch]$ForceRepair,
        # Explicit scriptblock injection is for local unit tests; Setup.ps1 never accepts these hooks.
        [hashtable]$Services = @{}
    )
    $defaults = @{
        Architecture = { Get-SetupArchitecture }
        FindCommand = { param($name) $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue; if ($command) { $command.Source } }
        Download = { param($url,$destination) Invoke-SetupDownload $url $destination }
        Hash = { param($file) (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }
        Expand = { param($archive,$destination) Expand-SetupArchive $archive $destination }
        Run = { param($file,$arguments,$cwd,$nodeDirectory,$timeout) Invoke-SetupProcess $file $arguments $cwd $nodeDirectory $timeout }
    }
    foreach ($name in $defaults.Keys) { if (-not $Services.ContainsKey($name)) { $Services[$name] = $defaults[$name] } }
    $messages = New-Object 'System.Collections.Generic.List[string]'
    $result = [ordered]@{ Status = 'failed'; NodePath = $null; CodexPath = $null; ClaudePath = $null; Messages = @(); Installed = @(); ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot) }
    $installed = New-Object 'System.Collections.Generic.List[string]'
    $stages = New-Object 'System.Collections.Generic.List[string]'
    $setupLock = $null
    try {
        $lock = Get-Content -LiteralPath $LockPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Assert-DependencyLock $lock
        $arch = & $Services.Architecture
        if ($arch -notin @('x64','arm64')) { throw 'UNSUPPORTED_ARCHITECTURE' }
        [IO.Directory]::CreateDirectory($result.ToolsRoot) | Out-Null
        if (((Get-Item -LiteralPath $result.ToolsRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'TOOLS_ROOT_LINK_NOT_ALLOWED' }
        $lockFile = Join-Path $result.ToolsRoot '.setup.lock'
        Assert-SetupOwnedPath $result.ToolsRoot $lockFile
        try { $setupLock = [IO.File]::Open($lockFile,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
        catch { throw 'SETUP_ALREADY_RUNNING: 같은 도구 폴더에서 설치가 진행 중입니다. 완료 후 다시 시작해 주세요.' }
        $stateFile = Join-Path $result.ToolsRoot 'setup-state.json'
        $state = $null
        if (Test-Path -LiteralPath $stateFile) { try { $state = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } }
        $node = $null
        if (-not $ForceRepair) {
            $candidates = @()
            if ($state -and $state.PSObject.Properties['NodePath']) { $candidates += $state.NodePath }
            $candidates += (& $Services.FindCommand 'node.exe')
            foreach ($candidate in $candidates) {
                if (Test-SetupTool $candidate 'node' $Services) {
                    # A standalone Node binary cannot bootstrap missing provider packages.
                    $npmAvailable = Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($candidate)) 'node_modules\npm\bin\npm-cli.js')
                    if ($CoreOnly -or $Offline -or $npmAvailable) { $node = $candidate; break }
                }
            }
        }
        if (-not $node) {
            if ($Offline) { throw 'NODE_REQUIRED_OFFLINE: 오프라인 상태에서 사용할 Node.js 22 이상을 찾지 못했습니다.' }
            $stage = Join-Path $result.ToolsRoot ('.setup-stage-' + [guid]::NewGuid().ToString('N')); $stages.Add($stage)
            [IO.Directory]::CreateDirectory($stage) | Out-Null
            $archive = Join-Path $stage 'node.zip'
            & $Services.Download $lock.node.archives.$arch.url $archive
            if ((& $Services.Hash $archive) -cne $lock.node.archives.$arch.sha256) { throw 'NODE_CHECKSUM_MISMATCH: 다운로드한 Node.js의 SHA-256이 다릅니다.' }
            $expanded = Join-Path $stage 'expanded'
            & $Services.Expand $archive $expanded
            $nodeFolder = Join-Path $expanded ('node-v' + $lock.node.version + '-win-' + $arch)
            $nodeCandidate = Join-Path $nodeFolder 'node.exe'
            if (-not (Test-SetupTool $nodeCandidate 'node' $Services) -or -not (Test-Path -LiteralPath (Join-Path $nodeFolder 'node_modules\npm\bin\npm-cli.js'))) { throw 'NODE_ARCHIVE_INVALID' }
            $final = Join-Path $result.ToolsRoot ('node-' + $lock.node.version + '-' + $arch + '-' + [guid]::NewGuid().ToString('N'))
            Move-SetupDirectory $result.ToolsRoot $stage $nodeFolder $final
            $node = Join-Path $final 'node.exe'
            $installed.Add('node')
            $messages.Add('Node.js를 이 사용자 전용 폴더에 설치했습니다.')
        } else { $messages.Add('사용 가능한 기존 Node.js를 재사용합니다.') }
        $result.NodePath = $node
        $nodeDirectory = [IO.Path]::GetDirectoryName($node)
        if ($CoreOnly -and $state) {
            foreach ($provider in @('codex','claude')) {
                $property = if ($provider -eq 'codex') { 'CodexPath' } else { 'ClaudePath' }
                if ($state.PSObject.Properties[$property] -and (Test-SetupTool $state.$property $provider $Services $node)) { $result[$property] = $state.$property }
            }
        }
        if (-not $CoreOnly) {
            foreach ($provider in @('codex','claude')) {
                $property = if ($provider -eq 'codex') { 'CodexPath' } else { 'ClaudePath' }
                $tool = $null
                if (-not $ForceRepair) {
                    $candidates = @()
                    if ($state -and $state.PSObject.Properties[$property]) { $candidates += $state.$property }
                    $candidates += (& $Services.FindCommand ($provider + '.exe'))
                    # Resolve known npm package entries without executing .cmd/.ps1 shell shims.
                    $shim = & $Services.FindCommand ($provider + '.cmd')
                    if ($shim) {
                        $moduleBase = Join-Path ([IO.Path]::GetDirectoryName($shim)) 'node_modules'
                        if ($provider -eq 'codex') { $candidates += (Join-Path $moduleBase '@openai\codex\bin\codex.js') }
                        else { $candidates += (Join-Path $moduleBase '@anthropic-ai\claude-code\bin\claude.exe'); $candidates += (Join-Path $moduleBase '@anthropic-ai\claude-code\cli.js') }
                    }
                    foreach ($candidate in $candidates) { if (Test-SetupTool $candidate $provider $Services $node) { $tool = $candidate; break } }
                }
                if ($tool) { $result[$property] = $tool; $messages.Add("기존 $provider 연결 도구를 재사용합니다."); continue }
                if ($Offline) { $messages.Add("$provider 도구가 없어 구독 연결은 보류했습니다. 인터넷 연결 뒤 Setup.cmd를 다시 실행하면 됩니다."); continue }
                try {
                    $npmCli = Join-Path $nodeDirectory 'node_modules\npm\bin\npm-cli.js'
                    if (-not (Test-Path -LiteralPath $npmCli)) { throw 'BUNDLED_NPM_MISSING' }
                    $package = $lock.providers.$provider
                    $stage = Join-Path $result.ToolsRoot ('.setup-stage-' + [guid]::NewGuid().ToString('N')); $stages.Add($stage)
                    [IO.Directory]::CreateDirectory($stage) | Out-Null
                    $prefix = Join-Path $stage 'package'
                    [IO.Directory]::CreateDirectory($prefix) | Out-Null
                    $userConfig = Join-Path $stage 'user-empty.npmrc'
                    $globalConfig = Join-Path $stage 'global-empty.npmrc'
                    [IO.File]::WriteAllText($userConfig, '', (New-Object Text.UTF8Encoding($false)))
                    [IO.File]::WriteAllText($globalConfig, '', (New-Object Text.UTF8Encoding($false)))
                    $arguments = @($npmCli,'install','--prefix',$prefix,'--registry','https://registry.npmjs.org/','--userconfig',$userConfig,'--globalconfig',$globalConfig,'--cache',(Join-Path $stage 'cache'),'--ignore-scripts','--include=optional','--no-audit','--no-fund','--package-lock=true','--save-exact',($package.name + '@' + $package.version))
                    $execution = & $Services.Run $node $arguments $stage $nodeDirectory 240
                    if ($execution.ExitCode -ne 0) { throw (Get-SetupNpmFailure $execution.ErrorOutput) }
                    Assert-NpmInstallation $prefix $package $lock $arch
                    if ($provider -eq 'claude') {
                        $installer = Join-Path $prefix 'node_modules\@anthropic-ai\claude-code\install.cjs'
                        if (-not (Test-Path -LiteralPath $installer)) { throw 'CLAUDE_INSTALLER_MISSING' }
                        $execution = & $Services.Run $node @($installer) $prefix $nodeDirectory 60
                        if ($execution.ExitCode -ne 0) { throw 'CLAUDE_NATIVE_SETUP_FAILED' }
                    }
                    $relativeExecutable = if ($provider -eq 'codex') { 'node_modules\@openai\codex\bin\codex.js' } else { 'node_modules\@anthropic-ai\claude-code\bin\claude.exe' }
                    $executable = Join-Path $prefix $relativeExecutable
                    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw 'PROVIDER_EXECUTABLE_MISSING' }
                    if ($provider -eq 'codex') {
                        $native = @(Get-ChildItem -LiteralPath (Join-Path $prefix 'node_modules\@openai') -Filter codex.exe -Recurse -File)
                        if ($native.Count -ne 1) { throw 'CODEX_NATIVE_EXECUTABLE_MISSING' }
                        $executable = $native[0].FullName
                        $relativeExecutable = $executable.Substring($prefix.Length + 1)
                    }
                    if (-not (Test-SetupTool $executable $provider $Services $node)) { throw 'PROVIDER_VERSION_CHECK_FAILED' }
                    $final = Join-Path $result.ToolsRoot ($provider + '-' + $package.version + '-' + $arch + '-' + [guid]::NewGuid().ToString('N'))
                    Move-SetupDirectory $result.ToolsRoot $stage $prefix $final
                    $result[$property] = Join-Path $final $relativeExecutable
                    $installed.Add($provider)
                    $messages.Add("$provider 구독 연결 도구를 사용자 전용 폴더에 설치했습니다. 계정 로그인은 앱에서 진행하세요.")
                } catch { $messages.Add("$provider 설치를 보류했습니다 ($($_.Exception.Message.Split([char]10)[0])). 로컬 연구 기능은 계속 사용할 수 있습니다. Setup.cmd를 다시 실행하면 재시도합니다.") }
            }
        }
        $result.Status = if (-not $CoreOnly -and (-not $result.CodexPath -or -not $result.ClaudePath)) { 'partial' } else { 'ready' }
        $stateOutput = @{ schemaVersion = 1; NodePath = $result.NodePath; CodexPath = $result.CodexPath; ClaudePath = $result.ClaudePath; UpdatedAt = [DateTime]::UtcNow.ToString('o') }
        $temporaryState = Join-Path $result.ToolsRoot ('setup-state-' + [guid]::NewGuid().ToString('N') + '.tmp')
        Assert-SetupOwnedPath $result.ToolsRoot $temporaryState
        Assert-SetupOwnedPath $result.ToolsRoot $stateFile
        [IO.File]::WriteAllText($temporaryState, ($stateOutput | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryState -Destination $stateFile -Force
    } catch { $messages.Add($_.Exception.Message.Split([char]10)[0]) }
    finally {
        foreach ($stage in $stages) { try { Remove-SetupStage $result.ToolsRoot $stage } catch { $messages.Add('임시 설치 폴더 정리를 보류했습니다. 기존 자료는 변경하지 않았습니다.') } }
        if ($setupLock) { $setupLock.Dispose() }
    }
    $result.Messages = $messages.ToArray()
    $result.Installed = $installed.ToArray()
    return [pscustomobject]$result
}

Export-ModuleMember -Function Invoke-ResearchDependencySetup
