// Contas, lançamentos (receitas/despesas), movimentações e transferências.
import crypto from 'node:crypto';
import { all, get, run, tx, audit } from '../db.js';
import { bad, notFound, conflict, str, cents, int, date, oneOf, bool, nowIso } from '../util.js';
import { addMonths, addDays, occurrences, parse, PERIODS } from '../core/dates.js';
import { accountBalance, isPrepaid } from '../core/finance.js';

export const ACCOUNT_TYPES = ['dinheiro', 'conta', 'carteira', 'poupanca', 'reserva', 'fgts', 'outra'];
const NON_SPENDABLE = ['poupanca', 'reserva', 'fgts'];

/* ---------- contas ---------- */
export function listAccounts(db) {
  const accs = all(db, 'SELECT * FROM accounts ORDER BY archived, name');
  const movs = all(db, 'SELECT account_id,amount,date FROM movements');
  return accs.map((a) => ({ ...a, balance: accountBalance(a, movs) }));
}
function accountInput(b) {
  const type = oneOf(b.type, ACCOUNT_TYPES, { name: 'Tipo' });
  return {
    name: str(b.name, { name: 'Nome', required: true, max: 60 }),
    type,
    initial_balance: cents(b.initial_balance ?? 0, { name: 'Saldo inicial', positive: false }),
    ref_date: date(b.ref_date, { name: 'Data de referência' }),
    spendable: b.spendable == null ? (NON_SPENDABLE.includes(type) ? 0 : 1) : bool(b.spendable),
    archived: bool(b.archived),
  };
}
export function createAccount(db, b) {
  const a = accountInput(b);
  const r = run(db, 'INSERT INTO accounts(name,type,initial_balance,ref_date,spendable,archived,created_at) VALUES (?,?,?,?,?,?,?)',
    a.name, a.type, a.initial_balance, a.ref_date, a.spendable, a.archived, nowIso());
  return { id: Number(r.lastInsertRowid) };
}
export function updateAccount(db, id, b) {
  const old = get(db, 'SELECT * FROM accounts WHERE id=?', id);
  if (!old) throw notFound();
  const a = accountInput(b);
  tx(db, () => {
    run(db, 'UPDATE accounts SET name=?,type=?,initial_balance=?,ref_date=?,spendable=?,archived=? WHERE id=?',
      a.name, a.type, a.initial_balance, a.ref_date, a.spendable, a.archived, id);
    if (old.initial_balance !== a.initial_balance || old.ref_date !== a.ref_date || old.spendable !== a.spendable) {
      audit(db, 'account', id, 'update', old, a);
    }
  });
}
export function deleteAccount(db, id) {
  const used = get(db, `SELECT (SELECT COUNT(*) FROM movements WHERE account_id=?) m,
    (SELECT COUNT(*) FROM entries WHERE account_id=?) e, (SELECT COUNT(*) FROM reserves WHERE account_id=?) r`, id, id, id);
  if (used.m || used.e || used.r) throw conflict('Esta conta possui histórico. Arquive-a em vez de excluir.');
  run(db, 'DELETE FROM accounts WHERE id=?', id);
}

