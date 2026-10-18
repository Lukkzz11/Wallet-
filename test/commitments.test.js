import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as K from '../server/services/cards.js';
import * as P from '../server/services/planning.js';
import * as H from '../server/services/house.js';
import * as V from '../server/services/views.js';
import { cardsOverview } from '../server/core/cards.js';
import { consolidate } from '../server/core/finance.js';

const TODAY = '2026-10-15';
const snap = (db) => V.loadSnapshot(db);

function scenario() {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 1000000, ref_date: '2026-10-01' }).id;
  const nu = K.createCard(db, { name: 'Principal', bank: 'Nubank', due_day: 10 }).id;
  const pic = K.createCard(db, { name: 'Extra', bank: 'PicPay', due_day: 12 }).id;
  const p1 = K.createCardPurchase(db, { name: 'Notebook', card_id: nu, installment_amount: 15000, installments_total: 4, start_month: '2026-10' }, TODAY).id;
  K.createCardPurchase(db, { name: 'Fone', card_id: nu, installment_amount: 5000, installments_total: 2, start_month: '2026-10' }, TODAY);
  K.createCardPurchase(db, { name: 'Tênis', card_id: pic, installment_amount: 12000, installments_total: 1, start_month: '2026-10' }, TODAY);
  // paga a parcela de outubro do Notebook
  const e = get(db, 'SELECT id FROM entries WHERE debt_id=? ORDER BY due_date LIMIT 1', p1).id;
  L.payEntry(db, e, { account_id: acc, paid_date: '2026-10-10' });
  // assinaturas: Spotify já registrada (pendente em out), Netflix só prevista, anual fora do mês
  const spot = P.createSubscription(db, { name: 'Spotify', amount: 2190, period: 'monthly', next_date: '2026-10-03' }).id;
  P.chargeSubscription(db, spot, { mode: 'pending' });
  P.createSubscription(db, { name: 'Netflix', amount: 5590, period: 'monthly', next_date: '2026-10-20' });
  P.createSubscription(db, { name: 'Plano anual', amount: 24000, period: 'yearly', next_date: '2027-03-01' });
  // casa e outras contas
  H.createLoan(db, { total_months: 12, remaining_months: 6, payment: 100000, next_due: '2026-10-25' }, TODAY);
  L.createEntry(db, 'expense', { description: 'Internet', amount: 30000, due_date: '2026-10-28' }, TODAY);
  L.createEntry(db, 'expense', { description: 'Conta atrasada', amount: 7000, due_date: '2026-09-30' }, TODAY);
  return { db, acc };
}

test('cartões: total do mês, pagas, pendentes e parcelas dos meses seguintes (sem contar o mês atual)', () => {
  const { db } = scenario();
  const ov = cardsOverview(snap(db), TODAY, 12, { month: '2026-10' });
  assert.deepEqual([ov.selected.total, ov.selected.paid, ov.selected.pending], [15000 + 5000 + 12000, 15000, 5000 + 12000]);
  assert.deepEqual([ov.selected.paidCount, ov.selected.pendingCount], [1, 2]);
  // futuras = Notebook nov/dez/jan (3 x 15.000) + Fone nov (5.000)
  assert.equal(ov.totals.futureAmount, 45000 + 5000);
  assert.equal(ov.totals.futureCount, 4);
  const nu = ov.cards.find((c) => c.bank === 'Nubank');
  const pic = ov.cards.find((c) => c.bank === 'PicPay');
  assert.deepEqual([nu.monthTotal, nu.monthPaid, nu.monthPending], [20000, 15000, 5000]);
  assert.deepEqual([pic.monthTotal, pic.monthPaid, pic.monthPending], [12000, 0, 12000]);
  assert.equal(nu.monthly['2026-11'], 20000);
  assert.equal(pic.monthly['2026-11'], 0, 'parcela única não continua cobrando');
  assert.equal(ov.total['2026-11'], 20000);
  // marcar pendente de novo atualiza os totais; nada é contado duas vezes
  const paidEntry = nu.items.find((i) => i.status === 'paid').entry_id;
  L.unpayEntry(db, paidEntry);
  const ov2 = cardsOverview(snap(db), TODAY, 12, { month: '2026-10' });
  assert.deepEqual([ov2.selected.total, ov2.selected.paid, ov2.selected.pending], [32000, 0, 32000]);
  assert.equal(ov2.totals.futureAmount, 50000);
  assert.equal(ov2.total['2026-10'], 32000);
});

test('compromissos do mês: cartões + assinaturas (registradas e previstas) + casa + outras, sem duplicar', () => {
  const { db } = scenario();
  const c = V.monthCommitments(snap(db), '2026-10');
  assert.deepEqual([c.cards.total, c.cards.paid, c.cards.pending], [32000, 15000, 17000]);
  assert.equal(c.pendingInstallments, 2);
  assert.equal(c.paidInstallments, 1);
  // Spotify (registrada, 2.190) + Netflix (prevista, 5.590); o plano anual de 2027 não entra
  assert.deepEqual([c.subs.total, c.subs.pending, c.subsProjected], [7780, 7780, 5590]);
  assert.equal(c.house.total, 100000);
  assert.equal(c.other.total, 30000, 'a conta atrasada de setembro não é compromisso de outubro');
  assert.equal(c.total, 32000 + 7780 + 100000 + 30000);
  assert.equal(c.paid, 15000, 'só o que foi pago');
  assert.equal(c.pending, c.total - c.paid);
  // outubro registrado + previsto não repete em novembro: cada mês só traz o seu
  const nov = V.monthCommitments(snap(db), '2026-11');
  assert.equal(nov.cards.total, 20000);
  assert.equal(nov.subs.total, 2190 + 5590, 'Spotify e Netflix de novembro (previstas)');
  assert.equal(nov.house.total, 100000);
  assert.equal(nov.other.total, 0);
  // registrar a cobrança da Netflix troca "prevista" por despesa real, sem somar duas vezes
  const net = get(db, "SELECT id FROM subscriptions WHERE name='Netflix'").id;
  P.chargeSubscription(db, net, { mode: 'pending' });
  const again = V.monthCommitments(snap(db), '2026-10');
  assert.equal(again.subs.total, 7780);
  assert.equal(again.subsProjected, 0);
  assert.equal(again.total, c.total);
});

test('painel: previsões e compromissos não mexem no saldo; contas pendentes detalhadas somam o total', () => {
  const { db } = scenario();
  const before = consolidate(snap(db)).total;
  const d = V.dashboard(snap(db), TODAY, '2026-10');
  assert.equal(consolidate(snap(db)).total, before);
  assert.equal(d.totalBalance, 1000000 - 15000);
  const b = d.pending.breakdown;
  assert.equal(b.cards + b.subs + b.house + b.other, d.pending.amount);
  assert.equal(b.cards, 17000);
  assert.equal(b.subs, 2190);
  assert.equal(b.other, 30000 + 7000, 'inclui a conta atrasada (pendente até o fim do mês)');
  assert.equal(d.commitments.total, V.monthCommitments(snap(db), '2026-10').total);
});
