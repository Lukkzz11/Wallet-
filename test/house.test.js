import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, get, all } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as K from '../server/services/cards.js';
import * as H from '../server/services/house.js';
import * as V from '../server/services/views.js';
import { cardsOverview } from '../server/core/cards.js';
import { consolidate } from '../server/core/finance.js';

const TODAY = '2026-10-15';
const snap = (db) => V.loadSnapshot(db);
const setup = () => {
  const db = openDb(':memory:');
  const acc = L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 1000000, ref_date: '2026-10-01' }).id;
  return { db, acc };
};

test('financiamento da casa: campos informados, parcelas restantes geradas, pagas sem mexer no saldo', () => {
  const { db } = setup();
  const { id } = H.createLoan(db, { financed: 25000000, balance: 21000000, total_months: 360, remaining_months: 300, nominal_rate: 9.5, payment: 220000, next_due: '2026-11-05' }, TODAY);
  const [loan] = H.listLoans(db);
  assert.equal(loan.id, id);
  assert.equal(loan.balance, 21000000);
  assert.equal(loan.financed, 25000000);
  assert.equal(loan.nominal_rate, 9.5);
  assert.equal(loan.remaining_months, 300);
  assert.equal(loan.paid_months, 60);
  assert.equal(loan.next_due, '2026-11-05');
  assert.equal(loan.end_date, '2051-10-05');
  assert.equal(loan.remaining_sum, 300 * 220000);
  assert.equal(loan.remaining_vs_balance, 300 * 220000 - 21000000, 'estimativa rotulada, não é o saldo');
  assert.equal(loan.amortized_pct, 16);
  assert.equal(consolidate(snap(db)).total, 1000000, 'parcelas já pagas antes do cadastro não alteram saldo');
  assert.equal(get(db, 'SELECT kind FROM debts').kind, 'casa');
  assert.equal(all(db, "SELECT * FROM entries WHERE status='pending'").length, 300);
});

test('financiamento: atualizar depois de pagar mantém pagas, refaz pendentes e guarda histórico, sem duplicar', () => {
  const { db, acc } = setup();
  const { id } = H.createLoan(db, { balance: 5000000, total_months: 12, remaining_months: 12, payment: 100000, next_due: '2026-10-20' }, TODAY);
  const first = get(db, "SELECT id FROM entries WHERE status='pending' ORDER BY due_date LIMIT 1").id;
  L.payEntry(db, first, { account_id: acc, paid_date: '2026-10-20' });
  assert.equal(consolidate(snap(db)).total, 900000);
  assert.equal(H.listLoans(db)[0].paid_since_update, 1);
  H.updateLoan(db, id, { balance: 4800000, remaining_months: 11, payment: 98000, next_due: '2026-11-20', nominal_rate: 8.9, note: 'Extrato de novembro' }, '2026-11-01');
  const l = H.listLoans(db)[0];
  assert.equal(l.paid_months, 1);
  assert.equal(l.remaining_months, 11);
  assert.equal(l.payment, 98000);
  assert.equal(l.balance, 4800000);
  assert.equal(l.paid_since_update, 0);
  assert.equal(l.history.length, 2);
  assert.equal(all(db, 'SELECT * FROM entries').length, 12, 'sem parcelas duplicadas');
  assert.equal(get(db, "SELECT MIN(installment_no) m FROM entries WHERE status='pending'").m, 2);
  assert.equal(consolidate(snap(db)).total, 900000, 'atualizar não mexe no saldo das contas');
  assert.throws(() => H.createLoan(db, { remaining_months: 20, total_months: 10, payment: 1, next_due: '2026-11-01' }, TODAY), /passar do prazo/);
});

