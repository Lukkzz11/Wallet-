import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get, all } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as X from '../server/services/connect.js';
import * as P from '../server/services/planning.js';
import * as V from '../server/services/views.js';
import { simulateInvestment, futureValue } from '../server/core/invest.js';
import * as K from '../server/services/cards.js';
import { consolidate } from '../server/core/finance.js';

const TODAY = '2026-10-14';
const snap = (db) => V.loadSnapshot(db);
const setup = (bal = 100000) => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Conta', type: 'conta', initial_balance: bal, ref_date: '2026-10-01' }).id;
  return { db, acc };
};

test('quanto tenho hoje: ajusta o saldo para o valor informado, preservando histórico', () => {
  const { db, acc } = setup(100000);
  L.createEntry(db, 'expense', { description: 'Mercado', amount: 20000, due_date: '2026-10-10', status: 'paid', paid_date: '2026-10-10', account_id: acc }, TODAY);
  assert.equal(consolidate(snap(db)).total, 80000);
  assert.equal(X.setBalance(db, acc, { balance: 150000 }, TODAY).delta, 70000);
  assert.equal(consolidate(snap(db)).total, 150000);
  assert.equal(X.setBalance(db, acc, { balance: 150000 }, TODAY).delta, 0);
  assert.equal(get(db, "SELECT COUNT(*) n FROM movements WHERE kind='manual'").n, 1);
});

test('importação: entradas/saídas viram lançamentos pagos e reimportar não duplica', () => {
  const { db, acc } = setup(100000);
  const items = [
    { date: '2026-10-12', description: 'Salário', amount: 300000 },
    { date: '2026-10-12', description: 'Café', amount: -900 },
    { date: '2026-10-12', description: 'Café', amount: -900 },
    { date: '2026-10-13', description: 'Pix', amount: -5000, id: 'abc' },
  ];
  assert.deepEqual(X.importTransactions(db, { account_id: acc, items }), { created: 4, skipped: 0 });
  assert.equal(consolidate(snap(db)).total, 100000 + 300000 - 1800 - 5000);
  assert.deepEqual(X.importTransactions(db, { account_id: acc, items }), { created: 0, skipped: 4 });
  assert.equal(consolidate(snap(db)).total, 100000 + 300000 - 1800 - 5000, 'saldo não muda ao reimportar');
  assert.throws(() => X.importTransactions(db, { account_id: acc, items: [{ date: '2026-10-12', description: 'x', amount: 12.5 }] }), /centavos/);
  assert.equal(all(db, 'SELECT * FROM movements').length, 4);
});

test('chave da API local: gerada, comparada em tempo constante', () => {
  const { db } = setup();
  assert.equal(X.getKey(db), null);
  assert.equal(X.keyMatches(db, 'qualquer'), false);
  const k = X.newKey(db);
  assert.match(k, /^wl_[0-9a-f]{48}$/);
  assert.equal(X.keyMatches(db, k), true);
  assert.equal(X.keyMatches(db, k + 'x'), false);
  assert.notEqual(X.newKey(db), k);
});

test('posso investir: respeita reserva mínima, aporte máximo e valor futuro sem inventar taxa', () => {
  const { db, acc } = setup(300000);
  P.updateSettings(db, { min_reserve: 100000 });
  L.createEntry(db, 'income', { description: 'Salário', amount: 400000, due_date: '2026-11-05', account_id: acc, recurrence: 'monthly', certain: 1 }, TODAY);
  L.createEntry(db, 'expense', { description: 'Aluguel', amount: 250000, due_date: '2026-11-10', account_id: acc, recurrence: 'monthly' }, TODAY);
  const ok = simulateInvestment(snap(db), TODAY, { lump: 50000, monthly: 20000, months: 12 });
  assert.equal(ok.verdict, 'pode');
  assert.ok(ok.maxMonthly >= 20000);
  const tooMuch = simulateInvestment(snap(db), TODAY, { lump: 250000, monthly: 0, months: 12 });
  assert.notEqual(tooMuch.verdict, 'pode');
  assert.ok(tooMuch.reasons.length > 0);
  const big = simulateInvestment(snap(db), TODAY, { lump: 0, monthly: ok.maxMonthly + 20000, months: 12 });
  assert.notEqual(big.verdict, 'pode', 'acima do máximo calculado não é seguro');
  assert.equal(ok.futureValue, 50000 + 20000 * 12, 'sem taxa: só a soma');
  assert.equal(futureValue(0, 10000, 12, 12) > 120000, true);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM reserve_movements').n, 0, 'simulação não grava');
});

