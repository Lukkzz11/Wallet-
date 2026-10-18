import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get, all } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as K from '../server/services/cards.js';
import * as P from '../server/services/planning.js';
import * as V from '../server/services/views.js';
import { cardsOverview, simulateCardPurchase } from '../server/core/cards.js';
import { subscriptionsInRange } from '../server/core/finance.js';

const TODAY = '2026-10-15';
const snap = (db) => V.loadSnapshot(db);
const setup = () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 1000000, ref_date: '2026-10-01' }).id;
  return { db, acc };
};
const subsIn = (db, m) => V.monthCommitments(snap(db), m).subs.total;

test('assinatura mensal de R$ 50 com data final entra em todos os meses até o fim; alterar a data recalcula', () => {
  const { db } = setup();
  const id = P.createSubscription(db, { name: 'Streaming', amount: 5000, period: 'monthly', next_date: '2026-11-05', end_date: '2027-02-05' }).id;
  assert.deepEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((m) => subsIn(db, m)), [0, 5000, 5000, 5000, 5000, 0]);
  assert.equal(get(db, 'SELECT start_date s FROM subscriptions').s, '2026-11-05', 'início padrão = 1ª cobrança');
  // encurta a data final: meses futuros recalculados
  P.updateSubscription(db, id, { name: 'Streaming', amount: 5000, period: 'monthly', next_date: '2026-11-05', end_date: '2026-12-05', start_date: '2026-11-05' });
  assert.deepEqual(['2026-12', '2027-01', '2027-02'].map((m) => subsIn(db, m)), [5000, 0, 0]);
  // cobrança contínua: sem data final
  P.updateSubscription(db, id, { name: 'Streaming', amount: 6000, period: 'monthly', next_date: '2026-11-05', continuous: true, start_date: '2026-11-05' });
  assert.equal(get(db, 'SELECT end_date e FROM subscriptions').e, null);
  assert.deepEqual(['2027-06', '2028-01'].map((m) => subsIn(db, m)), [6000, 6000], 'valor alterado vale para os meses futuros');
  assert.throws(() => P.createSubscription(db, { name: 'x', amount: 100, period: 'monthly', next_date: '2026-11-05', start_date: '2026-11-05', end_date: '2026-10-01' }), /data final/);
});

test('assinatura: registrar cobrança não duplica; histórico é preservado ao encerrar ou pausar', () => {
  const { db, acc } = setup();
  const id = P.createSubscription(db, { name: 'App', amount: 2000, period: 'monthly', next_date: '2026-11-05', end_date: '2027-01-05', account_id: acc }).id;
  P.chargeSubscription(db, id, { mode: 'pending' });
  assert.equal(subsIn(db, '2026-11'), 2000, 'cobrança registrada substitui a prevista, sem somar duas vezes');
  const e = get(db, "SELECT id FROM entries WHERE subscription_id=? AND due_date='2026-11-05'", id).id;
  L.payEntry(db, e, { account_id: acc, paid_date: '2026-11-05' });
  const c = V.monthCommitments(snap(db), '2026-11');
  assert.deepEqual([c.subs.total, c.subs.paid, c.subs.pending], [2000, 2000, 0]);
  assert.deepEqual(subscriptionsInRange(snap(db), '2026-11-01', '2026-11-30'), { total: 2000, paid: 2000, pending: 0, projected: 0 });
  // encerrar agora: dezembro e janeiro somem; novembro (já pago) permanece
  P.updateSubscription(db, id, { name: 'App', amount: 2000, period: 'monthly', next_date: '2026-12-05', end_date: '2026-11-30', start_date: '2026-11-05' });
  assert.equal(subsIn(db, '2026-11'), 2000);
  assert.deepEqual(['2026-12', '2027-01'].map((m) => subsIn(db, m)), [0, 0]);
  assert.throws(() => P.chargeSubscription(db, id, { mode: 'pending' }), /terminou/);
  const view = V.subscriptionsView(snap(db), TODAY);
  assert.equal(view.items[0].ended, true);
  assert.equal(view.totals.activeCount, 0);
  assert.equal(view.items[0].history.length, 1, 'histórico preservado');
  // pausar: sem previsões, histórico intacto
  P.updateSubscription(db, id, { name: 'App', amount: 2000, period: 'monthly', next_date: '2026-12-05', continuous: true, status: 'paused', start_date: '2026-11-05' });
  assert.equal(subsIn(db, '2027-03'), 0);
  assert.equal(all(db, 'SELECT * FROM entries WHERE subscription_id=?', id).length, 1);
});

