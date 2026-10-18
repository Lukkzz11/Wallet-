import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb, get, all } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as K from '../server/services/cards.js';
import * as V from '../server/services/views.js';
import { cardsOverview, simulateCardPurchase, splitInstallments } from '../server/core/cards.js';
import { consolidate } from '../server/core/finance.js';
import { computeWithdrawal } from '../server/core/withdrawal.js';

const TODAY = '2026-10-14';
const setup = () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 500000, ref_date: '2026-10-01' }).id;
  const c1 = K.createCard(db, { name: 'Nubank', due_day: 10, account_id: acc }).id;
  const c2 = K.createCard(db, { name: 'Itaú', due_day: 5, account_id: acc }).id;
  return { db, acc, c1, c2 };
};
const snap = (db) => V.loadSnapshot(db);

test('cartões: compra com 3 de 10 pagas -> 7 restantes, termina em fev/27 e mês de alívio', () => {
  const { db, c1 } = setup();
  K.createCardPurchase(db, { name: 'Notebook', card_id: c1, installment_amount: 30000, installments_total: 10, paid: 3 }, TODAY);
  const ov = cardsOverview(snap(db), TODAY);
  const p = ov.cards.find((c) => c.id === c1).purchases[0];
  assert.equal(p.paid, 3);
  assert.equal(p.remaining, 7);
  assert.equal(p.startMonth, '2026-07');
  assert.equal(p.endMonth, '2027-04'); // jul + 9 meses
  assert.equal(p.next.due_date, '2026-10-10');
  assert.equal(ov.totals.currentMonth, 30000, 'parcela do mês atual conta uma vez');
  assert.equal(ov.total['2027-04'], 30000);
  assert.equal(ov.total['2027-05'] ?? 0, 0);
  assert.equal(ov.relief[0].month, '2027-05');
  assert.equal(ov.relief[0].amount, 30000);
  // nenhum saldo mudou: parcelas já pagas antes do cadastro não geram movimentação
  assert.equal(get(db, 'SELECT COUNT(*) n FROM movements').n, 0);
});

test('cartões: mês de término e início explícito, soma por cartão e total', () => {
  const { db, c1, c2 } = setup();
  K.createCardPurchase(db, { name: 'Celular', card_id: c1, installment_amount: 20000, end_month: '2026-12', paid: 0, start_month: '2026-10' }, TODAY);
  K.createCardPurchase(db, { name: 'Geladeira', card_id: c1, installment_amount: 15000, installments_total: 2, start_month: '2026-11' }, TODAY);
  K.createCardPurchase(db, { name: 'Tênis', card_id: c2, installment_amount: 10000, installments_total: 6, paid: 1 }, TODAY);
  const ov = cardsOverview(snap(db), TODAY);
  const m = (id, k) => ov.cards.find((c) => c.id === id).monthly[k];
  assert.equal(m(c1, '2026-10'), 20000);
  assert.equal(m(c1, '2026-11'), 35000);
  assert.equal(m(c1, '2026-12'), 35000);
  assert.equal(m(c1, '2027-01'), 0 + 0, 'Celular acabou em dez; Geladeira em dez (2 parcelas nov/dez)');
  assert.equal(ov.total['2026-11'], 35000 + 10000);
  const celular = ov.cards.find((c) => c.id === c1).purchases.find((p) => p.description === 'Celular');
  assert.equal(celular.total, 3);
  assert.equal(ov.relief.find((r) => r.month === '2027-01').amount, 35000);
  assert.throws(() => K.createCardPurchase(db, { name: 'x', card_id: c1, installment_amount: 100, end_month: '2026-01', start_month: '2026-10' }, TODAY), /anterior/);
  assert.throws(() => K.createCardPurchase(db, { name: 'x', card_id: c1, installment_amount: 100, installments_total: 3, paid: 5 }, TODAY), /pagas/);
});

test('cartões: pagar a parcela não duplica; parcelas não aparecem em duplicidade nas contas pendentes', () => {
  const { db, c1, acc } = setup();
  K.createCardPurchase(db, { name: 'TV', card_id: c1, installment_amount: 25000, installments_total: 4, paid: 1 }, TODAY);
  const e = get(db, "SELECT id FROM entries WHERE status='pending' ORDER BY due_date LIMIT 1").id;
  L.payEntry(db, e, { account_id: acc, paid_date: '2026-10-10' });
  assert.equal(consolidate(snap(db)).total, 475000);
  const ov = cardsOverview(snap(db), TODAY);
  assert.equal(ov.totals.currentMonth, 25000, 'parcela paga continua no total do mês, uma vez');
  assert.equal(ov.cards[0].purchases[0].remaining, 2);
  const d = V.dashboard(snap(db), TODAY, '2026-10');
  assert.equal(d.debts.owed, 50000);
});