test('compra de cartão rápida: parcelas que faltam + mês da próxima; totais por cartão e geral; editar e excluir', () => {
  const { db, acc } = setup();
  const c1 = K.createCard(db, { name: 'Nubank', due_day: 10 }).id;
  const c2 = K.createCard(db, { name: 'Itaú', due_day: 5 }).id;
  K.createCardPurchase(db, { name: 'Tênis', card_id: c1, installment_amount: 10000, installments_total: 3, start_month: '2026-10' }, TODAY);
  K.createCardPurchase(db, { name: 'Celular', card_id: c1, installment_amount: 25000, installments_total: 5, start_month: '2026-11' }, TODAY);
  K.createCardPurchase(db, { name: 'TV', card_id: c2, installment_amount: 40000, installments_total: 2, start_month: '2026-10', total_amount: 150000 }, TODAY);
  let ov = cardsOverview(snap(db), TODAY, 12);
  const m = (id, k) => ov.cards.find((c) => c.id === id).monthly[k];
  assert.equal(m(c1, '2026-10'), 10000);
  assert.equal(m(c1, '2026-11'), 35000);
  assert.equal(m(c1, '2026-12'), 35000);
  assert.equal(m(c1, '2027-01'), 25000);
  assert.equal(m(c1, '2027-03'), 25000);
  assert.equal(m(c1, '2027-04'), 0);
  assert.equal(m(c2, '2026-11'), 40000);
  assert.equal(m(c2, '2026-12'), 0);
  assert.equal(ov.total['2026-10'], 50000);
  assert.equal(ov.total['2026-11'], 75000);
  assert.equal(ov.total['2026-12'], 35000);
  const tenis = ov.cards[0].purchases.find((p) => p.description === 'Tênis');
  assert.equal(tenis.remaining, 3);
  assert.equal(tenis.endMonth, '2026-12');
  assert.equal(ov.upcoming.length, 8);
  assert.equal(ov.upcoming[0].due_date, '2026-10-05');

  // editar: Celular passa a faltar 3 parcelas de 20.000 começando em dez
  const cel = ov.cards[0].purchases.find((p) => p.description === 'Celular').id;
  K.updateCardPurchase(db, cel, { description: 'Celular novo', installment_amount: 20000, remaining: 3, next_month: '2026-12' });
  ov = cardsOverview(snap(db), TODAY, 12);
  assert.equal(ov.cards[0].monthly['2026-11'], 10000);
  assert.equal(ov.cards[0].monthly['2026-12'], 30000);
  assert.equal(ov.cards[0].monthly['2027-02'], 20000);
  assert.equal(ov.cards[0].monthly['2027-03'], 0);
  assert.equal(all(db, 'SELECT * FROM entries WHERE debt_id=?', cel).length, 3);

  // pagar uma parcela não duplica nem muda o total do mês
  const it = ov.cards[0].items[0];
  L.payEntry(db, it.entry_id, { account_id: acc, paid_date: '2026-10-10' });
  assert.equal(cardsOverview(snap(db), TODAY).total['2026-10'], 50000);
  // editar depois de pagar preserva a parcela paga
  const tenisId = get(db, "SELECT id FROM debts WHERE description='Tênis'").id;
  K.updateCardPurchase(db, tenisId, { description: 'Tênis', installment_amount: 10000, remaining: 1, next_month: '2026-11' });
  const t2 = all(db, 'SELECT * FROM entries WHERE debt_id=? ORDER BY installment_no', tenisId);
  assert.deepEqual(t2.map((e) => [e.installment_no, e.status]), [[1, 'paid'], [2, 'pending']]);
  // compra com parcela paga (com movimentação) não pode ser apagada; sem pagamento, pode
  assert.throws(() => L.deleteDebt(db, tenisId), /movimentação/);
  L.deleteDebt(db, ov.cards[1].purchases[0].id);
  assert.equal(cardsOverview(snap(db), TODAY).total['2026-11'], 10000 + 0);
  // painel: pendentes detalhadas somam o total (sem soma dupla)
  const d = V.dashboard(snap(db), TODAY, '2026-10');
  assert.equal(d.pending.breakdown.cards + d.pending.breakdown.house + d.pending.breakdown.other, d.pending.amount);
});

test('parcelas quitadas antes do cadastro não contam como gasto do mês; ao pagar de verdade, contam', () => {
  const { db, acc } = setup();
  H.createLoan(db, { total_months: 12, remaining_months: 6, payment: 100000, next_due: '2026-11-05' }, TODAY);
  // última parcela "paga antes" tem paid_date = vencimento (2026-10-05, mês atual)
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').paid, 0);
  assert.equal(all(db, "SELECT * FROM entries WHERE external_id LIKE 'prepaid:%'").length, 6);
  const e = get(db, "SELECT id FROM entries WHERE status='paid' ORDER BY due_date DESC LIMIT 1").id;
  L.unpayEntry(db, e);
  L.payEntry(db, e, { account_id: acc, paid_date: '2026-10-12' });
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').paid, 100000);
  assert.equal(get(db, 'SELECT external_id FROM entries WHERE id=?', e).external_id, null);
});