test('gasto do dia: pago atualiza saldo; editar e excluir recalculam; casa fica separada e não marca pagas sozinha', () => {
  const { db, acc } = setup(100000);
  const cat = get(db, "SELECT id FROM categories WHERE name='Alimentação' AND kind='expense'").id;
  const id = L.createEntry(db, 'expense', { description: 'Almoço', amount: 3500, due_date: TODAY, status: 'paid', paid_date: TODAY, account_id: acc, category_id: cat }, TODAY).id;
  assert.equal(consolidate(snap(db)).total, 96500);
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').paid, 3500);
  L.updateEntry(db, id, { description: 'Almoço', amount: 5000, due_date: TODAY, paid_date: TODAY, account_id: acc, category_id: cat });
  assert.equal(consolidate(snap(db)).total, 95000);
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').paid, 5000);
  L.deleteEntry(db, id);
  assert.equal(consolidate(snap(db)).total, 100000);
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').paid, 0);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM movements').n, 0);

  // casa: 120 parcelas de 1.500, 10 já pagas -> 110 restantes, categoria Moradia, nada pago por conta própria
  const { id: debt } = L.createDebt(db, { description: 'Financiamento da casa', kind: 'casa', installment_amount: 150000, installments_total: 120, first_due_date: '2026-01-10', paid_installments: 10, account_id: acc });
  const d = get(db, 'SELECT * FROM debts WHERE id=?', debt);
  assert.equal(d.kind, 'casa');
  const ents = all(db, 'SELECT * FROM entries WHERE debt_id=? ORDER BY installment_no', debt);
  assert.equal(ents.filter((e) => e.status === 'paid').length, 10);
  assert.equal(ents.filter((e) => e.status === 'pending').length, 110);
  assert.equal(get(db, 'SELECT name FROM categories WHERE id=?', ents[0].category_id).name, 'Moradia');
  assert.equal(consolidate(snap(db)).total, 100000, 'parcelas já pagas antes do cadastro não mexem no saldo');
  const nova = ents.find((e) => e.status === 'pending');
  L.payEntry(db, nova.id, { account_id: acc, paid_date: TODAY });
  assert.equal(consolidate(snap(db)).total, 100000 - 150000);
});

test('importação com revisão: pré-verificação não grava; confirmada não duplica; cartão distribui as parcelas restantes', () => {
  const { db, acc } = setup(100000);
  const items = [
    { date: '2026-10-05', description: 'Mercado Central', amount: -4590, id: 'F1' },
    { date: '2026-10-06', description: 'Salário', amount: 300000, id: 'F2' },
    { date: '2026-10-07', description: 'Farmácia', amount: -2000 },
  ];
  // um lançamento manual parecido com a 3ª linha
  L.createEntry(db, 'expense', { description: 'FARMACIA', amount: 2000, due_date: '2026-10-07', status: 'paid', paid_date: '2026-10-07', account_id: acc }, TODAY);
  const before = consolidate(snap(db)).total;
  const chk = X.checkImport(db, { mode: 'account', account_id: acc, items });
  assert.deepEqual(chk.map((r) => r && r.kind), [null, null, 'similar']);
  assert.equal(consolidate(snap(db)).total, before, 'a pré-verificação não altera o saldo');
  assert.equal(all(db, 'SELECT * FROM entries').length, 1);
  // usuário revisou: importa só as duas primeiras, classificando a categoria
  const cat = get(db, "SELECT id FROM categories WHERE name='Alimentação' AND kind='expense'").id;
  const r = X.importTransactions(db, { account_id: acc, items: [{ ...items[0], category_id: cat }, items[1]] });
  assert.deepEqual(r, { created: 2, skipped: 0 });
  assert.equal(get(db, "SELECT category_id c FROM entries WHERE description='Mercado Central'").c, cat);
  assert.equal(consolidate(snap(db)).total, before - 4590 + 300000);
  // reimportar: o checador marca como 'id' e a gravação ignora
  assert.deepEqual(X.checkImport(db, { mode: 'account', account_id: acc, items }).map((r2) => r2 && r2.kind), ['id', 'id', 'similar']);
  assert.deepEqual(X.importTransactions(db, { account_id: acc, items: [items[0], items[1]] }), { created: 0, skipped: 2 });

  // cartão: 'LOJA 03/10' com 8 parcelas restantes (incluindo a desta fatura) e uma compra à vista (1 parcela)
  const card = K.createCard(db, { name: 'Cartão X', due_day: 10 }).id;
  const citems = [
    { date: '2026-10-03', description: 'LOJA ABC PARC 03/10', amount: -15000, remaining: 8, id: 'C1' },
    { date: '2026-10-04', description: 'Padaria', amount: -2500, remaining: 1 },
  ];
  const bal = consolidate(snap(db)).total;
  assert.deepEqual(X.checkImport(db, { mode: 'card', card_id: card, items: citems }).map((x) => x), [null, null]);
  const rc = X.importCardPurchases(db, { card_id: card, invoice_month: '2026-11', items: citems }, TODAY);
  assert.deepEqual(rc, { created: 2, skipped: 0 });
  assert.equal(consolidate(snap(db)).total, bal, 'importar compras de cartão não altera o saldo');
  const months = all(db, "SELECT substr(due_date,1,7) m, amount FROM entries WHERE description LIKE 'LOJA%' ORDER BY due_date");
  assert.equal(months.length, 8);
  assert.equal(months[0].m, '2026-11');
  assert.equal(months[7].m, '2027-06');
  assert.ok(months.every((x) => x.amount === 15000));
  // reimportar a fatura: ignora; e marca similar com o cadastro manual
  assert.deepEqual(X.importCardPurchases(db, { card_id: card, invoice_month: '2026-11', items: citems }, TODAY), { created: 0, skipped: 2 });
  assert.deepEqual(X.checkImport(db, { mode: 'card', card_id: card, items: citems }).map((x) => x.kind), ['id', 'id']);
  K.createCardPurchase(db, { name: 'Mercado do Zé', card_id: card, installment_amount: 9900, installments_total: 2, start_month: '2026-11' }, TODAY);
  assert.equal(X.checkImport(db, { mode: 'card', card_id: card, items: [{ date: '2026-10-09', description: 'MERCADO DO ZE', amount: -9900 }] })[0].kind, 'similar');
});
