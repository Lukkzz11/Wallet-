import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { routes } from './routes.js';
import { HttpError } from './util.js';
import { isAuthed } from './services/auth.js';
import { keyMatches } from './services/connect.js';
import { ensureDailyBackup } from './services/backup.js';
import { startAutoUpdater } from './services/updater.js';
import { todayStr } from './core/dates.js';

const PORT = Number(process.env.WALLET_PORT || 47821);
const HOST = '127.0.0.1'; // nunca exposto à rede
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'web', 'dist');
const dataDir = process.env.WALLET_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'WalletLucas');
const file = path.join(dataDir, 'wallet.db');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };
const OPEN_PATHS = ['/api/health', '/api/auth/status', '/api/auth/login'];

export function createServer(ctx, { port = PORT } = {}) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, 'localhost:5173', '127.0.0.1:5173']);
  return http.createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      const isStr = typeof body === 'string' || Buffer.isBuffer(body);
      res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(isStr ? {} : { 'Content-Type': 'application/json; charset=utf-8' }), ...headers });
      res.end(isStr ? body : JSON.stringify(body));
    };
    try {
      // Proteção contra DNS rebinding e requisições de outros sites.
      if (!allowedHosts.has(req.headers.host)) return send(403, { error: 'Host não permitido.' });
      const origin = req.headers.origin;
      if (origin && req.method !== 'GET' && !allowedHosts.has(new URL(origin).host)) return send(403, { error: 'Origem não permitida.' });

      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith('/api/')) {
        const token = req.headers['x-wallet-token'];
        // API aberta: só /api/open/* e só com a chave da integração
        if (url.pathname.startsWith('/api/open/')) { if (!keyMatches(ctx.db, req.headers['x-wallet-key'])) return send(401, { error: 'Chave inválida.' }); }
        else if (!OPEN_PATHS.includes(url.pathname) && !isAuthed(ctx.db, token)) return send(401, { error: 'Bloqueado. Informe a senha.', locked: true });
        let body = {};
        if (req.method === 'POST' || req.method === 'PUT') {
          const chunks = []; let size = 0;
          for await (const ch of req) { size += ch.length; if (size > 100e6) throw new HttpError(413, 'Arquivo grande demais.'); chunks.push(ch); }
          const raw = Buffer.concat(chunks).toString('utf8');
          try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'JSON inválido.'); }
        }
        for (const [method, re, handler] of routes) {
          if (method !== req.method) continue;
          const m = re.exec(url.pathname);
          if (!m) continue;
          const out = await handler(ctx, { params: m.groups || {}, query: Object.fromEntries(url.searchParams), body, token });
          if (out && out.__download) return send(200, JSON.stringify(out.body), { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.__download}"` });
          return send(200, out ?? { ok: true });
        }
        return send(404, { error: 'Rota não encontrada.' });
      }
      // arquivos estáticos (interface compilada)
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const target = path.normalize(path.join(dist, rel));
      if (!target.startsWith(dist)) return send(403, 'Proibido');
      const f = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
      if (!fs.existsSync(f)) return send(200, '<h1>Wallet</h1><p>Interface não compilada. Execute <code>npm run build</code>.</p>', { 'Content-Type': 'text/html; charset=utf-8' });
      return send(200, fs.readFileSync(f), { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    } catch (e) {
      if (e instanceof HttpError) return send(e.status, { error: e.message });
      if (/UNIQUE constraint failed/.test(e.message)) return send(409, { error: 'Registro duplicado: este lançamento já existe.' });
      if (/FOREIGN KEY|CHECK constraint/.test(e.message)) return send(400, { error: 'Dados inconsistentes: ' + e.message });
      console.error(e);
      return send(500, { error: 'Erro interno: ' + e.message });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ctx = { db: openDb(file), file, dataDir };
  try { ensureDailyBackup(ctx, todayStr()); } catch (e) { console.error('Backup automático falhou:', e.message); }
  try { startAutoUpdater(ctx); } catch (e) { console.error('Auto-updater falhou ao iniciar:', e.message); }
  const server = createServer(ctx);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.log('Wallet já está em execução.'); process.exit(0); }
    throw e;
  });
  server.listen(PORT, HOST, () => console.log(`Wallet em http://${HOST}:${PORT}  |  dados: ${file}`));
  const stop = () => { try { ctx.db.close(); } catch { /* ignore */ } process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
