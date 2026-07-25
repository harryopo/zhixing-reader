param(
  [Parameter(Mandatory=$true)]
  [int]$ProcessId,
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

$proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (!$proc -or $proc.MainWindowHandle -eq 0) {
    Write-Host "Process $ProcessId not found or no window"
    exit 1
}

$handle = $proc.MainWindowHandle
Write-Host "Capturing PID $ProcessId window handle $handle"

$rect = New-Object WinAPI+RECT
[void][WinAPI]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

$hwndDC = [WinAPI]::GetWindowDC($handle)
$memDC = $graphics.GetHdc()
[void][WinAPI]::PrintWindow($handle, $memDC, 2)
$graphics.ReleaseHdc($memDC)
try { [void][WinAPI]::ReleaseDC($handle, $hwndDC) } catch {}

if ($OutputPath -eq "") {
  $timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  $OutputPath = "C:\Users\Lenovo\AppData\Local\Temp\codex-pid-$timestamp.png"
}
$bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
Write-Host $OutputPath
