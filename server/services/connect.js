// Saldo de hoje, importação de movimentos externos (CSV/API) e chave da API local.
import crypto from 'node:crypto';
import { get, run, tx, audit } from '../db.js';
import { bad, notFound, str, cents, date, int, nowIso } from '../util.js';
import { insertEntry } from './ledger.js';
import { createCardPurchase } from './cards.js';
import { accountBalance } from '../core/finance.js';
import { all } from '../db.js';

// "Quanto tenho hoje": ajusta o saldo da conta ao valor informado com um movimento de ajuste (histórico preservado).
export function setBalance(db, accountId, b, today) {
  const acc = get(db, 'SELECT * FROM accounts WHERE id=?', accountId);
  if (!acc) throw notFound('Conta não encontrada.');
  const target = cents(b.balance, { name: 'Saldo', positive: false });
  const current = accountBalance(acc, all(db, 'SELECT account_id,amount,date FROM movements'));
  const delta = target - current;
  if (delta === 0) return { delta: 0 };
  tx(db, () => {
    const d = acc.ref_date > today ? acc.ref_date : today;
    run(db, "INSERT INTO movements(account_id,amount,date,kind,description,created_at) VALUES (?,?,?,'manual',?,?)", accountId, delta, d, 'Ajuste de saldo informado por você', nowIso());
    audit(db, 'account', accountId, 'set-balance', { balance: current }, { balance: target });
  });
  return { delta };
}

const keyOf = (account, date_, amount, desc, n) => crypto.createHash('sha1').update(`${account}|${date_}|${amount}|${desc}|${n}`).digest('hex').slice(0, 24);

const normDesc = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// Identificador estável de cada linha: o id do arquivo (FITID etc.) ou, sem id, hash de data+descrição+valor
// (com contador para duas linhas idênticas legítimas no mesmo arquivo). Reimportar o mesmo arquivo gera as mesmas chaves.
function externalKeys(prefix, scope, items) {
  const seen = new Map();
  return items.map((it) => {
    const amount = Number(it.amount);
    if (it.id != null && String(it.id) !== '') return `${prefix === 'imp' ? 'api' : 'cid'}:${scope}:${String(it.id).slice(0, 80)}`;
    const base = `${it.date}|${amount}|${it.description}`;
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return `${prefix}:${keyOf(scope, it.date, amount, it.description, n)}`;
  });
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) throw bad('Nenhuma movimentação para importar.');
  if (items.length > 5000) throw bad('Máximo de 5000 movimentações por envio.');
  return items.map((it, i) => {
    const amount = Number(it.amount);
    if (!Number.isSafeInteger(amount) || amount === 0) throw bad(`Linha ${i + 1}: valor inválido (use centavos inteiros).`);
    return { ...it, amount, date: date(it.date, { name: `Data da linha ${i + 1}` }), description: str(it.description, { name: `Descrição da linha ${i + 1}`, required: true, max: 120 }) };
  });
}

// items: [{date:'YYYY-MM-DD', description, amount (centavos, + entrada / − saída), id?, category_id?}]
// Só grava quando chamado (depois da revisão do usuário). Já aconteceram, então entram como pagos.
// Reimportar o mesmo arquivo não duplica (external_id).
export function importTransactions(db, b) {
  const accountId = int(b.account_id, { name: 'Conta', min: 1 });
  if (!get(db, 'SELECT id FROM accounts WHERE id=?', accountId)) throw notFound('Conta não encontrada.');
  const items = validateItems(b.items);
  const keys = externalKeys('imp', accountId, items);
  let created = 0, skipped = 0;
  tx(db, () => {
    items.forEach((it, i) => {
      const ext = keys[i];
      if (get(db, 'SELECT id FROM entries WHERE external_id=?', ext)) { skipped++; return; }
      const type = it.amount > 0 ? 'income' : 'expense';
      const cat = it.category_id ? get(db, 'SELECT id FROM categories WHERE id=? AND kind=?', Number(it.category_id), type) : null;
      const id = insertEntry(db, { type, description: it.description, amount: Math.abs(it.amount), due_date: it.date, paid_date: it.date, status: 'paid', account_id: accountId, category_id: cat?.id ?? null, nature: 'avista' });
      run(db, 'UPDATE entries SET external_id=? WHERE id=?', ext, id);
      created++;
    });
    audit(db, 'import', accountId, 'transactions', null, { created, skipped });
  });
  return { created, skipped };
}

