Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

worker = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start_bootcord.bat")
shell.Run "cmd.exe /d /c call """ & worker & """", 0, False
