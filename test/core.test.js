import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, get, all } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as P from '../server/services/planning.js';
import * as V from '../server/services/views.js';
import * as B from '../server/services/backup.js';
import { computeWithdrawal, simulateWithdrawal } from '../server/core/withdrawal.js';
import { project } from '../server/core/projection.js';
import { monthlyEquivalent, annualEquivalent, consolidate } from '../server/core/finance.js';
import { addMonths, occurrences } from '../server/core/dates.js';

const TODAY = '2026-10-14';
const fresh = () => {
  const db = openDb(':memory:');
  const a = L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 100000, ref_date: '2026-10-01' }).id;
  return { db, a };
};
const cat = (db, name, kind = 'expense') => get(db, 'SELECT id FROM categories WHERE name=? AND kind=?', name, kind).id;
const snap = (db) => V.loadSnapshot(db);
const bal = (db) => consolidate(snap(db));

test('datas: fim de mês e ocorrências sem deriva', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.deepEqual(occurrences('2026-01-31', 'monthly', null, '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('assinatura: equivalente mensal e anual (R$240/ano = R$20/mês)', () => {
  assert.equal(monthlyEquivalent(24000, 'yearly'), 2000);
  assert.equal(annualEquivalent(24000, 'yearly'), 24000);
  assert.equal(monthlyEquivalent(3000, 'quarterly'), 1000);
  assert.equal(annualEquivalent(1000, 'weekly'), 52000);
  assert.equal(monthlyEquivalent(1200, 'weekly'), 5200);
});

test('entradas e saídas: receita recebida e despesa paga alteram saldo uma única vez', () => {
  const { db, a } = fresh();
  const inc = L.createEntry(db, 'income', { description: 'Salário', amount: 300000, due_date: '2026-10-05', status: 'paid', paid_date: '2026-10-05', account_id: a, category_id: cat(db, 'Salário', 'income') }, TODAY).id;
  assert.equal(bal(db).total, 400000);
  const exp = L.createEntry(db, 'expense', { description: 'Luz', amount: 20000, due_date: '2026-10-20', account_id: a, category_id: cat(db, 'Contas e serviços') }, TODAY).id;
  assert.equal(bal(db).total, 400000, 'despesa pendente não altera saldo');
  L.payEntry(db, exp, { paid_date: '2026-10-14' });
  assert.equal(bal(db).total, 380000);
  assert.throws(() => L.payEntry(db, exp, { paid_date: '2026-10-14' }), /já foi contabilizado/);
  assert.equal(bal(db).total, 380000);
  L.unpayEntry(db, exp);
  assert.equal(bal(db).total, 400000);
  assert.ok(inc);
});

test('corrigir despesa paga atualiza a movimentação e registra auditoria', () => {
  const { db, a } = fresh();
  const id = L.createEntry(db, 'expense', { description: 'Mercado', amount: 10000, due_date: '2026-10-10', status: 'paid', paid_date: '2026-10-10', account_id: a }, TODAY).id;
  L.updateEntry(db, id, { description: 'Mercado', amount: 12500, due_date: '2026-10-10', paid_date: '2026-10-10', account_id: a });
  assert.equal(bal(db).total, 100000 - 12500);
  assert.equal(all(db, "SELECT * FROM audit_log WHERE action='correction'").length, 1);
});

test('transferência entre contas não é receita nem despesa', () => {
  const { db, a } = fresh();
  const b = L.createAccount(db, { name: 'Carteira', type: 'carteira', initial_balance: 0, ref_date: '2026-10-01' }).id;
  const { transfer_id } = L.transfer(db, { from_account_id: a, to_account_id: b, amount: 25000, date: '2026-10-10' });
  const accs = L.listAccounts(db);
  assert.equal(accs.find((x) => x.id === a).balance, 75000);
  assert.equal(accs.find((x) => x.id === b).balance, 25000);
  assert.equal(bal(db).total, 100000);
  const d = V.dashboard(snap(db), TODAY, '2026-10');
  assert.equal(d.received, 0);
  assert.equal(d.paid, 0);
  assert.throws(() => L.transfer(db, { from_account_id: a, to_account_id: a, amount: 1, date: '2026-10-10' }), /diferentes/);
  L.deleteTransfer(db, transfer_id);
  assert.equal(L.listAccounts(db).find((x) => x.id === b).balance, 0);
});

test('despesa recorrente: gera ocorrências sem duplicar e respeita exclusão', () => {
  const { db, a } = fresh();
  L.createEntry(db, 'expense', { description: 'Aluguel', amount: 100000, due_date: '2026-10-05', account_id: a, recurrence: 'monthly' }, TODAY);
  const n1 = all(db, 'SELECT * FROM entries').length;
  assert.ok(n1 >= 12);
  L.materializeRecurrences(db, TODAY);
  L.materializeRecurrences(db, TODAY);
  assert.equal(all(db, 'SELECT * FROM entries').length, n1);
  const one = get(db, "SELECT id FROM entries WHERE due_date='2026-12-05'").id;
  L.deleteEntry(db, one, 'one');
  L.materializeRecurrences(db, TODAY);
  assert.equal(get(db, "SELECT COUNT(*) n FROM entries WHERE due_date='2026-12-05'").n, 0);
  L.deleteEntry(db, get(db, "SELECT id FROM entries WHERE due_date='2027-01-05'").id, 'future');
  L.materializeRecurrences(db, TODAY);
  assert.equal(get(db, "SELECT COUNT(*) n FROM entries WHERE due_date>='2027-01-05'").n, 0);
});

test('assinatura mensal/anual: cobrança só ao registrar, sem duplicar', () => {
  const { db, a } = fresh();
  const mensal = P.createSubscription(db, { name: 'Streaming', amount: 3990, period: 'monthly', next_date: '2026-10-20', account_id: a }).id;
  const anual = P.createSubscription(db, { name: 'Plano anual', amount: 24000, period: 'yearly', next_date: '2027-03-01', account_id: a }).id;
  const v = V.subscriptionsView(snap(db), TODAY);
  assert.equal(v.totals.monthly, 3990 + 2000);
  assert.equal(v.totals.yearly, 3990 * 12 + 24000);
  assert.equal(all(db, 'SELECT * FROM entries').length, 0, 'nada é criado automaticamente');
  const r = P.chargeSubscription(db, mensal, { mode: 'paid', paid_date: '2026-10-20' });
  assert.equal(r.next_date, '2026-11-20');
  assert.equal(bal(db).total, 100000 - 3990);
  assert.throws(() => db.prepare("INSERT INTO entries(type,description,amount,due_date,subscription_id,created_at) VALUES ('expense','x',1,'2026-10-20',?, 'x')").run(mensal), /UNIQUE/);
  assert.ok(anual);
});

test('parcelamento: gera parcelas, quitação antecipada e status', () => {
  const { db, a } = fresh();
  const { id } = L.createEntry(db, 'expense', { description: 'Notebook', amount: 50000, due_date: '2026-11-10', account_id: a, installments: 4 }, TODAY);
  assert.ok(id);
  const debt = get(db, 'SELECT * FROM debts');
  assert.equal(all(db, 'SELECT * FROM entries WHERE debt_id=?', debt.id).length, 4);
  const first = get(db, 'SELECT id FROM entries WHERE debt_id=? AND installment_no=1', debt.id).id;
  L.payEntry(db, first, { paid_date: '2026-10-14' });
  assert.equal(bal(db).total, 50000);
  L.payoffDebt(db, debt.id, { amount: 140000, account_id: a, paid_date: '2026-10-14' });
  assert.equal(get(db, 'SELECT status FROM debts').status, 'paid');
  assert.equal(get(db, "SELECT COUNT(*) n FROM entries WHERE debt_id=? AND status='pending'", debt.id).n, 0);
  assert.equal(bal(db).total, 50000 - 140000);
});

test('reservas: dinheiro guardado não é livre, sem contar duas vezes', () => {
  const { db, a } = fresh();
  const r = P.createReserve(db, { name: 'Emergência', target: 100000, account_id: a }, TODAY).id;
  const free = (res) => 100000;
  P.reserveMove(db, r, { kind: 'aporte', amount: 30000, date: TODAY }, free);
  let c = bal(db);
  assert.equal(c.total, 100000);
  assert.equal(c.available, 70000);
  assert.equal(c.reservedTotal, 30000);
  P.reserveMove(db, r, { kind: 'ajuste', amount: 500, date: TODAY }, free); // rendimento manual
  c = bal(db);
  assert.equal(c.available, 70000, 'rendimento não reduz o disponível');
  assert.equal(c.reservedTotal, 30500);
  assert.throws(() => P.reserveMove(db, r, { kind: 'retirada', amount: 40000, date: TODAY }, free), /excede/);
  P.reserveMove(db, r, { kind: 'retirada', amount: 10000, date: TODAY }, free);
  assert.equal(bal(db).available, 80000);
  assert.throws(() => P.reserveMove(db, r, { kind: 'aporte', amount: 5000, date: TODAY }, () => 1000), /insuficiente/);
});

test('retirada: não usa todo o saldo nem receitas incertas; simulação não grava', () => {
  const { db, a } = fresh();
  P.updateSettings(db, { min_reserve: 20000, monthly_savings_goal: 0 });
  L.createEntry(db, 'expense', { description: 'Aluguel', amount: 40000, due_date: '2026-10-20', account_id: a }, TODAY);
  L.createEntry(db, 'expense', { description: 'Atrasada', amount: 10000, due_date: '2026-10-01', account_id: a }, TODAY);
  L.createEntry(db, 'income', { description: 'Freela incerto', amount: 500000, due_date: '2026-10-25', account_id: a, certain: 0 }, TODAY);
  P.createSubscription(db, { name: 'App', amount: 2000, period: 'monthly', next_date: '2026-10-28', account_id: a });
  const w = computeWithdrawal(snap(db), TODAY, 30);
  const eq = w.scenarios.equilibrado;
  // 100.000 - 10.000 (atrasada) - 40.000 (aluguel) - 2.000 (assinatura) - 5% folga(2.600) - 20.000 reserva = 25.400
  assert.equal(eq.suggested, 25400);
  assert.equal(eq.uncertainIncome, 500000);
  assert.equal(eq.confirmedIncome, 0);
  assert.ok(w.scenarios.conservador.suggested < eq.suggested);
  assert.ok(w.scenarios.flexivel.suggested > eq.suggested);
  const movBefore = all(db, 'SELECT * FROM movements').length;
  const sim = simulateWithdrawal(snap(db), TODAY, 30, 80000);
  assert.equal(sim.risk.level, 'alto');
  assert.ok(sim.uncovered.length > 0);
  assert.equal(all(db, 'SELECT * FROM movements').length, movBefore);
  L.recordWithdrawal(db, { account_id: a, amount: 25400, date: TODAY });
  assert.equal(bal(db).total, 100000 - 25400);
  assert.equal(computeWithdrawal(snap(db), TODAY, 30).scenarios.equilibrado.suggested, 0, 'após retirar, nada mais é sugerido');
});

test('retirada sinaliza dados incompletos em banco vazio', () => {
  const db = openDb(':memory:');
  const w = computeWithdrawal(snap(db), TODAY, 30);
  assert.equal(w.incomplete, true);
  assert.ok(w.missing.length >= 3);
  assert.equal(w.scenarios.equilibrado.suggested, 0);
});

test('projeção: usa dados cadastrados, receitas incertas fora e ajustes aplicados', () => {
  const { db, a } = fresh();
  L.createEntry(db, 'income', { description: 'Salário', amount: 300000, due_date: '2026-11-05', account_id: a, recurrence: 'monthly', certain: 1 }, TODAY);
  L.createEntry(db, 'expense', { description: 'Aluguel', amount: 200000, due_date: '2026-11-10', account_id: a, recurrence: 'monthly' }, TODAY);
  const p = project(snap(db), TODAY, { months: 3 });
  assert.equal(p.months.length, 3);
  const nov = p.months[1];
  assert.equal(nov.income, 300000);
  assert.equal(nov.expenses, 200000);
  assert.equal(nov.net, 100000);
  const p2 = project(snap(db), TODAY, { months: 3, monthlyWithdrawal: 150000 });
  assert.equal(p2.months[1].net, -50000);
  assert.ok(p2.summary.negativeMonths.length >= 0);
  assert.ok(p.premises.length >= 5);
});

test('backup: cria, verifica, restaura e preserva o estado anterior', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-'));
  const file = path.join(dir, 'wallet.db');
  const ctx = { db: openDb(file), file };
  const a = L.createAccount(ctx.db, { name: 'Banco', type: 'conta', initial_balance: 5000, ref_date: '2026-10-01' }).id;
  const b1 = B.createBackup(ctx);
  assert.equal(b1.ok, true);
  assert.equal(b1.counts.accounts, 1);
  L.createAccount(ctx.db, { name: 'Outra', type: 'conta', initial_balance: 1, ref_date: '2026-10-01' });
  const r = B.restoreBackup(ctx, b1.name);
  assert.equal(get(ctx.db, 'SELECT COUNT(*) n FROM accounts').n, 1);
  assert.ok(fs.existsSync(path.join(dir, 'backups', r.safety)), 'cópia de segurança do estado anterior');
  assert.equal(B.verifyBackup(path.join(dir, 'backups', r.safety)).counts.accounts, 2);
  fs.writeFileSync(path.join(dir, 'backups', 'lixo.db'), 'não é sqlite');
  assert.throws(() => B.restoreBackup(ctx, 'lixo.db'));
  assert.equal(get(ctx.db, 'SELECT COUNT(*) n FROM accounts').n, 1, 'banco intacto após backup inválido');
  // exportar/importar
  const exp = B.exportJson(ctx.db);
  L.createAccount(ctx.db, { name: 'Temporária', type: 'conta', initial_balance: 1, ref_date: '2026-10-01' });
  B.importJson(ctx, JSON.parse(JSON.stringify(exp)));
  assert.equal(get(ctx.db, 'SELECT COUNT(*) n FROM accounts').n, 1);
  assert.ok(a);
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
