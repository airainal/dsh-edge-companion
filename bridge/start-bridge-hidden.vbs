' DSH Edge Bridge - hidden launcher (used by the dshedge:// protocol).
' dshedge://start  -> start the bridge only
' dshedge://open   -> start the bridge, then open the DeepSeek Harness client
' Keep this file ASCII-only.
Option Explicit
Dim fso, sh, dir, node, nodeFile, ts, candidates, c, p, arg, exe, roots

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
node = ""
arg = ""
If WScript.Arguments.Count > 0 Then arg = LCase(CStr(WScript.Arguments(0)))

nodeFile = dir & "\node-path.txt"
If fso.FileExists(nodeFile) Then
  Set ts = fso.OpenTextFile(nodeFile, 1)
  If Not ts.AtEndOfStream Then node = Trim(ts.ReadLine)
  ts.Close
End If

If node = "" Or Not fso.FileExists(node) Then
  candidates = Array( _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\DeepSeek Harness", _
    sh.ExpandEnvironmentStrings("%ProgramW6432%") & "\DeepSeek Harness", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\DeepSeek Harness", _
    "C:\Program Files (x86)\DeepSeek Harness", _
    "C:\DeepSeek Harness", "D:\DeepSeek Harness", "E:\DeepSeek Harness")
  For Each c In candidates
    p = c & "\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
    If fso.FileExists(p) Then
      node = p
      Exit For
    End If
  Next
End If

If node = "" Then
  MsgBox "DSH Edge Bridge: no Node runtime found." & vbCrLf & _
         "Set DSH_NODE, or run bridge\start-bridge.cmd once.", 48, "DSH Edge Bridge"
  WScript.Quit 1
End If

' 1) start the bridge (hidden, do not wait)
sh.CurrentDirectory = dir
sh.Run """" & node & """ """ & dir & "\bridge.mjs""", 0, False

' 2) optionally open the DeepSeek Harness client (dshedge://open)
If InStr(arg, "dshedge://open") > 0 Then
  roots = Array( _
    sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\DeepSeek Harness", _
    sh.ExpandEnvironmentStrings("%ProgramW6432%") & "\DeepSeek Harness", _
    sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\DeepSeek Harness", _
    "C:\Program Files (x86)\DeepSeek Harness", _
    "C:\DeepSeek Harness", "D:\DeepSeek Harness", "E:\DeepSeek Harness")
  exe = ""
  For Each c In roots
    p = c & "\DeepSeek Harness.exe"
    If fso.FileExists(p) Then
      exe = p
      Exit For
    End If
  Next
  If exe <> "" Then sh.Run """" & exe & """", 1, False
End If
