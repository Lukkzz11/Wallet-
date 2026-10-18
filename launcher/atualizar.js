// Atualiza o Wallet instalado com a versão desta pasta (código-fonte do projeto). Sem internet.
// Passos: compila a interface → fecha o Wallet → backup do banco → troca os arquivos (guarda os antigos) → reabre.
// Nunca toca em dados: o banco fica em %APPDATA%\WalletLucas e só recebe uma cópia de segurança.
// Uso: node launcher/atualizar.js [pasta-instalada] [arquivo-resultado]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const src = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.WALLET_PORT || 47821);
const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const dataDir = process.env.WALLET_DATA_DIR || path.join(appData, 'WalletLucas');
const localApp = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const target = path.resolve(process.argv[2] || path.join(localApp, 'Programs', 'Wallet'));
const resultFile = process.argv[3];
const logFile = path.join(dataDir, 'atualizar.log');
fs.mkdirSync(dataDir, { recursive: true });

const log = (m) => { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${m}\n`); };
const finish = (code, msg) => { log(msg); if (resultFile) fs.writeFileSync(resultFile, '﻿' + msg, 'utf16le'); process.exit(code); };
const version = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version; } catch { return '?'; } };
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// itens copiados da pasta do projeto para a pasta instalada (runtime e dados ficam como estão)
const ITEMS = ['server', path.join('web', 'dist'), 'launcher', 'package.json', 'MANUAL.md', 'README.md'];

try {
  log(`--- atualização iniciada: ${src} -> ${target}`);
  if (!fs.existsSync(path.join(src, 'server', 'index.js'))) finish(1, 'Não encontrei os arquivos do Wallet nesta pasta.');
  const inPlace = sameDir(src, target) || !fs.existsSync(target);
  const dest = inPlace ? src : target;
  const before = version(dest);

  // 1) compila a interface em pasta separada; se falhar, nada do que está instalado é mexido
  const vite = path.join(src, 'node_modules', 'vite', 'bin', 'vite.js');
  const novo = path.join(src, 'web', 'dist-novo');
  if (fs.existsSync(vite) && fs.existsSync(path.join(src, 'web', 'src'))) {
    fs.rmSync(novo, { recursive: true, force: true });
    const b = spawnSync(process.execPath, [vite, 'build', '--config', path.join(src, 'web', 'vite.config.js'), '--outDir', novo, '--emptyOutDir'], { cwd: src, encoding: 'utf8', windowsHide: true });
    if (b.status !== 0) finish(1, 'Não consegui montar a interface nova. Nada foi alterado.\n' + String(b.stderr || b.stdout).slice(-600));
    fs.rmSync(path.join(src, 'web', 'dist'), { recursive: true, force: true });
    fs.renameSync(novo, path.join(src, 'web', 'dist'));
    log('interface compilada');
  } else if (!fs.existsSync(path.join(src, 'web', 'dist', 'index.html'))) {
    finish(1, 'A interface não está compilada e não há como compilar aqui (falta node_modules).');
  }

  // 2) fecha o Wallet (servidor e janela)
  const ns = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
  const pids = new Set();
  for (const line of (ns.stdout || '').split(/\r?\n/)) {
    const m = new RegExp(String.raw`127\.0\.0\.1:${PORT}\s+\S+\s+LISTENING\s+(\d+)`).exec(line);
    if (m) pids.add(m[1]);
  }
  for (const pid of pids) spawnSync('taskkill', ['/PID', pid, '/F'], { windowsHide: true });
  spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*WalletLucas*browser-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { windowsHide: true });
  spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 900'], { windowsHide: true });
  log(`wallet fechado (${pids.size} servidor)`);

  // 3) backup consistente do banco (VACUUM INTO junta o que está no arquivo e no log do SQLite)
  const dbFile = path.join(dataDir, 'wallet.db');
  let backup = '';
  if (fs.existsSync(dbFile)) {
    fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    backup = path.join(dataDir, 'backups', `antes-atualizar_${stamp}.db`);
    const db = new DatabaseSync(dbFile);
    try { db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`); } finally { db.close(); }
    const chk = new DatabaseSync(backup, { readOnly: true });
    const ok = chk.prepare('PRAGMA integrity_check').get();
    chk.close();
    if (Object.values(ok)[0] !== 'ok') finish(1, 'O backup do banco não passou na verificação. Nada foi alterado.');
    log(`backup: ${backup}`);
  }

  // 4) troca os arquivos, guardando os antigos para desfazer se algo falhar
  if (!inPlace) {
    const old = path.join(target, '.antigo');
    fs.rmSync(old, { recursive: true, force: true });
    const done = [];
    try {
      for (const it of ITEMS) {
        const from = path.join(src, it), to = path.join(target, it);
        if (!fs.existsSync(from)) continue;
        if (fs.existsSync(to)) { fs.mkdirSync(path.dirname(path.join(old, it)), { recursive: true }); fs.cpSync(to, path.join(old, it), { recursive: true }); }
        fs.rmSync(to, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(from, to, { recursive: true });
        done.push(it);
      }
    } catch (e) {
      for (const it of done) { try { fs.rmSync(path.join(target, it), { recursive: true, force: true }); fs.cpSync(path.join(old, it), path.join(target, it), { recursive: true }); } catch { /* melhor esforço */ } }
      finish(1, 'Falhou ao copiar os arquivos (' + e.message + '). Voltei para a versão anterior.');
    }
    log('arquivos trocados');
    fs.writeFileSync(path.join(target, 'launcher', 'origem.json'), JSON.stringify({ source: src, atualizado_em: new Date().toISOString() }));
  }

  // 5) reabre o Wallet
  const vbs = path.join(dest, 'launcher', 'WalletLucas.vbs');
  if (!process.env.WALLET_NO_OPEN) spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  const after = version(dest);
  finish(0, `Wallet atualizado (versão ${before} para ${after}). Seus dados foram mantidos${backup ? ' e uma cópia de segurança foi criada' : ''}. O Wallet está abrindo.`);
} catch (e) {
  finish(1, 'Erro inesperado: ' + e.message + '. Seus dados não foram alterados.');
}
