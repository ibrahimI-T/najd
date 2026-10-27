# Read-only: samples System handle count and per-process I/O operation counters every 2 s for
# -Minutes. When the System handle count jumps, it records which processes did the most file
# operations in that interval. Output: .runtimes\episodes-<time>.txt
param([int]$Minutes = 12, [int]$JumpThreshold = 20000)
$out = Join-Path $PSScriptRoot "..\.runtimes\episodes-$(Get-Date -Format HHmmss).txt"
function Snap { $h = @{}; Get-CimInstance Win32_Process | ForEach-Object { $h["$($_.ProcessId)"] = @{ n = $_.Name; ops = [int64]$_.ReadOperationCount + [int64]$_.WriteOperationCount + [int64]$_.OtherOperationCount; cmd = [string]$_.CommandLine } }; $h }
$prev = Snap; $prevHandles = (Get-Process -Id 4).HandleCount
$end = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $end) {
  Start-Sleep -Seconds 2
  $cur = Snap; $handles = (Get-Process -Id 4).HandleCount
  $jump = $handles - $prevHandles
  $top = foreach ($k in $cur.Keys) { if ($prev.ContainsKey($k)) { [pscustomobject]@{ Pid = $k; Name = $cur[$k].n; Ops = $cur[$k].ops - $prev[$k].ops; Cmd = $cur[$k].cmd.Substring(0, [math]::Min(160, $cur[$k].cmd.Length)) } } }
  $top = $top | Sort-Object Ops -Descending | Select-Object -First 6
  $line = "{0:HH:mm:ss} systemHandles={1} delta={2}" -f (Get-Date), $handles, $jump
  if ([math]::Abs($jump) -ge $JumpThreshold) {
    Add-Content $out ("=== JUMP " + $line); $top | ForEach-Object { Add-Content $out ("  {0,8} ops  pid {1}  {2}  {3}" -f $_.Ops, $_.Pid, $_.Name, $_.Cmd) }
  } else { Add-Content $out $line }
  $prev = $cur; $prevHandles = $handles
}
Add-Content $out "done"
