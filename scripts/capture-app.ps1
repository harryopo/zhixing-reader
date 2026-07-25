param(
  [string]$OutputPath = ""
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinAPI {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
  [DllImport("user32.dll")]
  public static extern IntPtr GetWindowDC(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
}
'@

$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Name -eq 'electron' -and $_.MainWindowTitle -ne '' }
Write-Host ("Found " + $procs.Count + " matching electron window(s)")
$procs | ForEach-Object { Write-Host ("  - '" + $_.MainWindowTitle + "' handle=" + $_.MainWindowHandle) }
$proc = $procs | Sort-Object Id | Select-Object -Last 1
if (!$proc) {
    Write-Host 'Window not found'
    exit 1
}

$handle = $proc.MainWindowHandle
[void][WinAPI]::ShowWindow($handle, 9)
[void][WinAPI]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 800

$rect = New-Object WinAPI+RECT
[void][WinAPI]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

Write-Host ("Capturing window '" + $proc.MainWindowTitle + "' at " + $width + "x" + $height)

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# 使用 PrintWindow 截取窗口内容（即使被遮挡）
$hwndDC = [WinAPI]::GetWindowDC($handle)
$memDC = $graphics.GetHdc()
[void][WinAPI]::PrintWindow($handle, $memDC, 2)
$graphics.ReleaseHdc($memDC)
[void][WinAPI]::ReleaseDC($handle, $hwndDC)

if ($OutputPath -eq "") {
  $timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  $OutputPath = "C:\Users\Lenovo\AppData\Local\Temp\codex-win-" + $timestamp + ".png"
}
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Host $OutputPath
