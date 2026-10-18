// Backup, restauração, exportação e importação. Nunca substitui o banco sem cópia de segurança prévia.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, SCHEMA_VERSION, tx, all, getSettings } from '../db.js';
import { bad, notFound } from '../util.js';

const TABLES = ['settings', 'accounts', 'categories', 'recurrences', 'recurrence_skips', 'cards', 'debts', 'house_loans', 'house_loan_updates', 'subscriptions', 'entries', 'movements', 'reserves', 'reserve_movements', 'goals', 'audit_log'];
const pad = (n) => String(n).padStart(2, '0');
export const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;

export function backupDir(ctx) {
  const custom = getSettings(ctx.db).backup_dir;
  return custom || path.join(path.dirname(ctx.file), 'backups');
}
const q = (p) => `'${p.replace(/'/g, "''")}'`;

// Abre a cópia somente leitura e confere integridade e estrutura (prova de que pode ser restaurada).
export function verifyBackup(file) {
  if (!fs.existsSync(file)) throw notFound('Arquivo de backup não encontrado.');
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const ok = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (ok !== 'ok') throw bad(`Backup corrompido: ${ok}`);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version < 1 || version > SCHEMA_VERSION) throw bad('Este arquivo não é um banco do Wallet compatível.');
    const counts = {};
    for (const t of ['accounts', 'entries', 'movements', 'reserves']) counts[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    return { ok: true, version, counts, size: fs.statSync(file).size };
  } catch (e) {
    if (e.status) throw e;
    throw bad('Arquivo inválido ou corrompido: ' + e.message);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

export function createBackup(ctx, prefix = 'WalletLucas') {
  const dir = backupDir(ctx);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${prefix}_${stamp()}.db`);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `${prefix}_${stamp()}_${i}.db`);
  ctx.db.exec(`VACUUM INTO ${q(file)}`);
  const check = verifyBackup(file);
  return { name: path.basename(file), file, ...check };
}

export function listBackups(ctx) {
  const dir = backupDir(ctx);
  if (!fs.existsSync(dir)) return { dir, items: [] };
  const items = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).map((f) => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, size: st.size, modified: st.mtime.toISOString() };
  }).sort((a, b) => b.modified.localeCompare(a.modified));
  return { dir, items };
}

export function restoreBackup(ctx, source) {
  const file = path.isAbsolute(source) ? source : path.join(backupDir(ctx), path.basename(source));
  verifyBackup(file); // antes de tocar em qualquer coisa
  const safety = createBackup(ctx, 'antes-de-restaurar');
  const tmp = `${ctx.file}.restore-tmp`;
  fs.copyFileSync(file, tmp);
  ctx.db.close();
  try {
    fs.renameSync(tmp, ctx.file);
  } finally {
    ctx.db = openDb(ctx.file); // reabre (também em caso de falha, com o banco original)
  }
  return { restored: path.basename(file), safety: safety.name };
}

// Mantém os 30 backups automáticos mais recentes; cria um por dia.
export function ensureDailyBackup(ctx, today) {
  const { items } = listBackups(ctx);
  if (items.some((i) => i.name.startsWith(`WalletLucas_auto_${today}`))) return null;
  const hasData = tx(ctx.db, () => all(ctx.db, 'SELECT 1 FROM accounts LIMIT 1').length > 0);
  if (!hasData) return null;
  const r = createBackup(ctx, `WalletLucas_auto`);
  const dir = backupDir(ctx);
  const autos = listBackups(ctx).items.filter((i) => i.name.startsWith('WalletLucas_auto_'));
  for (const old of autos.slice(30)) fs.rmSync(path.join(dir, old.name), { force: true });
  return r;
}

export function exportJson(db) {
  const data = {};
  for (const t of TABLES) data[t] = all(db, `SELECT * FROM ${t}`);
  return { app: 'WalletLucas', schema: SCHEMA_VERSION, exported_at: new Date().toISOString(), data };
}

export function importJson(ctx, payload) {
  if (!payload || payload.app !== 'WalletLucas' || !payload.data) throw bad('Arquivo de exportação inválido.');
  if (!(payload.schema >= 1 && payload.schema <= SCHEMA_VERSION)) throw bad('Versão do arquivo de exportação incompatível.');
  if (payload.schema < 2) payload.data.cards ??= [];
  payload.data.house_loans ??= [];
  payload.data.house_loan_updates ??= [];
  for (const t of TABLES) if (!Array.isArray(payload.data[t])) throw bad(`Tabela ausente no arquivo: ${t}.`);
  const safety = createBackup(ctx, 'antes-de-importar');
  const db = ctx.db;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    tx(db, () => {
      for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM ${t}`);
      for (const t of TABLES) {
        for (const row of payload.data[t]) {
          const cols = Object.keys(row);
          db.prepare(`INSERT INTO ${t}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
        }
      }
      const bad_fk = db.prepare('PRAGMA foreign_key_check').all();
      if (bad_fk.length) throw bad('O arquivo contém referências inconsistentes; nada foi alterado.');
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  return { imported: true, safety: safety.name };
}