test('faturas por cartão: pagamento parcial não vira fatura paga; futuras por cartão; vencimentos', () => {
  const { db, acc } = setup();
  const c1 = K.createCard(db, { name: 'Principal', bank: 'Nubank', due_day: 10 }).id;
  K.createCardPurchase(db, { name: 'A', card_id: c1, installment_amount: 10000, installments_total: 3, start_month: '2026-10' }, TODAY);
  K.createCardPurchase(db, { name: 'B', card_id: c1, installment_amount: 5000, installments_total: 2, start_month: '2026-10' }, TODAY);
  const a = get(db, "SELECT e.id FROM entries e JOIN debts d ON d.id=e.debt_id WHERE d.description='A' ORDER BY e.due_date LIMIT 1").id;
  L.payEntry(db, a, { account_id: acc, paid_date: '2026-10-10' });
  const card = cardsOverview(snap(db), TODAY, 12).cards[0];
  const oct = card.invoices.find((i) => i.month === '2026-10');
  assert.deepEqual([oct.total, oct.paid, oct.pending, oct.status, oct.due_date], [15000, 10000, 5000, 'parcial', '2026-10-10']);
  const nov = card.invoices.find((i) => i.month === '2026-11');
  assert.equal(nov.status, 'pendente');
  assert.equal(card.invoices.find((i) => i.month === '2026-12').total, 10000);
  assert.equal(card.futureAmount, 10000 + 5000 + 10000, 'nov: A+B, dez: A (exclui o mês atual)');
  assert.equal(card.futureCount, 3);
  assert.equal(card.invoices.some((i) => i.month === '2027-01'), false, 'sem fatura depois do término');
});

test('simulador: planilha mensal por cartão, assinaturas separadas e nova compra só como simulação', () => {
  const { db } = setup();
  const nu = K.createCard(db, { name: 'Principal', bank: 'Nubank' }).id;
  const pic = K.createCard(db, { name: 'Extra', bank: 'PicPay' }).id;
  K.createCardPurchase(db, { name: 'Antiga', card_id: nu, installment_amount: 20000, installments_total: 2, start_month: '2026-10' }, TODAY);
  K.createCardPurchase(db, { name: 'Outra', card_id: pic, installment_amount: 7000, installments_total: 3, start_month: '2026-10' }, TODAY);
  P.createSubscription(db, { name: 'Streaming', amount: 5000, period: 'monthly', next_date: '2026-10-20', end_date: '2026-12-20' });
  const counts = () => ['entries', 'debts', 'cards', 'subscriptions'].map((t) => get(db, `SELECT COUNT(*) n FROM ${t}`).n);
  const before = counts();
  const r = simulateCardPurchase(snap(db), TODAY, { card_id: nu, total: 90000, installments: 3, firstMonth: '2026-11' });
  assert.deepEqual(counts(), before, 'nada é gravado');
  assert.equal(r.table[0].month, '2026-10');
  assert.equal(r.table.at(-1).month, '2027-01', 'vai até a última parcela relevante (nova compra termina em jan)');
  const m = (k) => r.table.find((x) => x.month === k);
  assert.deepEqual(m('2026-11').cards.map((c) => [c.name, c.committed, c.extra, c.projected]), [['Nubank', 20000, 30000, 50000], ['PicPay', 7000, 0, 7000]]);
  assert.equal(m('2026-11').subs, 5000);
  assert.equal(m('2026-11').total, 27000 + 30000 + 5000, 'cartões + nova compra + assinaturas, cada um uma vez');
  assert.equal(m('2027-01').subs, 0, 'assinatura terminou em dez');
  assert.equal(m('2027-01').total, 30000);
  assert.equal(m('2026-10').extra, 0);
  // um cartão específico
  const one = simulateCardPurchase(snap(db), TODAY, { card_id: nu, total: 90000, installments: 3, firstMonth: '2026-11', showAll: false });
  assert.equal(one.table[1].cards.length, 1);
  assert.equal(one.table[1].total, 20000 + 30000 + 5000);
});
