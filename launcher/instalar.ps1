# Prepara o Wallet: dependências, interface, ícone e atalhos (Área de Trabalho e Menu Iniciar).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js nao encontrado. Instale o Node.js 22 ou superior (nodejs.org).' }
$major = [int]((node -v).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw "Node.js $major e antigo. Instale a versao 22 ou superior." }

if (-not (Test-Path 'node_modules')) { Write-Host 'Instalando dependencias...'; npm install --no-audit --no-fund }
Write-Host 'Compilando a interface...'
npm run build
node launcher\make-icon.js

$vbs = Join-Path $root 'launcher\WalletLucas.vbs'
$ico = Join-Path $root 'launcher\WalletLucas.ico'
$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Wallet.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Wallet.lnk')
)
foreach ($old in @('Desktop', 'Programs')) { $p = Join-Path ([Environment]::GetFolderPath($old)) 'Wallet Lucas.lnk'; if (Test-Path $p) { Remove-Item $p -Force; Write-Host "Atalho antigo removido: $p" } }
foreach ($t in $targets) {
  $s = $shell.CreateShortcut($t)
  $s.TargetPath = "$env:WINDIR\System32\wscript.exe"
  $s.Arguments = "`"$vbs`""
  $s.WorkingDirectory = $root
  $s.IconLocation = $ico
  $s.Description = 'Wallet - controle financeiro pessoal'
  $s.Save()
  Write-Host "Atalho criado: $t"
}
Write-Host ''
Write-Host "Pronto. Seus dados ficam em: $env:APPDATA\WalletLucas (fora desta pasta)."
