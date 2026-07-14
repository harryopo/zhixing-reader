Set objShell = CreateObject("WScript.Shell")
objShell.CurrentDirectory = objShell.ExpandEnvironmentStrings("%~dp0")
objShell.Run "cmd /c cd /d """ & objShell.CurrentDirectory & """ && npm run dev", 0, False
