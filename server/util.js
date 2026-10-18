import { isValidDate } from './core/dates.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (m) => new HttpError(400, m);
export const notFound = (m = 'Registro não encontrado.') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

export function str(v, { name = 'Campo', max = 300, required = false } = {}) {
  if (v == null || String(v).trim() === '') {
    if (required) throw bad(`${name} é obrigatório.`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw bad(`${name} excede ${max} caracteres.`);
  return s;
}
export function cents(v, { name = 'Valor', positive = true, required = true } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${name} é obrigatório.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e13) throw bad(`${name} inválido.`);
  if (positive ? n <= 0 : n < 0) throw bad(`${name} deve ser ${positive ? 'maior que zero' : 'zero ou positivo'}.`);
  return n;
}
export function int(v, { name = 'Número', min = 0, max = 100000, required = true } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${name} é obrigatório.`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} inválido.`);
  return n;
}
export function date(v, { name = 'Data', required = true } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`${name} é obrigatória.`);
    return null;
  }
  if (!isValidDate(v)) throw bad(`${name} inválida.`);
  return v;
}
export function oneOf(v, list, { name = 'Valor', def } = {}) {
  if (v == null || v === '') {
    if (def !== undefined) return def;
    throw bad(`${name} é obrigatório.`);
  }
  if (!list.includes(v)) throw bad(`${name} inválido.`);
  return v;
}
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export const nowIso = () => new Date().toISOString();
