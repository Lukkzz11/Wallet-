// Datas como strings 'YYYY-MM-DD' (sem fuso). Funções puras.
export const pad = (n) => String(n).padStart(2, '0');
export const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function todayStr(d = new Date()) {
  return fmt(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
export function parse(s) {
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parse(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addMonths(s, n, anchorDay) {
  const { y, m, d } = parse(s);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return fmt(ny, nm, Math.min(anchorDay ?? d, daysInMonth(ny, nm)));
}
export function addDays(s, n) {
  const { y, m, d } = parse(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function diffDays(a, b) {
  const pa = parse(a), pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}
export const monthOf = (s) => s.slice(0, 7);
export const monthStart = (k) => `${k}-01`;
export function monthEnd(k) {
  const [y, m] = k.split('-').map(Number);
  return fmt(y, m, daysInMonth(y, m));
}
export function addMonthKey(k, n) {
  return monthOf(addMonths(`${k}-01`, n));
}
export function monthRange(fromKey, toKey) {
  const out = [];
  for (let k = fromKey; k <= toKey; k = addMonthKey(k, 1)) out.push(k);
  return out;
}

export const PERIOD_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 };
export const PERIODS = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'];

// n-ésima ocorrência a partir de `start` (sem acumular erro de fim de mês).
export function nthOccurrence(start, period, n, anchorDay) {
  if (period === 'weekly') return addDays(start, 7 * n);
  return addMonths(start, PERIOD_MONTHS[period] * n, anchorDay ?? parse(start).d);
}
// Ocorrências em [from, to]; from pode ser null (sem limite inferior).
export function occurrences(start, period, from, to, anchorDay, endDate = null) {
  const out = [];
  for (let i = 0; i < 5000; i++) {
    const d = nthOccurrence(start, period, i, anchorDay);
    if (d > to || (endDate && d > endDate)) break;
    if (!from || d >= from) out.push(d);
  }
  return out;
}
