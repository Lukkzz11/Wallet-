// Financiamento da casa. Os dados do contrato são os que o usuário informa; o saldo devedor NÃO é recalculado
// a partir de juros nominais (faltam dados do contrato/sistema de amortização). As parcelas pendentes alimentam
// contas a pagar, calendário e projeções através da dívida (kind 'casa') ligada ao financiamento.
import { get, all, run, tx, audit } from '../db.js';
import { bad, notFound, str, cents, int, date, nowIso } from '../util.js';
import { addMonths, parse } from '../core/dates.js';
import { createDebt, deleteDebt, regeneratePending } from './ledger.js';
import { debtSummary } from '../core/finance.js';

function input(b) {
  const remaining = int(b.remaining_months, { name: 'Meses restantes', min: 0, max: 600 });
  const total = b.total_months ? int(b.total_months, { name: 'Prazo total (meses)', min: 1, max: 600 }) : null;
  if (total != null && remaining > total) throw bad('Os meses restantes não podem passar do prazo total.');
  const rate = b.nominal_rate === '' || b.nominal_rate == null ? null : Number(b.nominal_rate);
  if (rate != null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) throw bad('Juros nominais inválidos (use % ao ano, de 0 a 100).');
  return {
    description: str(b.description, { name: 'Descrição', max: 120 }) || 'Financiamento da casa',
    financed: b.financed ? cents(b.financed, { name: 'Valor financiado' }) : 0,
    balance: b.balance ? cents(b.balance, { name: 'Saldo devedor' }) : 0,
    total_months: total ?? remaining,
    remaining_months: remaining,
    nominal_rate: rate,
    payment: cents(b.payment, { name: 'Valor da parcela mensal' }),
    next_due: date(b.next_due, { name: 'Vencimento da próxima parcela' }),
    notes: str(b.notes, { max: 500 }),
    note: str(b.note, { max: 200 }),
  };
}

export function createLoan(db, b, today) {
  const l = input(b);
  return tx(db, () => {
    const paid = l.total_months - l.remaining_months;
    const { id: debtId } = createDebt(db, {
      kind: 'casa', description: l.description, installment_amount: l.payment, installments_total: l.total_months,
      first_due_date: addMonths(l.next_due, -paid, parse(l.next_due).d), paid_installments: paid, total_amount: l.financed || l.payment * l.total_months, notes: l.notes,
    });
    const r = run(db, `INSERT INTO house_loans(debt_id,description,financed,balance,balance_date,total_months,nominal_rate,paid_at_update,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, debtId, l.description, l.financed, l.balance, today, l.total_months, l.nominal_rate, paid, l.notes, nowIso());
    const id = Number(r.lastInsertRowid);
    run(db, 'INSERT INTO house_loan_updates(loan_id,date,balance,remaining_months,payment,nominal_rate,note,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, today, l.balance, l.remaining_months, l.payment, l.nominal_rate, 'Cadastro inicial', nowIso());
    return { id, debt_id: debtId };
  });
}

// Atualização conforme as parcelas são pagas: substitui as parcelas PENDENTES (as pagas são preservadas).
export function updateLoan(db, id, b, today) {
  const loan = get(db, 'SELECT * FROM house_loans WHERE id=?', id);
  if (!loan) throw notFound();
  const l = input(b);
  tx(db, () => {
    regeneratePending(db, loan.debt_id, { description: l.description, amount: l.payment, remaining: l.remaining_months, firstDue: l.next_due });
    const paidNow = get(db, "SELECT COUNT(*) n FROM entries WHERE debt_id=? AND status='paid'", loan.debt_id).n;
    run(db, `UPDATE house_loans SET description=?,financed=?,balance=?,balance_date=?,total_months=?,nominal_rate=?,paid_at_update=?,notes=? WHERE id=?`,
      l.description, l.financed, l.balance, today, paidNow + l.remaining_months, l.nominal_rate, paidNow, l.notes, id);
    run(db, 'INSERT INTO house_loan_updates(loan_id,date,balance,remaining_months,payment,nominal_rate,note,created_at) VALUES (?,?,?,?,?,?,?,?)',
      id, today, l.balance, l.remaining_months, l.payment, l.nominal_rate, l.note, nowIso());
    audit(db, 'house_loan', id, 'update', loan, l);
  });
}

export function deleteLoan(db, id) {
  const loan = get(db, 'SELECT * FROM house_loans WHERE id=?', id);
  if (!loan) throw notFound();
  tx(db, () => {
    deleteDebt(db, loan.debt_id);
    run(db, 'DELETE FROM house_loan_updates WHERE loan_id=?', id);
    run(db, 'DELETE FROM house_loans WHERE id=?', id);
  });
}

export function listLoans(db) {
  const entries = all(db, 'SELECT * FROM entries WHERE debt_id IS NOT NULL AND installment_no<>9999');
  return all(db, 'SELECT * FROM house_loans ORDER BY id').map((loan) => {
    const debt = get(db, 'SELECT * FROM debts WHERE id=?', loan.debt_id);
    const sum = debtSummary(debt, entries);
    const inst = entries.filter((e) => e.debt_id === loan.debt_id).sort((a, b) => a.due_date.localeCompare(b.due_date));
    const history = all(db, 'SELECT * FROM house_loan_updates WHERE loan_id=? ORDER BY id DESC', loan.id);
    const last = inst.at(-1);
    return {
      ...loan, payment: debt.installment_amount, remaining_months: sum.pendingCount, paid_months: sum.paidCount,
      next_due: sum.next?.due_date ?? null, end_date: last?.due_date ?? null, remaining_sum: sum.owed,
      paid_since_update: Math.max(0, sum.paidCount - loan.paid_at_update),
      // estimativas (rotuladas na tela): quanto das parcelas restantes excede o saldo informado e % já amortizado
      remaining_vs_balance: loan.balance > 0 ? sum.owed - loan.balance : null,
      amortized_pct: loan.financed > 0 && loan.balance > 0 ? Math.max(0, Math.round((1 - loan.balance / loan.financed) * 1000) / 10) : null,
      history,
    };
  });
}