/* ---------- movimentações ---------- */
export function listMovements(db, accountId) {
  return all(db, `SELECT m.*, e.description AS entry_description, e.type AS entry_type FROM movements m
    LEFT JOIN entries e ON e.id = m.entry_id WHERE m.account_id=? ORDER BY m.date DESC, m.id DESC`, accountId);
}
export function addManualMovement(db, accountId, b) {
  if (!get(db, 'SELECT id FROM accounts WHERE id=?', accountId)) throw notFound('Conta não encontrada.');
  const v = cents(b.amount, { name: 'Valor' });
  const dir = oneOf(b.direction, ['in', 'out'], { name: 'Tipo' });
  const r = run(db, 'INSERT INTO movements(account_id,amount,date,kind,description,created_at) VALUES (?,?,?,?,?,?)',
    accountId, dir === 'in' ? v : -v, date(b.date), 'manual', str(b.description, { name: 'Descrição', required: true }), nowIso());
  return { id: Number(r.lastInsertRowid) };
}
// Correção de movimentação manual ou retirada, com registro da alteração.
export function correctMovement(db, id, b) {
  const old = get(db, 'SELECT * FROM movements WHERE id=?', id);
  if (!old) throw notFound();
  if (old.kind === 'entry') throw bad('Corrija este valor editando a receita/despesa correspondente.');
  if (old.kind === 'transfer') throw bad('Transferências não são editadas; exclua e refaça.');
  const v = cents(b.amount, { name: 'Valor' });
  const amount = old.amount < 0 ? -v : v;
  const nd = date(b.date);
  const desc = str(b.description, { name: 'Descrição', required: true });
  tx(db, () => {
    run(db, 'UPDATE movements SET amount=?,date=?,description=? WHERE id=?', amount, nd, desc, id);
    audit(db, 'movement', id, 'correction', old, { amount, date: nd, description: desc });
  });
}
export function deleteMovement(db, id) {
  const old = get(db, 'SELECT * FROM movements WHERE id=?', id);
  if (!old) throw notFound();
  if (old.kind === 'entry') throw bad('Para desfazer, use "Desfazer pagamento" na receita/despesa.');
  if (old.kind === 'transfer') throw bad('Use a exclusão da transferência.');
  tx(db, () => { run(db, 'DELETE FROM movements WHERE id=?', id); audit(db, 'movement', id, 'delete', old, null); });
}
export function transfer(db, b) {
  const from = int(b.from_account_id, { name: 'Conta de origem', min: 1 });
  const to = int(b.to_account_id, { name: 'Conta de destino', min: 1 });
  if (from === to) throw bad('Origem e destino devem ser contas diferentes.');
  const v = cents(b.amount);
  const d = date(b.date);
  const desc = str(b.description, { max: 120 }) || 'Transferência entre contas';
  for (const id of [from, to]) if (!get(db, 'SELECT id FROM accounts WHERE id=?', id)) throw notFound('Conta não encontrada.');
  const tid = crypto.randomUUID();
  tx(db, () => {
    const st = db.prepare('INSERT INTO movements(account_id,amount,date,kind,description,transfer_id,created_at) VALUES (?,?,?,?,?,?,?)');
    st.run(from, -v, d, 'transfer', desc, tid, nowIso());
    st.run(to, v, d, 'transfer', desc, tid, nowIso());
    audit(db, 'transfer', null, 'create', null, { from, to, amount: v, date: d, tid });
  });
  return { transfer_id: tid };
}
export function deleteTransfer(db, tid) {
  const rows = all(db, "SELECT * FROM movements WHERE transfer_id=? AND kind='transfer'", tid);
  if (!rows.length) throw notFound();
  tx(db, () => { run(db, 'DELETE FROM movements WHERE transfer_id=?', tid); audit(db, 'transfer', null, 'delete', rows, null); });
}
export function recordWithdrawal(db, b) {
  const acc = get(db, 'SELECT * FROM accounts WHERE id=?', int(b.account_id, { name: 'Conta', min: 1 }));
  if (!acc) throw notFound('Conta não encontrada.');
  const v = cents(b.amount);
  const r = run(db, 'INSERT INTO movements(account_id,amount,date,kind,description,created_at) VALUES (?,?,?,?,?,?)',
    acc.id, -v, date(b.date), 'withdrawal', str(b.note, { max: 120 }) || 'Retirada pessoal', nowIso());
  return { id: Number(r.lastInsertRowid) };
}

