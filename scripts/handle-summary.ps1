# Run in an ELEVATED PowerShell. Read-only: counts the System (PID 4) handles by object type twice,
# 6 minutes apart (covers one leak episode), and writes the comparison for analysis.
$tool = 'C:\NAJD AGENT\.runtimes\sysinternals-handle\handle64.exe'
$out = 'C:\NAJD AGENT\.runtimes\sysinternals-handle\out'
New-Item -ItemType Directory -Force $out | Out-Null
function Summary { & $tool -accepteula -nobanner -s -p 4 2>&1 | Out-String }
Write-Host 'First snapshot...'
$first = Summary; $first | Out-File -Encoding utf8 "$out\summary-1.txt"
Write-Host 'Waiting 6 minutes (one leak episode)...'
Start-Sleep 360
Write-Host 'Second snapshot...'
$second = Summary; $second | Out-File -Encoding utf8 "$out\summary-2.txt"
'done ' + (Get-Date).ToString('HH:mm:ss') | Out-File -Encoding utf8 "$out\done.txt"
Write-Host "Done. Results are in $out"
