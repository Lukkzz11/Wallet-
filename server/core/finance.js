// Regras financeiras centrais. Funções puras: recebem dados simples, devolvem resultados.
import { addDays, addMonthKey, monthOf, monthStart, monthEnd, occurrences, monthRange } from './dates.js';

export const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);

/* ---------- assinaturas ---------- */
export function monthlyEquivalent(amount, period) {
  switch (period) {
    case 'weekly': return Math.round((amount * 52) / 12);
    case 'monthly': return amount;
    case 'quarterly': return Math.round(amount / 3);
    case 'semiannual': return Math.round(amount / 6);
    case 'yearly': return Math.round(amount / 12);
    default: throw new Error(`Periodicidade inválida: ${period}`);
  }
}
export function annualEquivalent(amount, period) {
  const times = { weekly: 52, monthly: 12, quarterly: 4, semiannual: 2, yearly: 1 }[period];
  if (!times) throw new Error(`Periodicidade inválida: ${period}`);
  return amount * times;
}
// Cobranças futuras de uma assinatura ativa em [from, to] (from=null: inclui atrasadas).
export function subscriptionCharges(sub, from, to) {
  if (sub.status !== 'active') return [];
  return occurrences(sub.next_date, sub.period, from, to, sub.anchor_day, sub.end_date || null).map((d) => ({ date: d, amount: sub.amount, sub }));
}
// Assinaturas num intervalo: cobranças já registradas como despesa (pagas ou pendentes) + as previstas ainda não registradas.
// Registrar uma cobrança avança a próxima data, então a mesma cobrança nunca entra nos dois grupos.
export function subscriptionsInRange(s, from, to) {
  const reg = s.entries.filter((e) => e.type === 'expense' && e.subscription_id && e.due_date >= from && e.due_date <= to);
  const projected = sum(s.subscriptions.flatMap((x) => subscriptionCharges(x, from, to)), (c) => c.amount);
  const paid = sum(reg.filter((e) => e.status === 'paid'), (e) => e.amount);
  const pendingReg = sum(reg.filter((e) => e.status !== 'paid'), (e) => e.amount);
  return { total: paid + pendingReg + projected, paid, pending: pendingReg + projected, projected };
}

/* ---------- saldos ---------- */
export function accountBalance(acc, movements, upTo = null) {
  let b = acc.initial_balance;
  for (const m of movements) {
    if (m.account_id === acc.id && m.date >= acc.ref_date && (!upTo || m.date <= upTo)) b += m.amount;
  }
  return b;
}
export function reserveTotals(reserve, rmovs) {
  let accumulated = 0, earmarked = 0;
  for (const m of rmovs) {
    if (m.reserve_id !== reserve.id) continue;
    accumulated += m.amount;
    if (m.kind !== 'ajuste') earmarked += m.amount; // rendimento manual não é dinheiro retido da conta
  }
  return { accumulated, earmarked };
}
// Visão consolidada. Reservas são marcações (não saem da conta): evita contar duas vezes.
export function consolidate(s) {
  const bal = new Map(s.accounts.map((a) => [a.id, accountBalance(a, s.movements)]));
  const total = sum(s.accounts, (a) => bal.get(a.id));
  const spendableIds = new Set(s.accounts.filter((a) => a.spendable).map((a) => a.id));
  const spendable = sum(s.accounts.filter((a) => a.spendable), (a) => bal.get(a.id));
  const reserves = s.reserves.filter((r) => r.status === 'active').map((r) => ({ ...r, ...reserveTotals(r, s.reserveMovs) }));
  const reservedTotal = sum(reserves, (r) => r.accumulated);
  const reservedFromSpendable = sum(
    reserves.filter((r) => !r.account_id || spendableIds.has(r.account_id)),
    (r) => r.earmarked,
  );
  return { bal, total, spendable, reserves, reservedTotal, reservedFromSpendable, available: spendable - reservedFromSpendable };
}

/* ---------- lançamentos ---------- */
// Parcela marcada como paga no cadastro (antes de usar o Wallet): não movimentou saldo, então não é gasto do período.
export const isPrepaid = (e) => typeof e.external_id === 'string' && e.external_id.startsWith('prepaid:');
export const entryStatus = (e, today) => (e.status === 'paid' ? 'paid' : e.due_date < today ? 'overdue' : 'pending');

