# Read-only: watch System (PID 4) handle bursts and what started just before each burst.
param([int]$Seconds = 600, [int]$Threshold = 5000, [string]$Out = '')
$known = @{}; Get-Process | ForEach-Object { $known[$_.Id] = $_.Name }
$recent = New-Object System.Collections.Generic.List[string]
$log = @(); $prevH = (Get-Process -Id 4).HandleCount; $prevNP = (Get-Counter '\Memory\Pool Nonpaged Bytes').CounterSamples[0].CookedValue
$start = Get-Date; $baseH = $prevH; $baseNP = $prevNP
while (((Get-Date) - $start).TotalSeconds -lt $Seconds) {
  Start-Sleep 3
  $now = Get-Process
  foreach ($p in ($now | Where-Object { -not $known.ContainsKey($_.Id) })) { $known[$p.Id] = $p.Name; $recent.Add((Get-Date).ToString('HH:mm:ss') + ' ' + $p.Name) }
  while ($recent.Count -gt 40) { $recent.RemoveAt(0) }
  $h = (Get-Process -Id 4).HandleCount; $np = (Get-Counter '\Memory\Pool Nonpaged Bytes').CounterSamples[0].CookedValue
  if (($h - $prevH) -ge $Threshold) {
    $vm = ($now | Where-Object { $_.Name -match '^(vmmem|vmwp|vmcompute|wsl|docker|com.docker)' } | ForEach-Object { $_.Name }) -join ','
    $log += "{0} BURST handles +{1:N0}, nonpaged +{2:N0} MB; vm-related: {3}" -f (Get-Date).ToString('HH:mm:ss'), ($h - $prevH), (($np - $prevNP) / 1MB), $vm
    $log += '   started in the last ~2 min: ' + (($recent | Select-Object -Last 25) -join ' | ')
  }
  $prevH = $h; $prevNP = $np
}
$log += "TOTAL over {0}s: System handles {1:+#;-#;0}, nonpaged {2:+#;-#;0} MB" -f $Seconds, ($prevH - $baseH), [int](($prevNP - $baseNP) / 1MB)
if ($Out) { $log | Out-File -Encoding utf8 $Out }
$log