test('visão anual: realizado separado do previsto; previsão não entra no saldo; parcelas encerradas somem', () => {
  const { db, acc } = setup();
  const c1 = K.createCard(db, { name: 'Cartão', due_day: 10 }).id;
  L.createEntry(db, 'income', { description: 'Salário', amount: 300000, due_date: '2026-10-05', status: 'paid', paid_date: '2026-10-05', account_id: acc }, TODAY);
  L.createEntry(db, 'income', { description: 'Freela', amount: 80000, due_date: '2026-12-10', certain: 0 }, TODAY);
  L.createEntry(db, 'expense', { description: 'Mercado', amount: 20000, due_date: '2026-10-08', status: 'paid', paid_date: '2026-10-08', account_id: acc }, TODAY);
  K.createCardPurchase(db, { name: 'TV', card_id: c1, installment_amount: 15000, installments_total: 3, start_month: '2026-11' }, TODAY);
  H.createLoan(db, { total_months: 12, remaining_months: 4, payment: 100000, next_due: '2026-11-05' }, TODAY);
  const a = V.annual(snap(db), TODAY, 2026);
  const m = (k) => a.rows.find((r) => r.month === k);
  assert.equal(m('2026-10').received, 300000);
  assert.equal(m('2026-10').paid, 20000, 'parcelas da casa quitadas antes do cadastro não entram');
  assert.equal(m('2026-10').balance, 1000000 + 300000 - 20000);
  assert.equal(m('2026-11').balance, null, 'mês futuro não tem saldo real');
  assert.equal(m('2026-11').toPay, 15000 + 100000);
  assert.deepEqual(m('2026-11').toPaySplit, { cards: 15000, house: 100000, other: 0 });
  assert.equal(m('2026-12').toReceive, 80000);
  assert.equal(m('2026-12').toReceiveSure, 0);
  assert.equal(m('2027-01') === undefined, true);
  assert.equal(a.totals.received, 300000, 'previsto não é recebido');
  assert.equal(a.balanceNow, 1000000 + 300000 - 20000, 'previsões não entram no saldo atual');
  const next = V.annual(snap(db), TODAY, 2027);
  assert.equal(next.rows.find((r) => r.month === '2027-01').toPay, 115000, 'casa (4 parcelas: nov a fev) + última parcela da TV');
  assert.equal(next.rows.find((r) => r.month === '2027-02').toPay, 100000);
  assert.equal(next.rows.find((r) => r.month === '2027-03').toPay, 0, 'parcelas desaparecem depois do término');
  assert.equal(next.rows.find((r) => r.month === '2027-02').toPaySplit.cards, 0, 'TV terminou em janeiro');
});

test('"já estava paga": marca a parcela como paga sem mexer no saldo nem nos gastos do mês; desfazer volta a pendente', () => {
  const { db, acc } = setup();
  H.createLoan(db, { total_months: 12, remaining_months: 6, payment: 100000, next_due: '2026-10-11' }, TODAY);
  const p = get(db, "SELECT id FROM entries WHERE status='pending' ORDER BY due_date LIMIT 1").id;
  const bal = consolidate(snap(db)).total;
  L.markPrepaid(db, p, { paid_date: '2026-10-11' });
  const e = get(db, 'SELECT * FROM entries WHERE id=?', p);
  assert.deepEqual([e.status, e.paid_date, e.external_id], ['paid', '2026-10-11', `prepaid:${p}`]);
  assert.equal(consolidate(snap(db)).total, bal, 'saldo não muda');
  assert.equal(get(db, 'SELECT COUNT(*) n FROM movements WHERE entry_id=?', p).n, 0);
  assert.equal(V.dashboard(snap(db), TODAY, '2026-10').paid, 0, 'não conta como gasto do mês');
  assert.equal(H.listLoans(db)[0].remaining_months, 5);
  assert.throws(() => L.markPrepaid(db, p, {}), /já está pago/);
  assert.throws(() => L.payEntry(db, p, { account_id: acc, paid_date: TODAY }), /já foi contabilizado/);
  L.unpayEntry(db, p);
  assert.equal(get(db, 'SELECT status FROM entries WHERE id=?', p).status, 'pending');
  assert.equal(get(db, 'SELECT external_id FROM entries WHERE id=?', p).external_id, null);
});

test('aluguel é amortizado na parcela da casa: aluguel 800 e parcela 700 deixam só 100', () => {
  const { db, acc } = setup();
  H.createLoan(db, { financed: 10000000, balance: 9000000, total_months: 120, remaining_months: 100, nominal_rate: 9, payment: 70000, next_due: '2026-10-20' }, TODAY);
  L.createEntry(db, 'income', { description: 'Aluguel casa', origin: 'Aluguel', amount: 80000, due_date: '2026-10-10', certain: true, account_id: acc }, TODAY);
  L.createEntry(db, 'income', { description: 'Aluguel extra incerto', origin: 'Aluguel', amount: 50000, due_date: '2026-10-12', certain: false, account_id: acc }, TODAY);
  const d = V.dashboard(snap(db), TODAY, '2026-10');
  assert.deepEqual(d.rentToHouse, { expected: 80000, houseTotal: 70000, amortized: 70000, left: 10000 });
  // aluguel menor que a parcela: abate só o que existe
  const db2 = setup().db;
  H.createLoan(db2, { financed: 10000000, balance: 9000000, total_months: 120, remaining_months: 100, nominal_rate: 9, payment: 70000, next_due: '2026-10-20' }, TODAY);
  L.createEntry(db2, 'income', { description: 'Aluguel', origin: 'Aluguel', amount: 50000, due_date: '2026-10-10', certain: true }, TODAY);
  const d2 = V.dashboard(snap(db2), TODAY, '2026-10');
  assert.equal(d2.rentToHouse.amortized, 50000);
  assert.equal(d2.rentToHouse.left, 0);
});
