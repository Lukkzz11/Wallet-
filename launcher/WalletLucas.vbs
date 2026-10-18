' Abre o Wallet sem janela de terminal.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = root
nodeCmd = "node"
If fso.FileExists(root & "\runtime\node.exe") Then
  nodeCmd = """" & root & "\runtime\node.exe"""
ElseIf sh.Run("cmd /c node --version", 0, True) <> 0 Then
  MsgBox "O Node.js não foi encontrado. Instale o Node.js 22 ou superior (nodejs.org) e abra o Wallet novamente.", 48, "Wallet"
  WScript.Quit 1
End If
If Not fso.FileExists(root & "\web\dist\index.html") Then
  MsgBox "A interface ainda não foi compilada. Execute o instalador do Wallet.", 48, "Wallet"
  WScript.Quit 1
End If
sh.Run "cmd /c " & nodeCmd & " --disable-warning=ExperimentalWarning launcher\launcher.js", 0, False
