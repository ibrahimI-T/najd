# Test helper for tests/office-review-smoke.cjs: plays "the user" around a NAJD Office review. Never used by NAJD.
# Usage: powershell -File office-review-helper.ps1 <mode> <state folder> [file] [review copy]
#   pp-hold   start PowerPoint as the user would (no document), hold it until <state>\stop exists, then quit it
#   xl-user   open <file> in a user-started Excel instance, record A1 and the calculation mode, hold, record again, close
#   join-pp   open <file> inside the instance that holds the review copy, make an unsaved edit, hold, record
#   join-xl   open <file> inside the instance that holds the review copy, hold, record A1, close it
param([string]$Mode, [string]$State, [string]$File, [string]$Copy)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class HelperRot {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int r, out IRunningObjectTable rot);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int r, out IBindCtx ctx);
  public static object Find(string path) {
    IRunningObjectTable rot; GetRunningObjectTable(0, out rot); IEnumMoniker e; rot.EnumRunning(out e); IBindCtx ctx; CreateBindCtx(0, out ctx);
    IMoniker[] one = new IMoniker[1];
    while (e.Next(1, one, IntPtr.Zero) == 0) { string name = null; try { one[0].GetDisplayName(ctx, null, out name); } catch { continue; }
      if (string.Equals(name, path, StringComparison.OrdinalIgnoreCase)) { object o; rot.GetObject(one[0], out o); return o; } }
    return null; } }
'@
function Write-State($name, $value) { $value | ConvertTo-Json -Compress -Depth 5 | Set-Content -LiteralPath (Join-Path $State $name) -Encoding UTF8 }
function Wait-Stop { $limit = (Get-Date).AddMinutes(10); while (-not (Test-Path (Join-Path $State 'stop')) -and (Get-Date) -lt $limit) { Start-Sleep -Milliseconds 200 } }
function Wait-Copy { $limit = (Get-Date).AddSeconds(60); while ((Get-Date) -lt $limit) { $found = [HelperRot]::Find($Copy); if ($null -ne $found) { return $found }; Start-Sleep -Milliseconds 200 }; throw 'copy not running' }

switch ($Mode) {
  'pp-hold' {
    $app = New-Object -ComObject PowerPoint.Application
    $id = @(Get-Process POWERPNT | Sort-Object StartTime -Descending)[0].Id
    Write-State 'ready.json' @{ pid = $id }
    Wait-Stop
    Write-State 'after.json' @{ alive = $null -ne (Get-Process -Id $id -ErrorAction SilentlyContinue); documents = $app.Presentations.Count }
    $app.Quit()
  }
  'xl-user' {
    $app = New-Object -ComObject Excel.Application
    $book = $app.Workbooks.Open($File)
    $id = @(Get-Process EXCEL | Sort-Object StartTime -Descending)[0].Id
    Write-State 'ready.json' @{ pid = $id; a1 = [string]$book.Worksheets.Item(1).Range('A1').Value2; calculation = [int]$app.Calculation }
    Wait-Stop
    Write-State 'after.json' @{ a1 = [string]$book.Worksheets.Item(1).Range('A1').Value2; calculation = [int]$app.Calculation; open = $app.Workbooks.Count }
    $book.Close($false); $app.Quit()
  }
  'join-pp' {
    $copyDocument = Wait-Copy
    $app = $copyDocument.Application
    # A user holds no reference to NAJD's copy.
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($copyDocument); $copyDocument = $null; [GC]::Collect()
    # Without a window: a visible window would show Office first-run dialogs on a test machine.
    $mine = $app.Presentations.Open($File, 0, 0, 0)
    [void]$mine.Slides.Item(1).Shapes.AddTextbox(1, 10, 10, 200, 40)
    Write-State 'ready.json' @{ joined = $true }
    Wait-Stop
    $names = @(foreach ($p in $app.Presentations) { $p.FullName })
    Write-State 'after.json' @{ open = ($names -contains $File); copyOpen = ($names -contains $Copy); unsaved = ([int]$mine.Saved -eq 0); shapes = $mine.Slides.Item(1).Shapes.Count }
    $mine.Saved = -1; $mine.Close()
    if ($app.Presentations.Count -eq 0) { $app.Quit() }
  }
  'join-xl' {
    $copyBook = Wait-Copy
    $app = $copyBook.Application
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($copyBook); $copyBook = $null; [GC]::Collect()
    $mine = $app.Workbooks.Open($File)
    $before = [string]$mine.Worksheets.Item(1).Range('A1').Value2
    Write-State 'ready.json' @{ joined = $true; a1 = $before; calculation = [int]$app.Calculation }
    Wait-Stop
    $names = @(foreach ($b in $app.Workbooks) { $b.FullName })
    Write-State 'after.json' @{ open = ($names -contains $File); a1 = [string]$mine.Worksheets.Item(1).Range('A1').Value2; calculation = [int]$app.Calculation }
    $mine.Close($false)
    if ($app.Workbooks.Count -eq 0) { $app.Quit() }
  }
}
