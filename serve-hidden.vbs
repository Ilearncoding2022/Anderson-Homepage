' Starts the local web server for the homepage with no visible window.
' Bound to 127.0.0.1 so it's reachable only from this PC. Put a shortcut to this
' file in your Startup folder (Win+R -> shell:startup) so the server is always
' running and http://localhost:8000/ works as your Brave homepage.
Dim fso, folder, sh
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d """ & folder & """ && python -m http.server 8000 --bind 127.0.0.1", 0, False
