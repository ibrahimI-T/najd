# Runs INSIDE Windows Sandbox (a disposable clean Windows). Mapped folders:
#   C:\najd\release (read-only installers), C:\najd\scripts (read-only), C:\najd\out (results).
param([ValidateSet('clean', 'upgrade')][string]$Mode = 'clean', [string]$From = '0.8.2', [string]$To = '0.9.0')
$ErrorActionPreference = 'Continue'
$out = 'C:\najd\out'
function Step([string]$text) { "$(Get-Date -Format o) $text" | Out-File -Append -Encoding utf8 "$out\steps.txt" }
function Install([string]$version) {
  $setup = "C:\najd\release\$version\NAJD-AGENT-Setup-$version.exe"
  Step "install $version start"
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $setup -ArgumentList '/S' -Wait -PassThru
  Step "install $version exit=$($p.ExitCode) seconds=$([int]$watch.Elapsed.TotalSeconds)"
  Start-Sleep 5
  Get-Process 'NAJD AGENT', 'najd-gateway', 'dotnet' -ErrorAction SilentlyContinue | Stop-Process -Force
}
function Components([string]$name) {
  Get-ChildItem "$env:LOCALAPPDATA\NAJD AGENT\runtime" -Directory -ErrorAction SilentlyContinue |
    Select-Object Name, @{n = 'Created'; e = { $_.CreationTimeUtc.ToString('o') } } |
    ConvertTo-Json | Out-File -Encoding utf8 "$out\components-$name.json"
}
function Node { (Get-ChildItem "$env:LOCALAPPDATA\NAJD AGENT\runtime\node-*\najd-gateway.exe" | Select-Object -First 1).FullName }

Step "mode=$Mode windows=$([Environment]::OSVersion.VersionString) python=$([bool](Get-Command python.exe -ErrorAction SilentlyContinue)) node=$([bool](Get-Command node.exe -ErrorAction SilentlyContinue)) dotnet=$([bool](Get-Command dotnet.exe -ErrorAction SilentlyContinue))"
$marker = "najd-upgrade-marker-$([guid]::NewGuid().ToString('N').Substring(0,8))"
if ($Mode -eq 'upgrade') {
  Install $From
  Components 'baseline-before-start'
  $node = Node
  if (-not $node) {
    # The older version prepares on first start; its own Node is not unpacked yet. Use the packaged archive's Node.
    Expand-Archive "$env:LOCALAPPDATA\Programs\NAJD AGENT\resources\najd-runtime\node.zip" "C:\najd-tmp-node" -Force
    $node = 'C:\najd-tmp-node\najd-gateway.exe'
  }
  & $node 'C:\najd\scripts\check-installed.cjs' $out 'baseline' $marker
  Step 'baseline check done'
  Components 'baseline'
}
Install $To
Copy-Item "$env:LOCALAPPDATA\NAJD AGENT\install.log" "$out\install.log" -ErrorAction SilentlyContinue
Components 'final'
& (Node) 'C:\najd\scripts\check-installed.cjs' $out 'final' $(if ($Mode -eq 'upgrade') { $marker } else { '' })
Step 'final check done'
# Gateway diagnostics (fixture data only: this is a disposable Sandbox profile).
$state = "$env:APPDATA\najd-agent\najd-data\engines\openclaw"
Get-ChildItem $state -Recurse -File -ErrorAction SilentlyContinue | Select-Object FullName, Length, LastWriteTimeUtc |
  ConvertTo-Json | Out-File -Encoding utf8 "$out\gateway-state-files.json"
Get-ChildItem $state -Recurse -Filter *.log -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName "$out\gateway-$($_.Name)" }
'done' | Out-File -Encoding utf8 "$out\done.txt"
