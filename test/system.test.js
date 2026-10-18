import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, get, getSettings } from '../server/db.js';
import * as L from '../server/services/ledger.js';
import * as K from '../server/services/cards.js';
import * as P from '../server/services/planning.js';
import * as H from '../server/services/house.js';
import * as V from '../server/services/views.js';
import * as B from '../server/services/backup.js';
import { clearSystem } from '../server/services/system.js';
import { consolidate } from '../server/core/finance.js';

test('limpar sistema: exige a frase, faz backup verificado, apaga só dados financeiros e deixa tudo zerado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-clear-'));
  const file = path.join(dir, 'wallet.db');
  const ctx = { db: openDb(file), file };
  const db = ctx.db;
  const acc = L.createAccount(db, { name: 'Banco', type: 'conta', initial_balance: 100000, ref_date: '2026-10-01' }).id;
  const card = K.createCard(db, { name: 'Cartão', credit_limit: 100000 }).id;
  K.createCardPurchase(db, { name: 'TV', card_id: card, installment_amount: 10000, installments_total: 3, start_month: '2026-10' }, '2026-10-15');
  H.createLoan(db, { balance: 100000, total_months: 12, remaining_months: 6, payment: 10000, next_due: '2026-11-05' }, '2026-10-15');
  L.createEntry(db, 'income', { description: 'Salário', amount: 50000, due_date: '2026-10-05', status: 'paid', paid_date: '2026-10-05', account_id: acc }, '2026-10-15');
  P.createReserve(db, { name: 'Reserva', target: 100000 }, '2026-10-15');
  P.createGoal(db, { name: 'Meta', target: 100000 });
  P.updateSettings(db, { min_reserve: 5000, user_name: 'Lucas' });
  const cats = get(db, 'SELECT COUNT(*) n FROM categories').n;

  assert.throws(() => clearSystem(ctx, { confirm: 'zerar sistema' }), /ZERAR SISTEMA/);
  assert.equal(get(db, 'SELECT COUNT(*) n FROM accounts').n, 1, 'frase errada não apaga nada');

  const r = clearSystem(ctx, { confirm: 'ZERAR SISTEMA', backup: true });
  assert.ok(r.backup);
  const check = B.verifyBackup(path.join(dir, 'backups', r.backup));
  assert.equal(check.counts.accounts, 1, 'o backup guarda os dados anteriores');
  for (const t of ['accounts', 'movements', 'entries', 'debts', 'cards', 'reserves', 'reserve_movements', 'goals', 'house_loans', 'house_loan_updates', 'subscriptions', 'recurrences']) {
    assert.equal(get(db, `SELECT COUNT(*) n FROM ${t}`).n, 0, t);
  }
  assert.equal(get(db, 'SELECT COUNT(*) n FROM categories').n, cats, 'categorias preservadas');
  assert.equal(getSettings(db).min_reserve, '5000', 'configurações preservadas');
  assert.equal(get(db, 'PRAGMA user_version').user_version >= 7, true);
  const snap = V.loadSnapshot(db);
  assert.equal(consolidate(snap).total, 0);
  const d = V.dashboard(snap, '2026-10-15', '2026-10');
  assert.equal(d.totalBalance, 0);
  assert.equal(d.pending.amount, 0);
  // continua utilizável: ids recomeçam
  assert.equal(L.createAccount(db, { name: 'Nova', type: 'conta', initial_balance: 0, ref_date: '2026-10-01' }).id, 1);
  // sem backup
  const r2 = clearSystem(ctx, { confirm: 'ZERAR SISTEMA', backup: false });
  assert.equal(r2.backup, null);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
