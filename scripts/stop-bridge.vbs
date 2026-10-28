' Stop the local bridge (used after updating bridge.mjs).
' Double-click; a message box reports the result. Keep this file ASCII-only.
Option Explicit
On Error Resume Next
Dim http
Set http = CreateObject("MSXML2.XMLHTTP")
http.Open "POST", "http://127.0.0.1:8766/shutdown", False
http.Send "{}"
If Err.Number = 0 Then
  MsgBox "Bridge stopped.", 64, "DSH Edge Bridge"
Else
  MsgBox "Bridge is not running.", 48, "DSH Edge Bridge"
End If
