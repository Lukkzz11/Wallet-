// Leitores de arquivos financeiros (CSV, OFX, PDF com texto). Funções puras, sem rede: o arquivo nunca sai do computador.
// Convenção: amount em centavos; negativo = saída/gasto, positivo = entrada/crédito.

export function parseDate(s, defaultYear) {
  s = String(s || '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return ok(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX
  if (m) return ok(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/.exec(s);
  if (!m) return null;
  const y = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : defaultYear ? String(defaultYear) : null;
  if (!y) return null;
  return ok(`${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
}
function ok(d) {
  const [y, mo, da] = d.split('-').map(Number);
  return mo >= 1 && mo <= 12 && da >= 1 && da <= new Date(Date.UTC(y, mo, 0)).getUTCDate() ? d : null;
}

export function parseAmount(s) {
  let t = String(s ?? '').replace(/R\$|\s/g, '');
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (/[dD]$/.test(t)) { neg = true; t = t.slice(0, -1); } else if (/[cC]$/.test(t)) t = t.slice(0, -1); // D/C de extratos
  if (t.endsWith('-')) { neg = !neg; t = t.slice(0, -1); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); } else if (t.startsWith('+')) t = t.slice(1);
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const c = Math.round(Number(t) * 100);
  return neg ? -c : c;
}

// "PARC 03/10", "3/10", "03 de 10": devolve a parcela atual e o total, sem inventar quando não há padrão.
export function detectInstallment(desc) {
  const m = /(?:parc(?:ela)?\.?\s*)?\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i.exec(String(desc || ''));
  if (!m) return null;
  const current = Number(m[1]), total = Number(m[2]);
  return total >= 2 && total <= 60 && current >= 1 && current <= total ? { current, total } : null;
}

/* ---------- CSV ---------- */
function splitLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === d && !q) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
export function parseCsv(text, defaultYear) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], bad: [] };
  const d = [';', '\t', ','].map((c) => [c, (lines[0].match(new RegExp(c === '\t' ? '\t' : `\\${c}`, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], d).map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => /data|date|valor|amount|descri|hist/.test(h));
  const find = (re, def) => { const i = head.findIndex((h) => re.test(h)); return hasHeader && i >= 0 ? i : def; };
  const iDate = find(/data|date/, 0), iDesc = find(/descri|hist|memo|lan[cç]amento|estabelec/, 1), iVal = find(/valor|amount|montante/, 2), iId = find(/^id$|identificador|fitid|documento/, -1);
  const rows = [], bad = [];
  (hasHeader ? lines.slice(1) : lines).forEach((l, n) => {
    const c = splitLine(l, d);
    const date = parseDate(c[iDate] || '', defaultYear), amount = parseAmount(c[iVal] ?? ''), description = (c[iDesc] || '').slice(0, 120);
    if (date && amount && description) rows.push({ date, description, amount, id: iId >= 0 && c[iId] ? c[iId] : undefined }); else bad.push(n + (hasHeader ? 2 : 1));
  });
  return { rows, bad };
}

/* ---------- OFX (SGML ou XML) ---------- */
export function parseOfx(text) {
  const src = String(text).replace(/\r/g, '');
  const isCard = /<CCSTMTRS>|<CREDITCARDMSGSRSV1>|<CCSTMTTRNRS>/i.test(src);
  const chunks = src.split(/<STMTTRN>/i).slice(1);
  const rows = [], bad = [];
  chunks.forEach((chunk, n) => {
    const body = chunk.split(/<\/STMTTRN>/i)[0];
    const tag = (name) => { const m = new RegExp(`<${name}>([^<\\n]*)`, 'i').exec(body); return m ? m[1].trim() : ''; };
    const date = parseDate(tag('DTPOSTED') || tag('DTUSER'));
    const amt = tag('TRNAMT').replace(',', '.');
    const amount = /^[-+]?\d+(\.\d+)?$/.test(amt) ? Math.round(Number(amt) * 100) : null;
    const name = tag('NAME'), memo = tag('MEMO');
    const description = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' - ').slice(0, 120);
    if (date && amount && description) rows.push({ date, description, amount, id: tag('FITID') || undefined }); else bad.push(n + 1);
  });
  return { rows, bad, kind: isCard ? 'card' : 'bank' };
}

/* ---------- PDF (somente PDFs com texto; escaneados ou com codificação própria exigem revisão manual) ---------- */
function pdfString(raw) {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e) => {
    if (/^[0-7]+$/.test(e)) return String.fromCharCode(parseInt(e, 8));
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[e] ?? '';
  });
}
function hexToText(hex) {
  const h = hex.replace(/\s/g, '');
  let out = '';
  for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return out;
}
function contentToText(content) {
  const re = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj|(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]|T\*|\bET\b/g;
  let out = '', m;
  while ((m = re.exec(content))) {
    if (m[1] !== undefined) {
      const parts = [...m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)|(-?[\d.]+)/g)];
      for (const p of parts) { if (p[1] !== undefined) out += pdfString(p[1]); else if (Number(p[2]) < -200) out += ' '; }
    } else if (m[2] !== undefined) out += pdfString(m[2]);
    else if (m[3] !== undefined) out += hexToText(m[3]);
    else if (m[4] !== undefined) { if (Math.abs(Number(m[5])) > 0.01) out += '\n'; else out += ' '; } else out += '\n';
  }
  return out;
}
// inflate: async (Uint8Array) => Uint8Array (zlib). No navegador: DecompressionStream('deflate'); nos testes: zlib.inflateSync.
export async function extractPdfText(bytes, inflate) {
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const parts = [];
  for (const m of bin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Uint8Array.from(m[1], (c) => c.charCodeAt(0));
    let content = null;
    try { const out = await inflate(raw); content = Array.from(out, (b) => String.fromCharCode(b)).join(''); } catch { content = m[1]; }
    if (/\bBT\b/.test(content)) parts.push(contentToText(content));
  }
  const text = parts.join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  const printable = (text.match(/[\p{L}\p{N}\s.,/$-]/gu) || []).length;
  return text.length > 20 && printable / text.length > 0.85 ? text : ''; // texto ilegível = precisa de revisão manual
}
const AMOUNT_END = /(-?\s?R?\$?\s?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s?[CD])?-?)\s*$/;
export function parsePdfText(text, defaultYear) {
  const rows = [], bad = [];
  String(text).split(/\n+/).forEach((line, n) => {
    const l = line.replace(/\s+/g, ' ').trim();
    const dm = /^(\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)\s+(.*)$/.exec(l);
    if (!dm) return;
    const am = AMOUNT_END.exec(dm[2]);
    const date = parseDate(dm[1], defaultYear), amount = am ? parseAmount(am[1]) : null;
    const description = (am ? dm[2].slice(0, am.index) : dm[2]).trim().slice(0, 120);
    if (date && amount && description) rows.push({ date, description, amount }); else bad.push(n + 1);
  });
  return { rows, bad };
}

export const normalizeDesc = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