/* ---------- lançamentos ---------- */
export const FREQS = PERIODS;
function entryInput(b, type) {
  const status = oneOf(b.status, ['pending', 'paid'], { name: 'Status', def: 'pending' });
  const due = date(b.due_date, { name: type === 'income' ? 'Data de recebimento/previsão' : 'Data de vencimento' });
  const e = {
    type,
    description: str(b.description, { name: 'Descrição', required: true, max: 120 }),
    amount: cents(b.amount),
    due_date: due,
    status,
    paid_date: status === 'paid' ? date(b.paid_date ?? due, { name: 'Data de pagamento' }) : null,
    category_id: b.category_id ? int(b.category_id, { min: 1 }) : null,
    account_id: b.account_id ? int(b.account_id, { min: 1 }) : null,
    payment_method: str(b.payment_method, { max: 40 }),
    origin: str(b.origin, { max: 80 }),
    nature: b.nature ? oneOf(b.nature, ['fixa', 'variavel', 'avista'], { name: 'Natureza' }) : null,
    certain: type === 'income' ? bool(b.certain ?? 1) : 1,
    notes: str(b.notes, { max: 500 }),
  };
  if (status === 'paid' && !e.account_id) throw bad('Informe a conta para registrar o valor como ' + (type === 'income' ? 'recebido.' : 'pago.'));
  return e;
}
function checkRefs(db, e) {
  if (e.account_id && !get(db, 'SELECT id FROM accounts WHERE id=?', e.account_id)) throw bad('Conta inválida.');
  if (e.category_id && !get(db, 'SELECT id FROM categories WHERE id=? AND kind=?', e.category_id, e.type)) throw bad('Categoria inválida.');
}
const COLS = 'type,description,amount,due_date,paid_date,status,category_id,account_id,payment_method,origin,nature,certain,notes,recurrence_id,subscription_id,debt_id,installment_no,external_id,created_at';
export function insertEntry(db, e) {
  const r = run(db, `INSERT INTO entries(${COLS}) VALUES (${COLS.split(',').map(() => '?').join(',')})`,
    e.type, e.description, e.amount, e.due_date, e.paid_date ?? null, e.status ?? 'pending', e.category_id ?? null, e.account_id ?? null,
    e.payment_method ?? null, e.origin ?? null, e.nature ?? null, e.certain ?? 1, e.notes ?? null,
    e.recurrence_id ?? null, e.subscription_id ?? null, e.debt_id ?? null, e.installment_no ?? null, e.external_id ?? null, nowIso());
  const id = Number(r.lastInsertRowid);
  if (e.status === 'paid' && !isPrepaid({ external_id: e.external_id })) postMovement(db, { ...e, id });
  return id;
}
function postMovement(db, e) {
  // entry_id é UNIQUE: o mesmo lançamento nunca movimenta o saldo duas vezes.
  run(db, "INSERT INTO movements(account_id,amount,date,kind,description,entry_id,created_at) VALUES (?,?,?,'entry',?,?,?)",
    e.account_id, e.type === 'income' ? e.amount : -e.amount, e.paid_date, e.description, e.id, nowIso());
}

export function createEntry(db, type, b, today) {
  const e = entryInput(b, type);
  checkRefs(db, e);
  const isPrepaidEntry = !!(b.already_paid || b.prepaid);
  if (isPrepaidEntry) {
    e.status = 'paid';
    e.paid_date = e.paid_date || e.due_date;
    e.external_id = `prepaid:${Date.now()}`;
  }
  const installments = type === 'expense' ? int(b.installments ?? 1, { name: 'Parcelas', min: 1, max: 480 }) : 1;
  const freq = b.recurrence ? oneOf(b.recurrence, FREQS, { name: 'Recorrência' }) : null;
  if (installments > 1 && freq) throw bad('Escolha parcelamento ou recorrência, não os dois.');
  return tx(db, () => {
    if (installments > 1) {
      if (e.status === 'paid') throw bad('Para parcelar, a primeira parcela deve ficar pendente; pague-as individualmente.');
      return createDebt(db, {
        description: e.description, creditor: e.origin, kind: 'compra', installment_amount: e.amount,
        total_amount: b.total_amount ?? e.amount * installments, installments_total: installments, first_due_date: e.due_date,
        account_id: e.account_id, category_id: e.category_id, notes: e.notes, payment_method: e.payment_method,
      });
    }
    if (freq) {
      const endDate = date(b.recurrence_end, { required: false });
      const rr = run(db, `INSERT INTO recurrences(type,description,amount,category_id,account_id,payment_method,origin,nature,certain,notes,frequency,start_date,end_date,active,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`, type, e.description, e.amount, e.category_id, e.account_id, e.payment_method, e.origin, e.nature, e.certain, e.notes, freq, e.due_date, endDate, nowIso());
      const rid = Number(rr.lastInsertRowid);
      materializeRecurrences(db, today);
      // a 1ª ocorrência herda o status informado (ex.: já paga)
      if (e.status === 'paid') {
        const first = get(db, 'SELECT id FROM entries WHERE recurrence_id=? AND due_date=?', rid, e.due_date);
        if (first) {
          if (isPrepaidEntry) {
            run(db, "UPDATE entries SET status='paid', paid_date=?, external_id=? WHERE id=?", e.paid_date, e.external_id, first.id);
          } else {
            payEntry(db, first.id, { account_id: e.account_id, paid_date: e.paid_date });
          }
        }
      }
      return { id: get(db, 'SELECT id FROM entries WHERE recurrence_id=? ORDER BY due_date LIMIT 1', rid)?.id, recurrence_id: rid };
    }
    return { id: insertEntry(db, e) };
  });
}

