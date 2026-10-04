' Cursor hook：无控制台窗口运行 node（避免 PowerShell/CMD 一闪而过）
Option Explicit

Dim fso, shell, root, scriptRel, scriptFull, cmd, i

If WScript.Arguments.Count < 1 Then
  WScript.Quit 1
End If

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
scriptRel = WScript.Arguments(0)
scriptFull = fso.GetAbsolutePathName(fso.BuildPath(root, scriptRel))

cmd = "node.exe """ & scriptFull & """"
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next

shell.CurrentDirectory = root
shell.Run cmd, 0, True
WScript.Quit 0