test('simulador: soma ao que já se paga, compara parcelas e não grava nada', () => {
  const { db, c1, c2 } = setup();
  K.createCardPurchase(db, { name: 'Notebook', card_id: c1, installment_amount: 30000, installments_total: 4, start_month: '2026-10' }, TODAY);
  K.createCardPurchase(db, { name: 'Outro', card_id: c2, installment_amount: 10000, installments_total: 6, start_month: '2026-10' }, TODAY);
  const counts = () => ['entries', 'debts', 'movements', 'cards'].map((t) => get(db, `SELECT COUNT(*) n FROM ${t}`).n);
  const before = counts();
  const r = simulateCardPurchase(snap(db), TODAY, { card_id: c1, total: 120000, installments: 6, firstMonth: '2026-11' });
  assert.deepEqual(counts(), before, 'simulação é temporária');
  assert.equal(r.installment, 20000);
  assert.equal(r.cardCurrentMonth, 30000);
  assert.equal(r.cardBeforeFirstMonth, 30000);
  assert.equal(r.cardFirstMonth, 50000);
  assert.equal(r.allBeforeFirstMonth, 40000);
  assert.equal(r.allFirstMonth, 60000);
  const row = (k) => r.rows.find((x) => x.month === k);
  assert.equal(row('2027-01').cardBefore, 30000, 'Notebook 4x a partir de out: out, nov, dez, jan');
  assert.equal(row('2027-02').cardBefore, 0);
  assert.equal(row('2027-02').cardAfter, 20000, 'nova compra segue após o fim da antiga');
  assert.equal(row('2027-04').allAfter, 20000, 'após o fim das antigas só resta a nova (último mês: abr)');
  assert.equal(r.lastMonth, '2027-04');
  const n12 = r.comparison.find((c) => c.n === 12);
  assert.equal(n12.installment, 10000);
  assert.ok(r.comparison.find((c) => c.n === 1).cardFirstMonth > n12.cardFirstMonth);
  assert.equal(r.comparison.find((c) => c.n === 6).totalPaid, 120000);
  const juros = simulateCardPurchase(snap(db), TODAY, { card_id: c1, total: 120000, installments: 6, firstMonth: '2026-11', installment_amount: 21000 });
  assert.equal(juros.totalPaid, 126000);
});

test('simulador: divisão em centavos fecha o total', () => {
  assert.deepEqual(splitInstallments(10000, 3), [3334, 3333, 3333]);
  assert.equal(splitInstallments(99999, 7).reduce((a, b) => a + b, 0), 99999);
});

test('valores a receber: previsto não entra no saldo; confirmar entra uma única vez', () => {
  const { db, acc } = setup();
  const id = L.createEntry(db, 'income', { description: 'Projeto X', origin: 'Cliente Y', amount: 150000, due_date: '2026-12-20', certain: 1 }, TODAY).id;
  assert.equal(consolidate(snap(db)).total, 500000);
  assert.equal(computeWithdrawal(snap(db), TODAY, 30).scenarios.equilibrado.confirmedIncomeRaw, 0, 'receita fora do período não entra');
  L.payEntry(db, id, { account_id: acc, paid_date: '2026-12-20' });
  assert.equal(consolidate(snap(db)).total, 650000);
  assert.throws(() => L.payEntry(db, id, { account_id: acc, paid_date: '2026-12-20' }), /já foi contabilizado/);
  assert.equal(consolidate(snap(db)).total, 650000);
  assert.equal(all(db, 'SELECT * FROM movements WHERE entry_id=?', id).length, 1);
});