// Gera ocorrências pendentes de recorrências ativas até 12 meses à frente (idempotente).
export function materializeRecurrences(db, today) {
  const horizon = addMonths(today, 12);
  const recs = all(db, 'SELECT * FROM recurrences WHERE active=1');
  tx(db, () => {
    for (const r of recs) {
      const skips = new Set(all(db, 'SELECT due_date FROM recurrence_skips WHERE recurrence_id=?', r.id).map((x) => x.due_date));
      const dates = occurrences(r.start_date, r.frequency, null, horizon, parse(r.start_date).d, r.end_date);
      for (const d of dates) {
        if (skips.has(d)) continue;
        db.prepare(`INSERT OR IGNORE INTO entries(${COLS}) VALUES (${COLS.split(',').map(() => '?').join(',')})`).run(
          r.type, r.description, r.amount, d, null, 'pending', r.category_id, r.account_id, r.payment_method, r.origin, r.nature, r.certain, r.notes,
          r.id, null, null, null, null, nowIso());
      }
    }
  });
}

export function listEntries(db, type, q = {}) {
  const w = ['e.type = ?'], p = [type];
  if (q.from) { w.push('e.due_date >= ?'); p.push(q.from); }
  if (q.to) { w.push('e.due_date <= ?'); p.push(q.to); }
  if (q.category_id) { w.push('e.category_id = ?'); p.push(Number(q.category_id)); }
  if (q.account_id) { w.push('e.account_id = ?'); p.push(Number(q.account_id)); }
  if (q.q) { w.push('(e.description LIKE ? OR e.origin LIKE ? OR e.notes LIKE ?)'); p.push(...Array(3).fill(`%${q.q}%`)); }
  if (q.status === 'paid') w.push("e.status = 'paid'");
  if (q.status === 'pending') w.push("e.status = 'pending'");
  if (q.status === 'overdue') { w.push("e.status = 'pending' AND e.due_date < ?"); p.push(q.today); }
  return all(db, `SELECT e.*, c.name AS category_name, a.name AS account_name FROM entries e
    LEFT JOIN categories c ON c.id=e.category_id LEFT JOIN accounts a ON a.id=e.account_id
    WHERE ${w.join(' AND ')} ORDER BY e.due_date DESC, e.id DESC LIMIT 2000`, ...p);
}

