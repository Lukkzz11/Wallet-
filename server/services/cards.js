// Cartões e compras parceladas (dívidas ligadas a um cartão).
import { get, all, run, tx } from '../db.js';
import { bad, notFound, conflict, str, cents, int, nowIso } from '../util.js';
import { addMonthKey, monthOf, daysInMonth } from '../core/dates.js';
import { createDebt, insertEntry, regeneratePending } from './ledger.js';

const cardInput = (b) => ({
  name: str(b.name, { name: 'Nome do cartão', required: true, max: 60 }),
  due_day: int(b.due_day ?? 10, { name: 'Dia de vencimento', min: 1, max: 28 }),
  account_id: b.account_id ? int(b.account_id, { min: 1 }) : null,
  notes: str(b.notes, { max: 300 }),
  archived: b.archived ? 1 : 0,
  credit_limit: cents(b.credit_limit ?? 0, { name: 'Limite', positive: false }),
  bank: str(b.bank, { name: 'Instituição', max: 40 }),
  brand: str(b.brand, { name: 'Bandeira', max: 20 }),
  last4: (() => { const v = str(b.last4, { name: 'Últimos dígitos', max: 4 }); if (v && !/^\d{4}$/.test(v)) throw bad('Informe exatamente 4 dígitos (ou deixe em branco).'); return v; })(),
  color: (() => { const v = str(b.color, { name: 'Cor', max: 7 }); if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) throw bad('Cor inválida.'); return v; })(),
  used_extra: cents(b.used_extra ?? 0, { name: 'Outros gastos na fatura', positive: false }),
});
export function createCard(db, b) {
  const c = cardInput(b);
  return { id: Number(run(db, 'INSERT INTO cards(name,due_day,account_id,notes,archived,credit_limit,used_extra,bank,brand,last4,color,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', c.name, c.due_day, c.account_id, c.notes, c.archived, c.credit_limit, c.used_extra, c.bank, c.brand, c.last4, c.color, nowIso()).lastInsertRowid) };
}
export function updateCard(db, id, b) {
  if (!get(db, 'SELECT id FROM cards WHERE id=?', id)) throw notFound();
  const c = cardInput(b);
  run(db, 'UPDATE cards SET name=?,due_day=?,account_id=?,notes=?,archived=?,credit_limit=?,used_extra=?,bank=?,brand=?,last4=?,color=? WHERE id=?', c.name, c.due_day, c.account_id, c.notes, c.archived, c.credit_limit, c.used_extra, c.bank, c.brand, c.last4, c.color, id);
}
export function deleteCard(db, id) {
  if (get(db, 'SELECT (SELECT COUNT(*) FROM debts WHERE card_id=?) + (SELECT COUNT(*) FROM entries WHERE card_id=?) n', id, id).n) throw conflict('Este cartão tem compras cadastradas. Exclua as compras antes, ou arquive o cartão.');
  run(db, 'DELETE FROM cards WHERE id=?', id);
}

const monthsBetween = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
const isMonth = (m) => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

// Registra uma compra parcelada já existente (ou confirmada a partir do simulador).
// Início: informado (start_month) ou deduzido para que a próxima parcela pendente caia no mês atual.
export function createCardPurchase(db, b, today) {
  const card = get(db, 'SELECT * FROM cards WHERE id=?', int(b.card_id, { name: 'Cartão', min: 1 }));
  if (!card) throw notFound('Cartão não encontrado.');
  const paid = int(b.paid ?? 0, { name: 'Parcelas pagas', min: 0, max: 480 });
  const cur = monthOf(today);
  const start = b.start_month ? (isMonth(b.start_month) ? b.start_month : (() => { throw bad('Mês de início inválido.'); })()) : addMonthKey(cur, -paid);
  let n;
  if (b.installments_total) n = int(b.installments_total, { name: 'Quantidade de parcelas', min: 1, max: 480 });
  else if (b.end_month) {
    if (!isMonth(b.end_month)) throw bad('Mês de término inválido.');
    n = monthsBetween(start, b.end_month) + 1;
    if (n < 1) throw bad('O mês de término é anterior ao início.');
  } else throw bad('Informe a quantidade de parcelas ou o mês em que termina.');
  if (paid > n) throw bad('As parcelas pagas não podem passar do total.');
  const catId = get(db, "SELECT id FROM categories WHERE kind='expense' AND name='Compras pessoais'")?.id ?? null;
  return createDebt(db, {
    description: str(b.name, { name: 'Nome da compra', required: true, max: 120 }), creditor: card.name, kind: 'compra',
    installment_amount: cents(b.installment_amount, { name: 'Valor da parcela' }), installments_total: n, total_amount: b.total_amount ? cents(b.total_amount, { name: 'Valor total' }) : undefined,
    first_due_date: `${start}-${String(Math.min(card.due_day, daysInMonth(Number(start.slice(0, 4)), Number(start.slice(5)))) ).padStart(2, '0')}`,
    paid_installments: paid, account_id: card.account_id, category_id: catId, card_id: card.id, payment_method: 'Cartão de crédito', notes: str(b.notes, { max: 500 }),
  });
}
export { all, tx };

