export const brl = (c) => ((c ?? 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dateBR = (s) => (s ? s.split('-').reverse().join('/') : '—');
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MONTHS_FULL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const monthShort = (k) => `${MONTHS[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}`;
export const monthFull = (k) => `${MONTHS_FULL[Number(k.slice(5, 7)) - 1]} de ${k.slice(0, 4)}`;
export const addMonthKey = (k, n) => {
  const [y, m] = k.split('-').map(Number);
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
};
export const pad = (n) => String(n).padStart(2, '0');
export const addDaysStr = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
export const monthEnd = (k) => {
  const [y, m] = k.split('-').map(Number);
  return `${k}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};
export const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const weekdayOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

export const PERIOD_LABEL = { weekly: 'Semanal', monthly: 'Mensal', quarterly: 'Trimestral', semiannual: 'Semestral', yearly: 'Anual' };
export const ACCOUNT_TYPES = [
  { value: 'dinheiro', label: 'Dinheiro em espécie' }, { value: 'conta', label: 'Conta bancária' }, { value: 'carteira', label: 'Carteira digital' },
  { value: 'poupanca', label: 'Poupança' }, { value: 'reserva', label: 'Reserva financeira' }, { value: 'fgts', label: 'FGTS' }, { value: 'outra', label: 'Outra' },
];
export const PAYMENT_METHODS = ['Pix', 'Cartão de débito', 'Cartão de crédito', 'Dinheiro', 'Boleto', 'Transferência', 'Débito automático', 'Outro'];

export function parseMoneyDigits(text) {
  const d = String(text).replace(/\D/g, '');
  return d ? Number(d) : 0;
}
export function toCsv(columns, rows) {
  const fmtCell = (c, v) => (v == null ? '' : c.type === 'money' ? (v / 100).toFixed(2).replace('.', ',') : c.type === 'date' ? dateBR(v) : c.type === 'month' ? monthShort(v) : c.type === 'percent' ? String(v).replace('.', ',') : v);
  const esc = (x) => { const s = String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [columns.map((c) => esc(c.label)).join(';'), ...rows.map((r) => columns.map((c) => esc(fmtCell(c, r[c.key]))).join(';'))];
  return '﻿' + lines.join('\r\n');
}
export function download(name, text, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
