' Starts the remote-approve broker (tools/claude-approve-broker.js) with no
' visible window. Safe to run when one is already up: the broker exits
' quietly on EADDRINUSE. Used by serve-hidden.vbs at login and by
' approve-on.cmd after a break-glass disable.
Dim fso, folder, sh
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c node """ & folder & "\claude-approve-broker.js""", 0, False
