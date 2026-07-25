Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Name -eq 'electron' } | Select-Object Name, MainWindowTitle, MainWindowHandle, Id, @{N='Path';E={$_.Path}} | Format-Table -AutoSize