export function updateEntry(db, id, b) {
  const old = get(db, 'SELECT * FROM entries WHERE id=?', id);
  if (!old) throw notFound();
  const e = entryInput({ ...b, status: old.status, paid_date: b.paid_date ?? old.paid_date }, old.type);
  checkRefs(db, e);
  tx(db, () => {
    run(db, `UPDATE entries SET description=?,amount=?,due_date=?,paid_date=?,category_id=?,account_id=?,payment_method=?,origin=?,nature=?,certain=?,notes=? WHERE id=?`,
      e.description, e.amount, e.due_date, e.paid_date, e.category_id, e.account_id, e.payment_method, e.origin, e.nature, e.certain, e.notes, id);
    if (old.status === 'paid') {
      run(db, 'UPDATE movements SET account_id=?, amount=?, date=?, description=? WHERE entry_id=?',
        e.account_id, old.type === 'income' ? e.amount : -e.amount, e.paid_date, e.description, id);
      audit(db, 'entry', id, 'correction', old, e);
    }
  });
}
export function payEntry(db, id, b) {
  const e = get(db, 'SELECT * FROM entries WHERE id=?', id);
  if (!e) throw notFound();
  if (e.status === 'paid') throw conflict('Este lançamento já foi contabilizado.');
  const accountId = int(b.account_id ?? e.account_id, { name: 'Conta', min: 1 });
  if (!get(db, 'SELECT id FROM accounts WHERE id=?', accountId)) throw bad('Conta inválida.');
  const paidDate = date(b.paid_date, { name: 'Data de pagamento' });
  tx(db, () => {
    run(db, "UPDATE entries SET status='paid', paid_date=?, account_id=?, external_id=CASE WHEN external_id LIKE 'prepaid:%' THEN NULL ELSE external_id END WHERE id=?", paidDate, accountId, id);
    postMovement(db, { ...e, id, account_id: accountId, paid_date: paidDate });
    if (e.debt_id) refreshDebtStatus(db, e.debt_id);
  });
}
// Parcela que JÁ estava paga fora do Wallet (ou antes de usá-lo): marca como paga sem criar movimentação,
// então o saldo não muda e ela não conta como gasto do período.
export function markPrepaid(db, id, b) {
  const e = get(db, 'SELECT * FROM entries WHERE id=?', id);
  if (!e) throw notFound();
  if (e.status === 'paid') throw conflict('Este lançamento já está pago.');
  const d = date(b?.paid_date ?? e.due_date, { name: 'Data do pagamento' });
  tx(db, () => {
    run(db, "UPDATE entries SET status='paid', paid_date=?, external_id=COALESCE(external_id, 'prepaid:' || id) WHERE id=?", d, id);
    audit(db, 'entry', id, 'mark-prepaid', e, { paid_date: d });
    if (e.debt_id) refreshDebtStatus(db, e.debt_id);
  });
}
export function unpayEntry(db, id) {
  const e = get(db, 'SELECT * FROM entries WHERE id=?', id);
  if (!e) throw notFound();
  if (e.status !== 'paid') throw conflict('Este lançamento não está pago.');
  tx(db, () => {
    run(db, 'DELETE FROM movements WHERE entry_id=?', id);
    run(db, "UPDATE entries SET status='pending', paid_date=NULL, external_id=CASE WHEN external_id LIKE 'prepaid:%' THEN NULL ELSE external_id END WHERE id=?", id);
    audit(db, 'entry', id, 'unpay', e, null);
    if (e.debt_id) refreshDebtStatus(db, e.debt_id);
  });
}
export function deleteEntry(db, id, scope = 'one') {
  const e = get(db, 'SELECT * FROM entries WHERE id=?', id);
  if (!e) throw notFound();
  tx(db, () => {
    const ids = [id];
    if (scope === 'future' && e.recurrence_id) {
      for (const r of all(db, "SELECT id FROM entries WHERE recurrence_id=? AND status='pending' AND due_date>?", e.recurrence_id, e.due_date)) ids.push(r.id);
      run(db, 'UPDATE recurrences SET active=0 WHERE id=?', e.recurrence_id);
    } else if (e.recurrence_id) {
      run(db, 'INSERT OR IGNORE INTO recurrence_skips(recurrence_id,due_date) VALUES (?,?)', e.recurrence_id, e.due_date);
    }
    for (const x of ids) {
      const row = get(db, 'SELECT * FROM entries WHERE id=?', x);
      run(db, 'DELETE FROM movements WHERE entry_id=?', x);
      run(db, 'DELETE FROM entries WHERE id=?', x);
      audit(db, 'entry', x, 'delete', row, null);
    }
    if (e.debt_id) refreshDebtStatus(db, e.debt_id);
  });
}

