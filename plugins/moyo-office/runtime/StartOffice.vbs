Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
exe = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "AIOrchestraOffice.exe")
shell.Run Chr(34) & exe & Chr(34), 0, False