// Parcelas que o usuário já paga em cada cartão, informadas por mês: {'2026-11': 80000, ...}.
// Cada mês vira UMA despesa pendente (índice único cartão+mês): editar atualiza, 0 remove, mês já pago não é alterado.
export function setCardBase(db, cardId, months, today) {
  const card = get(db, 'SELECT * FROM cards WHERE id=?', cardId);
  if (!card) throw notFound('Cartão não encontrado.');
  if (!months || typeof months !== 'object') throw bad('Informe os valores por mês.');
  const cur = monthOf(today);
  const catId = get(db, "SELECT id FROM categories WHERE kind='expense' AND name='Compras pessoais'")?.id ?? null;
  const result = { saved: 0, removed: 0, locked: [] };
  tx(db, () => {
    for (const [m, raw] of Object.entries(months)) {
      if (!isMonth(m)) throw bad(`Mês inválido: ${m}.`);
      if (m < cur) continue;
      const amount = Number(raw) || 0;
      if (!Number.isSafeInteger(amount) || amount < 0) throw bad('Valor inválido.');
      const row = get(db, 'SELECT * FROM entries WHERE card_id=? AND debt_id IS NULL AND substr(due_date,1,7)=?', cardId, m);
      if (row?.status === 'paid') { if (row.amount !== amount) result.locked.push(m); continue; }
      if (!amount) { if (row) { run(db, 'DELETE FROM entries WHERE id=?', row.id); result.removed++; } continue; }
      if (row) { if (row.amount !== amount) run(db, 'UPDATE entries SET amount=? WHERE id=?', amount, row.id); result.saved++; continue; }
      const id = insertEntry(db, {
        type: 'expense', description: `Parcelas em andamento — ${card.name}`, amount, due_date: `${m}-${String(card.due_day).padStart(2, '0')}`,
        status: 'pending', category_id: catId, account_id: card.account_id, payment_method: 'Cartão de crédito', nature: 'fixa', origin: card.name,
      });
      run(db, 'UPDATE entries SET card_id=? WHERE id=?', cardId, id);
      result.saved++;
    }
  });
  return result;
}

// Edita uma compra de cartão: descrição, valor da parcela, quantas parcelas faltam e mês da próxima parcela.
// As parcelas já pagas são preservadas; só as pendentes são refeitas.
export function updateCardPurchase(db, id, b) {
  const d = get(db, 'SELECT * FROM debts WHERE id=? AND card_id IS NOT NULL', id);
  if (!d) throw notFound('Compra não encontrada.');
  const card = get(db, 'SELECT * FROM cards WHERE id=?', d.card_id);
  if (!isMonth(b.next_month)) throw bad('Informe o mês da próxima parcela.');
  const dim = daysInMonth(Number(b.next_month.slice(0, 4)), Number(b.next_month.slice(5)));
  regeneratePending(db, id, {
    description: b.description, amount: b.installment_amount, remaining: b.remaining,
    firstDue: `${b.next_month}-${String(Math.min(card.due_day, dim)).padStart(2, '0')}`,
  });
}