/* ---------- metas ---------- */
export function monthsUntil(today, deadline) {
  if (!deadline) return null;
  const [ty, tm] = today.split('-').map(Number);
  const [dy, dm] = deadline.split('-').map(Number);
  return Math.max(1, (dy - ty) * 12 + (dm - tm));
}
export function goalProgress(goal, s, today) {
  const reserve = goal.reserve_id ? s.reserves.find((r) => r.id === goal.reserve_id) : null;
  const saved = reserve ? reserveTotals(reserve, s.reserveMovs).accumulated : goal.saved_manual;
  const remaining = Math.max(0, goal.target - saved);
  const pct = Math.min(100, Math.round((saved / goal.target) * 1000) / 10);
  const months = monthsUntil(today, goal.deadline);
  const overdue = !!goal.deadline && goal.deadline < today && remaining > 0;
  const monthlyNeeded = remaining === 0 ? 0 : months ? Math.ceil(remaining / months) : null;
  // ritmo real: média mensal de aportes líquidos nos últimos 3 meses na reserva associada
  let pace = null, onTrack = null;
  if (reserve) {
    const from = monthStart(addMonthKey(monthOf(today), -3));
    const contrib = sum(s.reserveMovs.filter((m) => m.reserve_id === reserve.id && m.date >= from && m.kind !== 'ajuste'), (m) => m.amount);
    pace = Math.round(contrib / 3);
    onTrack = remaining === 0 ? true : monthlyNeeded == null ? null : pace >= monthlyNeeded;
  }
  return { saved, remaining, pct, months, monthlyNeeded, pace, onTrack, overdue, done: remaining === 0, reserve_name: reserve?.name ?? null };
}

/* ---------- série mensal (base caixa: valores efetivamente pagos/recebidos) ---------- */
export function monthlySeries(s, fromKey, toKey) {
  const keys = monthRange(fromKey, toKey);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const rows = keys.map((k) => ({ month: k, income: 0, expense: 0, saved: 0 }));
  for (const e of s.entries) {
    if (e.status !== 'paid' || isPrepaid(e)) continue;
    const i = idx.get(monthOf(e.paid_date));
    if (i === undefined) continue;
    rows[i][e.type] += e.amount;
  }
  for (const m of s.reserveMovs) {
    if (m.kind === 'ajuste') continue;
    const i = idx.get(monthOf(m.date));
    if (i !== undefined) rows[i].saved += m.amount;
  }
  return rows.map((r) => ({ ...r, net: r.income - r.expense }));
}
export function balanceAt(s, date) {
  return sum(s.accounts.filter((a) => a.ref_date <= date), (a) => accountBalance(a, s.movements, date));
}
export function savingsAt(s, date) {
  return sum(s.reserveMovs.filter((m) => m.date <= date), (m) => m.amount);
}

/* ---------- dívidas ---------- */
export function debtSummary(debt, entries) {
  const inst = entries.filter((e) => e.debt_id === debt.id);
  const paid = inst.filter((e) => e.status === 'paid');
  const pending = inst.filter((e) => e.status === 'pending').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const owed = sum(pending, (e) => e.amount);
  const sumInstallments = debt.installment_amount * debt.installments_total;
  return {
    paidCount: paid.length,
    pendingCount: pending.length,
    paidAmount: sum(paid, (e) => e.amount),
    owed,
    next: pending[0] ?? null,
    // Diferença entre soma das parcelas e valor total informado: pode ser juros/encargos; não é uma taxa calculada.
    difference: sumInstallments - debt.total_amount,
  };
}
export function debtCommitment(s, today, months = 6) {
  const out = [];
  for (let i = 0; i < months; i++) {
    const k = addMonthKey(monthOf(today), i);
    const items = s.entries.filter((e) => e.debt_id && e.status === 'pending' && monthOf(e.due_date) === k);
    out.push({ month: k, amount: sum(items, (e) => e.amount) });
  }
  return out;
}
export { addDays, monthEnd };
