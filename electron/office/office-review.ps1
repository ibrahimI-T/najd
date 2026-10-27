# NAJD Office review worker (docs/AGENT-PLATFORM-M3-PLAN.md, M3-8). Fixed NAJD code, run through the desktop host with
# one argument: the path of a request JSON written by NAJD. It never opens the user's file (only NAJD's private copy, which
# already passed the external-content scan), never uses an Office instance the user runs, never kills Office, and quits
# only an instance it started once that instance has no documents and no window. Result: <outDir>\result.json.
param([Parameter(Mandatory = $true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$out = $request.outDir
$result = @{ ok = $false; app = $request.app; mode = $request.mode }

# The current step, so NAJD can tell a stalled step (for example an unactivated Office that will not export) from slow work.
# Cancellation is cooperative: NAJD writes <outDir>cancel and the worker stops at its next step, closing its copy and
# quitting its instance itself; NAJD ends the worker only if it does not stop within a grace period.
function Check-Cancel { if (Test-Path -LiteralPath (Join-Path $out 'cancel')) { throw 'NAJD_CANCELLED' } }
function Step([string]$name) { Check-Cancel; try { @{ step = $name; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $out 'step.json') -Encoding UTF8 } catch {} }
# Tests only: NAJD passes testPause when created with testHooks, to make user activity happen at a known step.
function Step-Pause([string]$name) {
  if ($null -ne $request.testPause -and $request.testPause.step -eq $name) {
    $until = (Get-Date).AddMilliseconds([int]$request.testPause.ms)
    while ((Get-Date) -lt $until) { Check-Cancel; Start-Sleep -Milliseconds 200 }
  }
}
function Save-Result { $result | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath (Join-Path $out 'result.json') -Encoding UTF8 }
function Release($object) { if ($null -ne $object) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($object) } catch {} } }
$processName = @{ powerpoint = 'POWERPNT'; word = 'WINWORD'; excel = 'EXCEL' }[$request.app]
$progId = @{ powerpoint = 'PowerPoint.Application'; word = 'Word.Application'; excel = 'Excel.Application' }[$request.app]

Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class NajdRot {
  [DllImport("ole32.dll")] static extern int GetRunningObjectTable(int reserved, out IRunningObjectTable rot);
  [DllImport("ole32.dll")] static extern int CreateBindCtx(int reserved, out IBindCtx ctx);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  public static uint ProcessOf(IntPtr window) { uint id; GetWindowThreadProcessId(window, out id); return id; }
  // Returns the running object registered under exactly this display name, or null. Enumeration and
  // IRunningObjectTable.GetObject never start or load anything (M3-015).
  public static object Find(string displayName) {
    IRunningObjectTable rot; if (GetRunningObjectTable(0, out rot) != 0) return null;
    IEnumMoniker monikers; rot.EnumRunning(out monikers); IBindCtx ctx; CreateBindCtx(0, out ctx);
    IMoniker[] one = new IMoniker[1];
    while (monikers.Next(1, one, IntPtr.Zero) == 0) {
      string name = null; try { one[0].GetDisplayName(ctx, null, out name); } catch { continue; }
      if (string.Equals(name, displayName, StringComparison.OrdinalIgnoreCase)) { object found; rot.GetObject(one[0], out found); return found; }
    }
    return null;
  }
}
'@

function Process-Ids { @(Get-Process -Name $processName -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }) }
function Start-Stamp($id) { try { (Get-Process -Id $id -ErrorAction Stop).StartTime.ToFileTimeUtc().ToString() } catch { $null } }
function Document-Count($app) {
  switch ($request.app) { 'powerpoint' { $app.Presentations.Count } 'word' { $app.Documents.Count } 'excel' { $app.Workbooks.Count } }
}
function Has-Window($app) {
  switch ($request.app) { 'powerpoint' { $app.Windows.Count -gt 0 } 'word' { [bool]$app.Visible } 'excel' { [bool]$app.Visible } }
}
# Quits an application this review started, only when nothing else is open in it and it shows no window (M3-013).
function Quit-IfEmpty($app) {
  if ($null -eq $app) { return 'none' }
  try { if ((Document-Count $app) -eq 0 -and -not (Has-Window $app)) { $app.Quit(); return 'quit' } else { return 'left-running-in-use' } } catch { return 'not-responding' }
}
function Close-Copy($document) {
  switch ($request.app) { 'powerpoint' { $document.Close() } 'word' { $document.Close(0) } 'excel' { $document.Close($false) } }
}