test('migração v1 -> v2 preserva os dados e cria cópia de segurança', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-mig-'));
  const file = path.join(dir, 'wallet.db');
  const db = openDb(file);
  L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 1234, ref_date: '2026-10-01' });
  db.exec('ALTER TABLE subscriptions DROP COLUMN end_date; ALTER TABLE subscriptions DROP COLUMN start_date; DROP TABLE house_loan_updates; DROP TABLE house_loans; DROP INDEX ux_entry_cardbase; ALTER TABLE entries DROP COLUMN card_id; DROP INDEX ux_entry_external; ALTER TABLE entries DROP COLUMN external_id; DROP TABLE cards; ALTER TABLE debts DROP COLUMN card_id; PRAGMA user_version = 1');
  db.close();
  const db2 = openDb(file);
  assert.equal(get(db2, 'SELECT initial_balance b FROM accounts').b, 1234);
  assert.equal(get(db2, 'PRAGMA user_version').user_version, 11);
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.startsWith('pre-migracao-v1')));
  db2.close();
  void DatabaseSync;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parcelas em andamento por mês: entram no total, na simulação e nas contas, sem duplicar', () => {
  const { db, c1, acc } = setup();
  const r = K.setCardBase(db, c1, { '2026-10': 80000, '2026-11': 80000, '2026-12': 50000, '2027-01': 0, '2026-09': 99999 }, TODAY);
  assert.equal(r.saved, 3);
  // regravar a mesma grade não duplica
  K.setCardBase(db, c1, { '2026-10': 80000, '2026-11': 80000, '2026-12': 50000 }, TODAY);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM entries WHERE card_id=?', c1).n, 3);
  let ov = cardsOverview(snap(db), TODAY);
  assert.equal(ov.totals.currentMonth, 80000);
  assert.equal(ov.total['2026-12'], 50000);
  assert.equal(ov.relief.length, 0, 'grade manual não gera "alívio" automático');
  assert.equal(ov.cards[0].yearBase.find((b) => b.month === '2026-12').amount, 50000);
  // compra nova registrada soma por cima, mês a mês
  K.createCardPurchase(db, { name: 'TV', card_id: c1, installment_amount: 20000, installments_total: 3, start_month: '2026-11' }, TODAY);
  ov = cardsOverview(snap(db), TODAY);
  assert.equal(ov.total['2026-11'], 100000);
  assert.equal(ov.total['2026-12'], 70000);
  assert.equal(ov.total['2027-01'], 20000);
  // simulação parte da grade
  const sim = simulateCardPurchase(snap(db), TODAY, { card_id: c1, total: 60000, installments: 3, firstMonth: '2026-12' });
  assert.equal(sim.cardBeforeFirstMonth, 70000);
  assert.equal(sim.cardFirstMonth, 90000);
  assert.equal(sim.cardCurrentMonth, 80000);
  // zerar remove; mês pago fica travado
  K.setCardBase(db, c1, { '2026-12': 0 }, TODAY);
  assert.equal(cardsOverview(snap(db), TODAY).cards[0].yearBase.find((b) => b.month === '2026-12').amount, 0);
  const cur = get(db, "SELECT id FROM entries WHERE card_id=? AND substr(due_date,1,7)='2026-10'", c1).id;
  L.payEntry(db, cur, { account_id: acc, paid_date: '2026-10-10' });
  const locked = K.setCardBase(db, c1, { '2026-10': 10000 }, TODAY);
  assert.deepEqual(locked.locked, ['2026-10']);
  assert.equal(cardsOverview(snap(db), TODAY).totals.currentMonth, 80000);
  assert.equal(consolidate(snap(db)).total, 420000);
  // entra nas contas a pagar (próximos 30 dias) e a mesma parcela não conta duas vezes
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').next30.amount, 80000 + 20000, 'nov 80.000 (grade, vence dia 10) + 20.000 da TV; out já pago');
});

test('limite do cartão: usado = parcelas pendentes + avulso; disponível e simulação', () => {
  const { db, c1 } = setup();
  K.updateCard(db, c1, { name: 'Nubank', due_day: 10, credit_limit: 500000, used_extra: 30000 });
  K.setCardBase(db, c1, { '2026-10': 80000, '2026-11': 80000, '2026-12': 50000 }, TODAY);
  K.createCardPurchase(db, { name: 'TV', card_id: c1, installment_amount: 20000, installments_total: 3, start_month: '2026-11' }, TODAY);
  let ov = cardsOverview(snap(db), TODAY, 12, { month: '2026-11' });
  const c = ov.cards[0];
  assert.equal(c.usage.installments, 80000 + 80000 + 50000 + 60000);
  assert.equal(c.usage.used, 270000 + 30000);
  assert.equal(c.usage.available, 200000);
  assert.equal(c.usage.pct, 60);
  assert.equal(ov.month, '2026-11');
  assert.deepEqual(c.items.map((i) => [i.kind, i.amount]), [['base', 80000], ['purchase', 20000]]);
  assert.equal(ov.selected.total, 100000);
  // pagar uma parcela libera limite
  const nov = get(db, "SELECT id FROM entries WHERE card_id=? AND substr(due_date,1,7)='2026-10'", c1).id;
  L.payEntry(db, nov, { account_id: 1, paid_date: '2026-10-10' });
  ov = cardsOverview(snap(db), TODAY);
  assert.equal(ov.cards[0].usage.available, 280000);
  // simulação avisa se a compra excede o limite
  const ok = simulateCardPurchase(snap(db), TODAY, { card_id: c1, total: 100000, installments: 5 });
  assert.equal(ok.limit.exceeds, false);
  assert.equal(ok.limit.availableAfter, 180000);
  const big = simulateCardPurchase(snap(db), TODAY, { card_id: c1, total: 300000, installments: 5 });
  assert.equal(big.limit.exceeds, true);
  assert.equal(ov.cards[0].yearBase.length, 12);
});

