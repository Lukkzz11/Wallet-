// Inicia o servidor local (se necessário) e abre o Wallet numa janela própria do Edge/Chrome.
// Ao fechar a janela, encerra o servidor que este inicializador iniciou.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.WALLET_PORT || 47821);
const URL_APP = `http://127.0.0.1:${PORT}/`;
const dataDir = process.env.WALLET_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WalletLucas');
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, 'wallet-lucas.log');

const up = () => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 800 }, (r) => { r.resume(); resolve(r.statusCode === 200); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const rel = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];
  for (const r of rel) for (const base of pf) { const p = path.join(base, r); if (fs.existsSync(p)) return p; }
  return null;
}

let server = null;
if (!(await up())) {
  const out = fs.openSync(logFile, 'a');
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server', 'index.js')], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
  server.unref();
  for (let i = 0; i < 50 && !(await up()); i++) await sleep(200);
  if (!(await up())) {
    fs.appendFileSync(logFile, `\n[${new Date().toISOString()}] servidor não respondeu a tempo\n`);
    process.exit(1);
  }
}

const browser = findBrowser();
if (!browser) {
  // sem Edge/Chrome: abre no navegador padrão e deixa o servidor ativo
  spawn('cmd', ['/c', 'start', '', URL_APP], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  process.exit(0);
}
const started = Date.now();
const win = spawn(browser, [`--app=${URL_APP}`, `--user-data-dir=${path.join(dataDir, 'browser-profile')}`, '--window-size=1360,880', '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'], { stdio: 'ignore' });
win.on('exit', () => {
  // se a janela "devolveu" o controle logo (navegador já aberto), mantém o servidor ativo
  if (server && Date.now() - started > 5000) { try { process.kill(server.pid); } catch { /* já encerrado */ } }
  process.exit(0);
});
