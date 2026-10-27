# Read-only: lists the largest kernel pool tags (SystemPoolTagInformation), like poolmon.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\pool-tags.ps1 [-Top 25]
param([int]$Top = 25)
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NajdPool {
  [DllImport("ntdll.dll")] public static extern int NtQuerySystemInformation(int c, IntPtr b, int l, out int r);
}
'@
$size = 1MB
while ($true) {
  $buf = [Runtime.InteropServices.Marshal]::AllocHGlobal($size); $ret = 0
  $status = [NajdPool]::NtQuerySystemInformation(22, $buf, $size, [ref]$ret)
  if ($status -eq 0) { break }
  [Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
  if ($status -ne -1073741820) { throw ("NtQuerySystemInformation failed 0x{0:X8}" -f $status) }
  $size *= 2
}
# SYSTEM_POOLTAG on x64: Tag(4) PagedAllocs(4) PagedFrees(4) pad(4) PagedUsed(8) NonPagedAllocs(4) NonPagedFrees(4) NonPagedUsed(8) = 40 bytes
$count = [Runtime.InteropServices.Marshal]::ReadInt32($buf, 0)
$rows = for ($i = 0; $i -lt $count; $i++) {
  $o = 8 + $i * 40
  $tagBytes = [byte[]]::new(4); [Runtime.InteropServices.Marshal]::Copy([IntPtr]($buf.ToInt64() + $o), $tagBytes, 0, 4)
  $paged = [Runtime.InteropServices.Marshal]::ReadInt64($buf, $o + 16)
  $nonpaged = [Runtime.InteropServices.Marshal]::ReadInt64($buf, $o + 32)
  [pscustomobject]@{
    Tag = [Text.Encoding]::ASCII.GetString($tagBytes)
    PagedMB = [math]::Round($paged / 1MB, 1)
    NonPagedMB = [math]::Round($nonpaged / 1MB, 1)
    PagedLive = [Runtime.InteropServices.Marshal]::ReadInt32($buf, $o + 4) - [Runtime.InteropServices.Marshal]::ReadInt32($buf, $o + 8)
    NonPagedLive = [Runtime.InteropServices.Marshal]::ReadInt32($buf, $o + 24) - [Runtime.InteropServices.Marshal]::ReadInt32($buf, $o + 28)
  }
}
[Runtime.InteropServices.Marshal]::FreeHGlobal($buf)
$rows | Sort-Object { $_.PagedMB + $_.NonPagedMB } -Descending | Select-Object -First $Top | Format-Table -AutoSize | Out-String -Width 200
