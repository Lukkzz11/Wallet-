import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('1. Compilando interface web...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

console.log('2. Verificando ícone...');
if (!fs.existsSync(path.join(root, 'launcher', 'WalletLucas.ico'))) throw new Error('launcher/WalletLucas.ico não encontrado.');

console.log('3. Verificando runtime embutido (node.exe)...');
const runtimeDir = path.join(root, 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
const targetNode = path.join(runtimeDir, 'node.exe');
if (!fs.existsSync(targetNode)) {
  const sysNode = process.execPath;
  console.log(`Copiando ${sysNode} para ${targetNode}...`);
  fs.copyFileSync(sysNode, targetNode);
}

console.log('4. Localizando compilador Inno Setup (ISCC.exe)...');
const isccPaths = [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
];
const iscc = isccPaths.find((p) => fs.existsSync(p));
if (!iscc) {
  throw new Error('ISCC.exe não encontrado. Instale o Inno Setup 6.');
}

console.log(`Usando compilador: ${iscc}`);
console.log('5. Gerando WalletSetup.exe...');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; // única fonte da versão
execSync(`"${iscc}" /DMyAppVersion=${version} "${path.join(root, 'installer.iss')}"`, { cwd: root, stdio: 'inherit' });

const setupPath = path.join(root, 'WalletSetup.exe');
if (fs.existsSync(setupPath)) {
  const sizeMb = (fs.statSync(setupPath).size / (1024 * 1024)).toFixed(2);
  console.log(`\n Sucesso! Instalador gerado: ${setupPath} (${sizeMb} MB)`);
}
