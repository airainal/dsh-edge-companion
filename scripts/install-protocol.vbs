' One-time setup (no console window): register the dshedge:// protocol for the current user.
' Double-click this file. No admin rights. Nothing is added to startup.
' The handler only starts the bridge when you click the sidebar button.
' Keep this file ASCII-only.
Option Explicit
Dim fso, sh, here, root, wscriptExe, launcher, icon, cmd, arg, i, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)   ' ...\scripts
root = fso.GetParentFolderName(here)                     ' ...\dsh-edge-companion
launcher = root & "\bridge\start-bridge-hidden.vbs"
icon = root & "\extension\icons\icon32.png"
wscriptExe = sh.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"

If Not fso.FileExists(launcher) Then
  MsgBox "Missing file:" & vbCrLf & launcher & vbCrLf & vbCrLf & _
         "Keep the folder structure intact, then run this again.", 16, "DSH Edge Bridge"
  WScript.Quit 1
End If

cmd = """" & wscriptExe & """ """ & launcher & """ ""%1"""

' dry run (used for checking without touching the registry)
For i = 0 To WScript.Arguments.Count - 1
  arg = LCase(CStr(WScript.Arguments(i)))
  If arg = "dry" Or arg = "--dry" Then
    WScript.Echo "handler: " & cmd
    WScript.Quit 0
  End If
Next

On Error Resume Next
sh.RegWrite "HKCU\Software\Classes\dshedge\", "URL:DSH Edge Bridge", "REG_SZ"
sh.RegWrite "HKCU\Software\Classes\dshedge\URL Protocol", "", "REG_SZ"
sh.RegWrite "HKCU\Software\Classes\dshedge\DefaultIcon\", icon, "REG_SZ"
sh.RegWrite "HKCU\Software\Classes\dshedge\shell\open\command\", cmd, "REG_SZ"
rc = Err.Number
On Error GoTo 0

If rc = 0 Then
  MsgBox "dshedge:// is now registered." & vbCrLf & vbCrLf & _
         "In the Edge sidebar, click ""Start bridge"" (or ""Start bridge and open DSH"")." & vbCrLf & _
         "Nothing runs until you click.", 64, "DSH Edge Bridge"
Else
  MsgBox "Registration failed (error " & rc & ")." & vbCrLf & _
         "Try running scripts\install-protocol.cmd instead.", 16, "DSH Edge Bridge"
  WScript.Quit 1
End If