// Pré-verificação de duplicidades (não grava nada). Devolve, para cada linha, null ou {kind, text}.
//  kind 'id'      -> já importada antes (mesmo identificador): não pode ser importada de novo
//  kind 'similar' -> mesmo valor/data/descrição de algo já cadastrado: o usuário decide
export function checkImport(db, b) {
  const items = validateItems(b.items);
  if (b.mode === 'card') {
    const cardId = int(b.card_id, { name: 'Cartão', min: 1 });
    const keys = externalKeys('cimp', cardId, items.map((x) => ({ ...x, amount: Math.abs(x.amount) })));
    const debts = all(db, 'SELECT id, description, installment_amount FROM debts WHERE card_id=?', cardId);
    return items.map((it, i) => {
      if (get(db, 'SELECT id FROM entries WHERE external_id=?', keys[i])) return { kind: 'id', text: 'Já importada neste cartão.' };
      const nd = normDesc(it.description), amt = Math.abs(it.amount);
      const hit = debts.find((d) => d.installment_amount === amt && (normDesc(d.description) === nd || normDesc(d.description).includes(nd) || nd.includes(normDesc(d.description))));
      return hit ? { kind: 'similar', text: `Parecida com a compra já cadastrada "${hit.description.replace(/\s*\(\d+\/\d+\)\s*$/, '')}" (mesma parcela).` } : null;
    });
  }
  const accountId = int(b.account_id, { name: 'Conta', min: 1 });
  const keys = externalKeys('imp', accountId, items);
  const existing = all(db, "SELECT description, amount, type, COALESCE(paid_date, due_date) d FROM entries WHERE account_id=? AND debt_id IS NULL", accountId);
  return items.map((it, i) => {
    if (get(db, 'SELECT id FROM entries WHERE external_id=?', keys[i])) return { kind: 'id', text: 'Já importada antes (mesmo identificador).' };
    const nd = normDesc(it.description);
    const hit = existing.find((e) => e.d === it.date && e.amount === Math.abs(it.amount) && e.type === (it.amount > 0 ? 'income' : 'expense') && (normDesc(e.description) === nd || normDesc(e.description).includes(nd) || nd.includes(normDesc(e.description))));
    return hit ? { kind: 'similar', text: `Já existe um lançamento parecido: "${hit.description}".` } : null;
  });
}

// Fatura/extrato de cartão: cada linha vira uma compra do cartão, com as parcelas que FALTAM distribuídas
// a partir do mês da fatura. Sem informação de parcelas = 1 parcela (o usuário pode completar). Não altera saldo.
// items: [{date, description, amount (centavos > 0 = valor da parcela), remaining (>=1), id?}]
export function importCardPurchases(db, b, today) {
  const cardId = int(b.card_id, { name: 'Cartão', min: 1 });
  if (!get(db, 'SELECT id FROM cards WHERE id=?', cardId)) throw notFound('Cartão não encontrado.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.invoice_month || '')) throw bad('Informe o mês de vencimento da fatura.');
  const items = validateItems((b.items || []).map((x) => ({ ...x, amount: Math.abs(Number(x.amount)) })));
  const keys = externalKeys('cimp', cardId, items);
  let created = 0, skipped = 0;
  tx(db, () => {
    items.forEach((it, i) => {
      if (get(db, 'SELECT id FROM entries WHERE external_id=?', keys[i])) { skipped++; return; }
      const remaining = int(it.remaining ?? 1, { name: `Parcelas restantes da linha ${i + 1}`, min: 1, max: 480 });
      const { id } = createCardPurchase(db, { name: it.description, card_id: cardId, installment_amount: it.amount, installments_total: remaining, paid: 0, start_month: b.invoice_month }, today);
      run(db, 'UPDATE entries SET external_id=? WHERE debt_id=? AND installment_no=1', keys[i], id);
      created++;
    });
    audit(db, 'import', cardId, 'card-purchases', null, { created, skipped });
  });
  return { created, skipped };
}

/* chave da API local (para outros programas seus) */
export function getKey(db) { return get(db, "SELECT value FROM settings WHERE key='integration_key'")?.value ?? null; }
export function newKey(db) {
  const k = `wl_${crypto.randomBytes(24).toString('hex')}`;
  run(db, "INSERT INTO settings(key,value) VALUES ('integration_key',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k);
  return k;
}
export function keyMatches(db, given) {
  const k = getKey(db);
  if (!k || typeof given !== 'string') return false;
  const a = Buffer.from(k), b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
