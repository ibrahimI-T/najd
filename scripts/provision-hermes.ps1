$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repo 'third_party/hermes-agent'
$revision = (& git -C $source rev-parse HEAD).Trim()
if ($revision -ne 'c70332f88886932337619a1e57029bd885c28b9d') { throw 'Unexpected Hermes source revision' }
$root = Join-Path $repo '.runtimes/hermes'
$store = Join-Path $root 'tools'
$privateHome = Join-Path $root 'setup-home'
New-Item -ItemType Directory -Force -Path $store, $privateHome | Out-Null
$lock = Get-Content -Raw (Join-Path $source 'pm/lock.json') | ConvertFrom-Json
foreach ($name in @('uv', 'python')) {
    $pin = $lock.packages.$name
    $artifact = $pin.artifacts.'win32-x64'
    $entry = Join-Path $store "$name-$($pin.version)-win32-x64"
    $marker = Join-Path $entry 'najd-artifact.sha256'
    if (Test-Path -LiteralPath $entry) {
        $factsPath = Join-Path $store 'facts.json'
        $managed = $false
        if (Test-Path -LiteralPath $factsPath) {
            $fact = (Get-Content -Raw $factsPath | ConvertFrom-Json).packages.$name
            $managed = $fact.version -eq $pin.version -and $fact.artifacts -contains $artifact.sha256
        }
        if (!$managed -and (!(Test-Path -LiteralPath $marker) -or (Get-Content -Raw $marker).Trim() -ne $artifact.sha256)) {
            throw "Unverified existing tool directory preserved: $entry"
        }
        continue
    }
    $archive = Join-Path $root ([uri]$artifact.url).Segments[-1]
    if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $artifact.url -OutFile $archive }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $artifact.sha256) {
        throw "Archive checksum mismatch: $name"
    }
    # Extract to a fresh owned directory. Failed/partial outputs are preserved for inspection.
    New-Item -ItemType Directory -Path $entry | Out-Null
    if ($name -eq 'uv') { Expand-Archive -LiteralPath $archive -DestinationPath $entry }
    else {
        # Windows' own tar: a GNU tar earlier on PATH (Git Bash) reads "C:" as a remote host.
        & (Join-Path $env:SystemRoot 'System32\tar.exe') -xf $archive -C $entry --strip-components=1
        if ($LASTEXITCODE -ne 0) { throw 'Python extraction failed' }
    }
    Set-Content -LiteralPath $marker -Value $artifact.sha256 -NoNewline
}
# This script runs in its own pwsh child. Do not forward shell credentials or another install's routing.
$gitDirectory = Split-Path -Parent (Get-Command git -CommandType Application).Source
$safeNames = @('SystemRoot', 'WINDIR', 'SystemDrive', 'ComSpec', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS')
foreach ($item in @(Get-ChildItem Env:)) {
    if ($item.Name -notin $safeNames) { Remove-Item -LiteralPath ('Env:' + $item.Name) }
}
$env:PATH = $gitDirectory + ';' + (Join-Path $env:SystemRoot 'System32')
$privateTemp = Join-Path $privateHome 'temp'
New-Item -ItemType Directory -Force -Path $privateTemp | Out-Null
$env:TEMP = $privateTemp
$env:TMP = $privateTemp
$env:HOME = $privateHome
$env:USERPROFILE = $privateHome
$env:LOCALAPPDATA = Join-Path $privateHome 'AppData/Local'
$env:APPDATA = Join-Path $privateHome 'AppData/Roaming'
$env:HERMES_HOME = Join-Path $root 'setup-profile'
$env:HERMES_RUNTIME_DIR = $store
$env:UV_CACHE_DIR = Join-Path $root 'uv-cache'
$env:PYTHONUTF8 = '1'
$env:PYTHONDONTWRITEBYTECODE = '1'
foreach ($key in @('PYTHONHOME', 'PYTHONPATH', 'VIRTUAL_ENV', 'HERMES_PROFILE', 'HERMES_INSTALL_ROOT')) {
    Remove-Item "env:$key" -ErrorAction SilentlyContinue
}
$python = Join-Path $store "python-$($lock.packages.python.version)-win32-x64/python.exe"
& $python -I -B (Join-Path $PSScriptRoot 'provision-hermes.py')
if ($LASTEXITCODE -ne 0) { throw 'Hermes PM environment preparation failed' }