/* ---------- dívidas e parcelamentos ---------- */
export function refreshDebtStatus(db, debtId) {
  const d = get(db, 'SELECT * FROM debts WHERE id=?', debtId);
  if (!d || d.status === 'cancelled') return;
  const pending = get(db, "SELECT COUNT(*) n FROM entries WHERE debt_id=? AND status='pending'", debtId).n;
  run(db, 'UPDATE debts SET status=? WHERE id=?', pending === 0 ? 'paid' : 'active', debtId);
}
export function createDebt(db, b) {
  const n = int(b.installments_total, { name: 'Quantidade de parcelas', min: 1, max: 480 });
  const inst = cents(b.installment_amount, { name: 'Valor da parcela' });
  const first = date(b.first_due_date, { name: 'Primeiro vencimento' });
  const d = {
    description: str(b.description, { name: 'Descrição', required: true, max: 120 }),
    creditor: str(b.creditor, { max: 80 }),
    kind: oneOf(b.kind, ['compra', 'emprestimo', 'casa', 'outro'], { name: 'Tipo', def: 'compra' }),
    total_amount: cents(b.total_amount ?? inst * n, { name: 'Valor total' }),
    interest_rate: str(b.interest_rate, { max: 30 }),
    account_id: b.account_id ? int(b.account_id, { min: 1 }) : null,
    category_id: b.category_id ? int(b.category_id, { min: 1 }) : null,
    card_id: b.card_id ? int(b.card_id, { min: 1 }) : null,
    notes: str(b.notes, { max: 500 }),
  };
  const paidAlready = int(b.paid_installments ?? 0, { name: 'Parcelas já pagas', min: 0, max: n });
  return tx(db, () => {
    const r = run(db, `INSERT INTO debts(description,creditor,kind,total_amount,installment_amount,installments_total,first_due_date,interest_rate,status,account_id,category_id,card_id,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,'active',?,?,?,?,?)`, d.description, d.creditor, d.kind, d.total_amount, inst, n, first, d.interest_rate, d.account_id, d.category_id, d.card_id, d.notes, nowIso());
    const id = Number(r.lastInsertRowid);
    const catId = d.category_id ?? get(db, "SELECT id FROM categories WHERE kind='expense' AND name=?", d.kind === 'casa' ? 'Moradia' : 'Dívidas')?.id ?? null;
    for (let i = 0; i < n; i++) {
      const due = addMonths(first, i, parse(first).d);
      // parcelas já quitadas antes do cadastro são registradas como pagas SEM movimentar saldo
      insertEntry(db, {
        type: 'expense', description: `${d.description} (${i + 1}/${n})`, amount: inst, due_date: due, status: 'pending', category_id: catId,
        account_id: d.account_id, payment_method: b.payment_method ?? null, nature: 'fixa', origin: d.creditor, debt_id: id, installment_no: i + 1,
      });
    }
    if (paidAlready > 0) {
      run(db, "UPDATE entries SET status='paid', paid_date=due_date, external_id='prepaid:' || id WHERE debt_id=? AND installment_no<=?", id, paidAlready);
    }
    refreshDebtStatus(db, id);
    return { id };
  });
}
export function updateDebt(db, id, b) {
  const old = get(db, 'SELECT * FROM debts WHERE id=?', id);
  if (!old) throw notFound();
  tx(db, () => {
    run(db, 'UPDATE debts SET description=?, creditor=?, interest_rate=?, notes=?, status=? WHERE id=?',
      str(b.description, { name: 'Descrição', required: true, max: 120 }), str(b.creditor, { max: 80 }), str(b.interest_rate, { max: 30 }), str(b.notes, { max: 500 }),
      oneOf(b.status, ['active', 'paid', 'cancelled'], { def: old.status }), id);
  });
}
export function deleteDebt(db, id) {
  // só bloqueia se alguma parcela já movimentou saldo (parcelas marcadas como pagas no cadastro não têm movimentação)
  const moved = get(db, 'SELECT COUNT(*) n FROM entries e JOIN movements m ON m.entry_id=e.id WHERE e.debt_id=?', id).n;
  if (moved) throw conflict('Esta dívida tem parcelas pagas com movimentação de saldo. Marque-a como cancelada em vez de excluir.');
  tx(db, () => {
    run(db, 'DELETE FROM entries WHERE debt_id=?', id);
    run(db, 'DELETE FROM debts WHERE id=?', id);
  });
}
// Substitui as parcelas PENDENTES de uma dívida (as pagas são preservadas). Usado ao editar compras e atualizar o financiamento.
export function regeneratePending(db, debtId, { description, amount, remaining, firstDue }) {
  const d = get(db, 'SELECT * FROM debts WHERE id=?', debtId);
  if (!d) throw notFound();
  const done = all(db, "SELECT * FROM entries WHERE debt_id=? AND status='paid' AND installment_no<>9999", debtId);
  const pend = all(db, "SELECT * FROM entries WHERE debt_id=? AND status='pending'", debtId);
  const ref = pend[0] || done.at(-1) || {};
  const maxNo = Math.max(0, ...done.map((e) => e.installment_no || 0));
  const desc = str(description, { name: 'Descrição', required: true, max: 120 });
  const amt = cents(amount, { name: 'Valor da parcela' });
  const n = int(remaining, { name: 'Parcelas que faltam', min: 0, max: 600 });
  const first = date(firstDue, { name: 'Vencimento da próxima parcela' });
  tx(db, () => {
    run(db, "DELETE FROM entries WHERE debt_id=? AND status='pending'", debtId);
    const total = done.length + n;
    for (let i = 0; i < n; i++) {
      const no = maxNo + 1 + i;
      insertEntry(db, {
        type: 'expense', description: `${desc} (${no}/${total})`, amount: amt, due_date: addMonths(first, i, parse(first).d), status: 'pending',
        category_id: ref.category_id ?? d.category_id, account_id: ref.account_id ?? d.account_id, payment_method: ref.payment_method ?? null,
        nature: 'fixa', origin: d.creditor, debt_id: debtId, installment_no: no,
      });
    }
    run(db, 'UPDATE debts SET description=?, installment_amount=?, installments_total=?, status=? WHERE id=?', desc, amt, total, n > 0 ? 'active' : 'paid', debtId);
    audit(db, 'debt', debtId, 'regenerate', { pending: pend.length }, { remaining: n, amount: amt });
  });
}