# Pages first..first+count-1 of a PDF as PNG with Windows' built-in PDF renderer (Windows.Data.Pdf); no Office involved.
# Returns the first page rendered, the page count and the pictures with their page numbers (M3-I014).
function Render-Pdf([string]$pdf, [int]$from, [int]$count, [int]$width, [string]$target) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $asTaskAction = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  function Await($operation, [Type]$type) { $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($operation)); [void]$task.Wait(60000); $task.Result }
  function AwaitAction($action) { $task = $asTaskAction.Invoke($null, @($action)); [void]$task.Wait(60000) }
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  [void][Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($pdf)) ([Windows.Storage.StorageFile])
  $document = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $folder = Await ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($target)) ([Windows.Storage.StorageFolder])
  $images = @()
  $total = [int]$document.PageCount
  $first = [Math]::Max(1, [Math]::Min($from, $total))
  for ($number = $first; $number -le [Math]::Min($total, $first + $count - 1); $number++) {
    $page = $document.GetPage([uint32]($number - 1))
    $name = 'page-{0:D3}.png' -f $number
    $image = Await ($folder.CreateFileAsync($name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
    $stream = Await ($image.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth = [uint32]$width
    AwaitAction ($page.RenderToStreamAsync($stream, $options))
    $stream.Dispose(); $page.Dispose()
    $images += @{ index = $number; image = $image.Path }
  }
  return @{ first = $first; total = $total; images = $images }
}
if ($request.mode -eq 'pdf') {
  try { $rendered = Render-Pdf $request.copy ([int]$request.imageFrom) ([int]$request.imageCount) ([int]$request.slideWidth) $out; $result.pageImages = @($rendered.images); $result.pageCount = $rendered.total; $result.ok = $true } catch { $result.error = [string]$_.Exception.Message }
  Save-Result
  exit 0
}

# ---------------- cleanup: finish what an ended review left (never activates, never kills) ----------------
if ($request.mode -eq 'cleanup') {
  $records = @()
  foreach ($record in $request.records) {
    $state = 'resolved'
    $alive = (Start-Stamp $record.pid) -eq $record.started
    if ($alive) {
      $document = [NajdRot]::Find($record.copy)
      if ($null -ne $document) {
        try {
          $app = $document.Application
          Close-Copy $document
          Release $document
          $state = Quit-IfEmpty $app
          Release $app
        } catch { $state = 'not-responding' }
      } else {
        # The copy is not in the running object table (PowerPoint does not register presentations there; or the review
        # ended before opening it). The application's own registration is looked up without starting anything; it is used
        # only when its window handle proves it is the recorded process. Then only the document whose path is exactly the
        # copy is closed, and the instance is quit only when empty and invisible; otherwise it is left running.
        $app = $null; $state = 'left-running'
        try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject($progId) } catch {}
        if ($null -ne $app) {
          try {
            $handle = if ($request.app -eq 'powerpoint') { [IntPtr][long]$app.HWND } elseif ($request.app -eq 'excel') { [IntPtr][long]$app.Hwnd } else { [IntPtr]::Zero }
            if ($handle -ne [IntPtr]::Zero -and [NajdRot]::ProcessOf($handle) -eq [uint32]$record.pid) {
              $documents = switch ($request.app) { 'powerpoint' { $app.Presentations } 'excel' { $app.Workbooks } default { $null } }
              $open = 0
              if ($null -ne $documents) {
                for ($i = $documents.Count; $i -ge 1; $i--) {
                  $item = $documents.Item($i)
                  if ([string]::Equals([string]$item.FullName, [string]$record.copy, [StringComparison]::OrdinalIgnoreCase)) { Close-Copy $item }
                  Release $item
                }
                # A copy that is still listed after closing is waiting for released references; report it to retry later.
                for ($i = 1; $i -le $documents.Count; $i++) { $item = $documents.Item($i); if ([string]::Equals([string]$item.FullName, [string]$record.copy, [StringComparison]::OrdinalIgnoreCase)) { $open++ }; Release $item }
                Release $documents
              }
              $state = if ($open -gt 0) { 'copy-still-open' } else { Quit-IfEmpty $app }
            }
          } catch { $state = 'not-responding' }
          Release $app
        }
      }
    }
    $records += @{ id = $record.id; state = $state }
  }
  $result.ok = $true; $result.records = $records
  Save-Result
  exit 0
}

# ---------------- review ----------------
$before = Process-Ids
if ($request.app -eq 'powerpoint' -and $before.Count -gt 0) {
  $result.unavailable = 'powerpoint-running'
  Save-Result; exit 0
}
$app = $null; $document = $null
try {
  Step 'starting'
  $app = New-Object -ComObject $progId
  $new = @(Process-Ids | Where-Object { $before -notcontains $_ })
  if ($new.Count -ne 1 -or (Document-Count $app) -ne 0) {
    # Not a separate, empty instance of our own: do not use it (M3-011).
    $result.unavailable = 'no-isolated-instance'
    Release $app; $app = $null
    Save-Result; exit 0
  }
  $officePid = $new[0]
  @{ id = $request.recordId; app = $request.app; pid = $officePid; started = (Start-Stamp $officePid); copy = $request.copy } | ConvertTo-Json -Compress |
    Set-Content -LiteralPath $request.recordPath -Encoding UTF8
  $result.officePid = $officePid
  try { $app.AutomationSecurity = 3 } catch {}
  switch ($request.app) {
    'powerpoint' {
      $app.DisplayAlerts = 1
      # ReadOnly, Untitled false, WithWindow false.
      Step 'opening'
      $document = $app.Presentations.Open($request.copy, -1, 0, 0)
      Step 'exporting'
      Step-Pause 'exporting'
      $width = [double]$document.PageSetup.SlideWidth; $height = [double]$document.PageSetup.SlideHeight
      $result.slideSize = @($width, $height)
      $exportWidth = [int]$request.slideWidth; $exportHeight = [int][Math]::Round($exportWidth * $height / $width)
      $slides = @()
      $index = 0
      # Pictures only for the requested previews and, with playback, for the slides playback checks (M3-I014).
      $first = [Math]::Max(1, [Math]::Min([int]$request.imageFrom, [int]$document.Slides.Count)); $last = $first + [int]$request.imageCount - 1
      foreach ($slide in $document.Slides) {
        $index++
        if ($index -gt [int]$request.maxSlides) { Release $slide; break }
        $preview = $index -ge $first -and $index -le $last
        $image = $null
        if ($preview -or ($request.playback -and $index -le [int]$request.playbackSlides)) {
          $image = Join-Path $out ('slide-{0:D3}.png' -f $index)
          $slide.Export($image, 'PNG', $exportWidth, $exportHeight)
        }
        $effects = @()
        $sequence = $slide.TimeLine.MainSequence
        for ($i = 1; $i -le $sequence.Count; $i++) {
          $effect = $sequence.Item($i); $shape = $effect.Shape
          $box = @([double]$shape.Left, [double]$shape.Top, [double]$shape.Width, [double]$shape.Height)
          # A text-only shape (no fill, no outline) is seen where its text is, not across its whole box.
          try {
            if ([int]$shape.HasTextFrame -ne 0 -and [int]$shape.TextFrame.HasText -ne 0 -and [int]$shape.Fill.Visible -eq 0 -and [int]$shape.Line.Visible -eq 0) {
              $range = $shape.TextFrame.TextRange
              if ([double]$range.BoundWidth -gt 0 -and [double]$range.BoundHeight -gt 0) { $box = @([double]$range.BoundLeft, [double]$range.BoundTop, [double]$range.BoundWidth, [double]$range.BoundHeight) }
              Release $range
            }
          } catch {}
          $effects += @{ shape = $shape.Name; id = $shape.Id; type = [int]$effect.EffectType; trigger = [int]$effect.Timing.TriggerType;
            delay = [double]$effect.Timing.TriggerDelayTime; duration = [double]$effect.Timing.Duration; exit = ([int]$effect.Exit -ne 0); box = $box }
          Release $shape; Release $effect
        }
        $transition = $slide.SlideShowTransition
        # A slide without a transition (EntryEffect 0) still reports a default duration; it takes no time.
        $slides += @{ index = $index; image = $image; preview = $preview; effects = $effects; transition = [int]$transition.EntryEffect; transitionDuration = $(if ([int]$transition.EntryEffect -eq 0) { 0.0 } else { [double]$transition.Duration }) }
        Release $transition; Release $sequence; Release $slide
      }
      $result.slides = $slides
      $result.slideCount = $document.Slides.Count
      # A PDF only when asked (najd_office_review pdf: true), from this scanned private copy; SaveCopyAs leaves the open copy as it is (32 = ppSaveAsPDF).
      if ($request.exportPdf) { Step 'pdf'; $pdf = Join-Path $out 'document.pdf'; $document.SaveCopyAs($pdf, 32); $result.pdf = $pdf }
      if ($request.playback) {
        # Deterministic schedule on the copy (M3-012): clicks become after-previous with a fixed gap and each slide
        # advances on time once its last effect ended; the expected timeline is computed from the same numbers.
        $gap = [double]$request.gapMs / 1000; $hold = [double]$request.holdMs / 1000
        $timeline = @(); $index = 0
        foreach ($slide in $document.Slides) {
          $index++
          if ($index -gt [int]$request.playbackSlides) { Release $slide; break }
          $sequence = $slide.TimeLine.MainSequence
          $end = 0.0; $stepStart = 0.0; $times = @()
          for ($i = 1; $i -le $sequence.Count; $i++) {
            $effect = $sequence.Item($i); $timing = $effect.Timing
            if ([int]$timing.TriggerType -eq 1) { $timing.TriggerType = 3; $timing.TriggerDelayTime = [double]$timing.TriggerDelayTime + $gap }
            if ([int]$timing.TriggerType -eq 3 -or $i -eq 1) { $stepStart = $end }
            $start = $stepStart + [double]$timing.TriggerDelayTime
            $finish = $start + [double]$timing.Duration
            $times += @{ shape = $effect.Shape.Name; start = $start; end = $finish }
            if ($finish -gt $end) { $end = $finish }
            Release $timing; Release $effect
          }
          $transition = $slide.SlideShowTransition
          $transition.AdvanceOnTime = -1; $transition.AdvanceTime = $end + $hold
          $timeline += @{ index = $index; transitionDuration = $(if ([int]$transition.EntryEffect -eq 0) { 0.0 } else { [double]$transition.Duration }); advance = $end + $hold; effects = $times }
          Release $transition; Release $sequence; Release $slide
        }
        Step 'video'
        $video = Join-Path $out 'playback.mp4'
        $document.CreateVideo($video, $true, 1, [int]$request.videoHeight, [int]$request.fps, 85)
        $deadline = (Get-Date).AddSeconds([int]$request.videoSeconds)
        while ($true) {
          $status = [int]$document.CreateVideoStatus
          if ($status -eq 3) { break }
          if ($status -eq 4) { throw 'VIDEO_FAILED' }
          if ((Get-Date) -gt $deadline) { throw 'VIDEO_TIMEOUT' }
          Start-Sleep -Milliseconds 500
        }
        $result.video = $video; $result.timeline = $timeline
      }
    }
    'word' {
      $app.DisplayAlerts = 0
      # FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, PasswordDocument, PasswordTemplate, Revert,
      # WritePasswordDocument, WritePasswordTemplate, Format, Encoding, Visible. Encrypted files never get here: they are
      # not Office Open XML packages, so the scan refuses them before Office starts.
      Step 'opening'
      $missing = [Type]::Missing
      $document = $app.Documents.Open($request.copy, $false, $true, $false, $missing, $missing, $false, $missing, $missing, $missing, $missing, $false)
      Step 'exporting'
      Step-Pause 'exporting'
      $pdf = Join-Path $out 'document.pdf'
      $document.ExportAsFixedFormat($pdf, 17)
      $result.pdf = $pdf
      $result.pages = $document.ComputeStatistics(2)
      Step 'rendering'
      $rendered = Render-Pdf $pdf ([int]$request.imageFrom) ([int]$request.imageCount) ([int]$request.slideWidth) $out
      $result.pageImages = @($rendered.images); $result.pageCount = $rendered.total
    }
    'excel' {
      $app.DisplayAlerts = $false; $app.AskToUpdateLinks = $false; $app.EnableEvents = $false; $app.ScreenUpdating = $false
      # FileName, UpdateLinks 0, ReadOnly, Format, Password, WriteResPassword, IgnoreReadOnlyRecommended, Origin, Delimiter,
      # Editable, Notify false, Converter, AddToMru false. (A password argument fails on unprotected workbooks; encrypted
      # files never get here.)
      Step 'opening'
      $missing = [Type]::Missing
      $document = $app.Workbooks.Open($request.copy, 0, $true, $missing, $missing, $missing, $true, $missing, $missing, $false, $false, $missing, $false)
      Step 'calculating'
      Step-Pause 'calculating'
      # Calculation is scoped to the copy and only when it is the only workbook in this instance (M3-016).
      if ($app.Workbooks.Count -ne 1) { $result.calculation = 'unavailable-other-workbook' }
      else {
        $passes = 0; $previous = $null
        do {
          $passes++
          foreach ($sheet in $document.Worksheets) { $sheet.Calculate(); Release $sheet }
          $signature = (@(foreach ($sheet in $document.Worksheets) { try { $cells = $sheet.UsedRange.SpecialCells(-4123); $cells.Count; foreach ($cell in $cells) { [string]$cell.Value2 } } catch {}; Release $sheet }) -join '|')
          $stable = $signature -eq $previous; $previous = $signature
        } while (-not $stable -and $passes -lt 5)
        $result.calculation = 'done'; $result.passes = $passes
        $sheets = @()
        foreach ($sheet in $document.Worksheets) {
          $formulas = @(); $errors = @()
          try {
            foreach ($cell in $sheet.UsedRange.SpecialCells(-4123)) {
              $text = [string]$cell.Text
              if ($formulas.Count -lt 20) { $formulas += @{ cell = $cell.Address($false, $false); formula = [string]$cell.Formula; value = [string]$cell.Value2; text = $text } }
              if ($text.StartsWith('#') -and $errors.Count -lt 20) { $errors += @{ cell = $cell.Address($false, $false); error = $text } }
              Release $cell
            }
          } catch {}
          $sheets += @{ name = $sheet.Name; formulas = $formulas; errors = $errors }
          Release $sheet
        }
        $result.sheets = $sheets
      }
      # A PDF only when asked, after the copy was recalculated; 0 = xlTypePDF.
      if ($request.exportPdf) { Step 'pdf'; $pdf = Join-Path $out 'document.pdf'; $document.ExportAsFixedFormat(0, $pdf); $result.pdf = $pdf }
    }
  }
  $result.ok = $true
} catch {
  $result.error = [string]$_.Exception.Message
} finally {
  if ($null -ne $document) { try { Close-Copy $document } catch {}; Release $document }
  $result.instance = Quit-IfEmpty $app
  Release $app
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  Save-Result
}
