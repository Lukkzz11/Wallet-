// Bloqueio por senha (scrypt + sal). A senha nunca é guardada em texto puro.
import crypto from 'node:crypto';
import { get, run } from '../db.js';
import { bad, HttpError } from '../util.js';

const sessions = new Set();
const KEY = 'password_hash';

const hash = (pw, salt) => crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
export function hasPassword(db) { return !!get(db, 'SELECT value FROM settings WHERE key=?', KEY); }
function setHash(db, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  run(db, 'INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', KEY, `scrypt$${salt}$${hash(pw, salt)}`);
}
export function verify(db, pw) {
  const row = get(db, 'SELECT value FROM settings WHERE key=?', KEY);
  if (!row) return true;
  const [, salt, h] = row.value.split('$');
  const a = Buffer.from(hash(String(pw ?? ''), salt), 'hex'), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
let failures = 0, lockUntil = 0;
export function login(db, pw) {
  if (Date.now() < lockUntil) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns segundos.');
  if (!verify(db, pw)) {
    if (++failures >= 5) { lockUntil = Date.now() + 30000; failures = 0; }
    throw new HttpError(401, 'Senha incorreta.');
  }
  failures = 0;
  const t = crypto.randomBytes(24).toString('hex');
  sessions.add(t);
  return t;
}
export const isAuthed = (db, token) => !hasPassword(db) || sessions.has(token);
export function setPassword(db, current, next) {
  if (typeof next !== 'string' || next.length < 4) throw bad('A senha deve ter ao menos 4 caracteres.');
  if (hasPassword(db) && !verify(db, current)) throw new HttpError(401, 'Senha atual incorreta.');
  setHash(db, next);
}
export function removePassword(db, current) {
  if (!verify(db, current)) throw new HttpError(401, 'Senha atual incorreta.');
  run(db, 'DELETE FROM settings WHERE key=?', KEY);
  sessions.clear();
}
export const logout = (t) => sessions.delete(t);