// Quitação antecipada: substitui as parcelas pendentes por um único pagamento do valor informado.
export function payoffDebt(db, id, b) {
  const d = get(db, 'SELECT * FROM debts WHERE id=?', id);
  if (!d) throw notFound();
  const pending = all(db, "SELECT * FROM entries WHERE debt_id=? AND status='pending' ORDER BY due_date", id);
  if (!pending.length) throw conflict('Não há parcelas pendentes.');
  const amount = cents(b.amount, { name: 'Valor da quitação' });
  const accountId = int(b.account_id, { name: 'Conta', min: 1 });
  const pd = date(b.paid_date, { name: 'Data do pagamento' });
  tx(db, () => {
    const base = pending[0];
    for (const p of pending) { run(db, 'DELETE FROM movements WHERE entry_id=?', p.id); run(db, 'DELETE FROM entries WHERE id=?', p.id); }
    const eid = insertEntry(db, {
      type: 'expense', description: `${d.description} (quitação antecipada)`, amount, due_date: pd, paid_date: pd, status: 'paid',
      category_id: base.category_id, account_id: accountId, nature: 'avista', origin: d.creditor, debt_id: id, installment_no: 9999,
    });
    audit(db, 'debt', id, 'payoff', { removed: pending.map((p) => p.id) }, { entry: eid, amount });
    refreshDebtStatus(db, id);
  });
}
export { addDays };
