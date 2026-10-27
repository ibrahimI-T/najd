# Runs INSIDE Windows Sandbox for interactive-installer checks.
#   ui.ps1 shot <name>            save a screenshot to C:\najd\out\<name>.png
#   ui.ps1 keys <window> <keys>   focus a window whose title contains <window> and send SendKeys text
#   ui.ps1 windows                list visible top-level window titles
param([string]$Action, [string]$A, [string]$B)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
# Folders shared at runtime with `wsb share` land on the Sandbox desktop.
$out = if (Test-Path 'C:\najd\out') { 'C:\najd\out' } else { "$env:USERPROFILE\Desktop\manual-out" }
switch ($Action) {
  'shot' {
    $bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object Drawing.Bitmap $bounds.Width, $bounds.Height
    [Drawing.Graphics]::FromImage($bmp).CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save("$out\$A.png", [Drawing.Imaging.ImageFormat]::Png)
  }
  'keys' {
    $shell = New-Object -ComObject WScript.Shell
    if ($shell.AppActivate($A)) { Start-Sleep -Milliseconds 400; [Windows.Forms.SendKeys]::SendWait($B) } else { "window not found: $A" | Out-File -Append "$out\ui-errors.txt" }
  }
  'click' {
    # Invoke a button by name inside a window whose title contains <window> (no focus needed).
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $rootElement = [Windows.Automation.AutomationElement]::RootElement
    $window = $rootElement.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition) |
      Where-Object { $_.Current.Name -like "*$A*" } | Select-Object -First 1
    $button = if ($window) { $window.FindAll([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::ControlTypeProperty), ([Windows.Automation.ControlType]::Button))) |
      Where-Object { $_.Current.Name -replace '&', '' -like "$B*" } | Select-Object -First 1 }
    if ($button) { $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() } else { "button not found: $A / $B" | Out-File -Append "$out\ui-errors.txt" }
  }
  'windows' {
    Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName): $($_.MainWindowTitle)" } | Out-File -Encoding utf8 "$out\windows.txt"
  }
}
