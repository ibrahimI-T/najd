# Run in an ELEVATED PowerShell after handle-summary.ps1. Read-only: samples the names of the File handles
# held by the System process (PID 4) and groups them, without dumping all millions of entries.
$tool = 'C:\NAJD AGENT\.runtimes\sysinternals-handle\handle64.exe'
$out = 'C:\NAJD AGENT\.runtimes\sysinternals-handle\out'
New-Item -ItemType Directory -Force $out | Out-Null
Write-Host 'Sampling File handles of the System process (about a minute)...'
$lines = & $tool -accepteula -nobanner -p 4 -a | Where-Object { $_ -match ':\s+File\s' } | Select-Object -First 50000
$lines | Select-Object -Last 300 | Out-File -Encoding utf8 "$out\files-sample.txt"
# Group by the file name with digits/GUIDs collapsed, so repeated patterns stand out.
$lines | ForEach-Object { ($_ -replace '^.*?:\s+File\s+(\(\S+\)\s+)?', '') -replace '\{[0-9A-Fa-f-]{36}\}', '{GUID}' -replace '\d{3,}', '#' } |
  Group-Object | Sort-Object Count -Descending | Select-Object -First 40 Count, Name |
  Format-Table -AutoSize | Out-String -Width 300 | Out-File -Encoding utf8 "$out\files-grouped.txt"
'done ' + (Get-Date).ToString('HH:mm:ss') | Out-File -Encoding utf8 "$out\files-done.txt"
Write-Host "Done. Results are in $out"