test('compra parcelada: total da compra separado da parcela, restante e término calculados, nada pago sozinho', () => {
  const { db, c1 } = setup();
  const { id } = K.createCardPurchase(db, { name: 'Sofá', card_id: c1, installment_amount: 25000, installments_total: 6, total_amount: 160000, paid: 2, start_month: '2026-08' }, TODAY);
  const debt = get(db, 'SELECT * FROM debts WHERE id=?', id);
  assert.equal(debt.total_amount, 160000);
  assert.equal(debt.installment_amount, 25000);
  const p = cardsOverview(snap(db), TODAY).cards[0].purchases[0];
  assert.equal(p.paid, 2);
  assert.equal(p.remaining, 4);
  assert.equal(p.remainingAmount, 100000);
  assert.equal(p.totalAmount, 160000);
  assert.equal(p.startMonth, '2026-08');
  assert.equal(p.endMonth, '2027-01');
  const noPaid = K.createCardPurchase(db, { name: 'Mesa', card_id: c1, installment_amount: 10000, installments_total: 3, start_month: '2026-10' }, TODAY);
  assert.equal(get(db, "SELECT COUNT(*) n FROM entries WHERE debt_id=? AND status='paid'", noPaid.id).n, 0);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM entries WHERE debt_id=?', id).n, 6, 'sem parcelas duplicadas');
});

test('cartão visual: instituição, bandeira, final e cor validados; exemplo R$150 x 4 a partir de novembro', () => {
  const { db, acc } = setup();
  const id = K.createCard(db, { name: 'Viagens', bank: 'Banco X', brand: 'Visa', last4: '1234', color: '#14532d', credit_limit: 300000 }).id;
  const c = get(db, 'SELECT * FROM cards WHERE id=?', id);
  assert.deepEqual([c.bank, c.brand, c.last4, c.color], ['Banco X', 'Visa', '1234', '#14532d']);
  assert.throws(() => K.createCard(db, { name: 'x', last4: '12' }), /4 dígitos/);
  assert.throws(() => K.createCard(db, { name: 'x', color: 'azul' }), /Cor inválida/);
  K.createCardPurchase(db, { name: 'Geladeira', card_id: id, installment_amount: 15000, installments_total: 4, start_month: '2026-11' }, TODAY);
  const ov = cardsOverview(snap(db), TODAY, 12);
  const card = ov.cards.find((x) => x.id === id);
  assert.deepEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'].map((m) => card.monthly[m]), [15000, 15000, 15000, 15000, 0]);
  assert.equal(card.monthly['2026-10'], 0);
  assert.equal(card.pendingCount, 4);
  assert.equal(card.pendingAmount, 60000);
  assert.equal(ov.totals.pendingAmount, 60000);
  assert.equal(card.breakdown['2026-12'][0].description, 'Geladeira');
  // pagar a de novembro: status próprio, histórico de pagamentos, sem duplicar, e some dos pendentes
  const nov = get(db, "SELECT id FROM entries WHERE substr(due_date,1,7)='2026-11' AND debt_id IS NOT NULL").id;
  L.payEntry(db, nov, { account_id: acc, paid_date: '2026-11-10' });
  const after = cardsOverview(snap(db), TODAY, 12).cards.find((x) => x.id === id);
  assert.equal(after.payments.length, 1);
  assert.equal(after.payments[0].paid_date, '2026-11-10');
  assert.equal(after.pendingCount, 3);
  assert.equal(after.monthly['2026-11'], 15000, 'o mês continua com o valor, agora como paga');
  assert.equal(get(db, 'SELECT COUNT(*) n FROM entries WHERE debt_id IS NOT NULL').n, 4);
});
