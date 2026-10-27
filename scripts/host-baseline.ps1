# Read-only host baseline for performance investigations (no changes to the system).
# Samples System (PID 4) handles, kernel pools, available memory and commit every -IntervalSeconds.
param([int]$Samples = 13, [int]$IntervalSeconds = 30, [string]$Out = '')
$rows = @()
for ($i = 0; $i -lt $Samples; $i++) {
  $c = (Get-Counter '\Memory\Pool Nonpaged Bytes', '\Memory\Pool Paged Bytes', '\Memory\Available MBytes', '\Memory\Committed Bytes', '\Memory\Commit Limit', '\Process(_Total)\Handle Count').CounterSamples
  $v = @{}; foreach ($s in $c) { $v[($s.Path -replace '.*\\', '')] = $s.CookedValue }
  $system = (Get-Process -Id 4).HandleCount
  $rows += [pscustomobject]@{
    Time = (Get-Date).ToString('HH:mm:ss'); SystemHandles = $system; TotalHandles = [int64]$v['handle count']
    NonpagedMB = [int]($v['pool nonpaged bytes'] / 1MB); PagedMB = [int]($v['pool paged bytes'] / 1MB)
    AvailableMB = [int]$v['available mbytes']; CommitGB = [math]::Round($v['committed bytes'] / 1GB, 2); CommitLimitGB = [math]::Round($v['commit limit'] / 1GB, 2)
  }
  if ($i -lt $Samples - 1) { Start-Sleep $IntervalSeconds }
}
$table = $rows | Format-Table -AutoSize | Out-String -Width 200
$first = $rows[0]; $last = $rows[-1]; $minutes = ($Samples - 1) * $IntervalSeconds / 60
$summary = "Over $minutes min: System handles {0:+#;-#;0} ({1:N0}/min), nonpaged {2:+#;-#;0} MB, paged {3:+#;-#;0} MB, available {4:+#;-#;0} MB, commit {5:+0.00;-0.00;0} GB" -f `
  ($last.SystemHandles - $first.SystemHandles), (($last.SystemHandles - $first.SystemHandles) / $minutes), ($last.NonpagedMB - $first.NonpagedMB), ($last.PagedMB - $first.PagedMB), ($last.AvailableMB - $first.AvailableMB), ($last.CommitGB - $first.CommitGB)
$result = $table + $summary
if ($Out) { $result | Out-File -Encoding utf8 $Out }
$result
